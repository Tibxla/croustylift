// Cache de LECTURE du chemin hors-ligne de la Capture (ADR 0012).
//
// PROBLÈME : la salle n'a pas de réseau fiable. Le chemin d'ÉCRITURE est déjà
// durable (outbox, ADR 0003) mais chaque lecture (routines, séances,
// prescriptions, historique des Références) partait sur le réseau et bloquait
// l'écran entier hors-ligne. Ici : une copie locale par utilisateur, servie
// CACHE D'ABORD (stale-while-revalidate) — le réseau redevient une
// optimisation, plus une dépendance.
//
// Sémantiques offertes :
//   - `cachedRead`      : copie locale servie immédiatement si présente, puis
//     revalidation en arrière-plan, qui met à jour le CACHE. L'écran monté n'est
//     pas re-rendu par le cache lui-même ; qui veut suivre une copie s'y abonne
//     (`onReadWritten`, ce que fait la Capture pour l'historique des exos, sans
//     jamais déplacer une saisie en cours). Sans copie : réseau, et l'échec
//     remonte à l'appelant.
//   - `networkFirstRead`: réseau d'abord BORNÉ (3 s), copie locale en secours.
//     Réservé aux décisions qui exigent le frais après une écriture (le check
//     de premier lancement : créer sa routine puis la relire doit la voir).
//   - `invalidateReads` : une écriture faite depuis l'app (plan édité) marque
//     des copies PÉRIMÉES. Elles ne sont plus servies d'abord : la lecture
//     suivante passe par le réseau, borné, la copie restant le secours.
//
// Étiquetage : chaque entrée est scoppée au `userId` du marqueur local
// (local-account) et purgée par `clearReadCache` à la Déconnexion. Sans
// marqueur, tout passe en direct (aucun cache) — l'app n'est alors pas censée
// être authentifiée.
//
// ORDRE DES RÉPONSES : plusieurs lectures d'une même clé peuvent être en vol
// (revalidation de fond, relecture après un flush). Seule la DERNIÈRE PARTIE a
// le droit d'écrire la copie (`guardedFetch`) : une réponse plus ancienne, qui
// peut dater d'avant une écriture acquittée depuis, est rendue à son appelant
// mais n'écrase rien. Même garde sur le compte : une réponse arrivée après un
// changement de compte reconnu ne s'écrit pas.
//
// LIMITE ASSUMÉE (cf. docs/future-improvements.md) : la revalidation ne sait
// rejouer que les lectures déjà VUES dans la session en cours (registre
// mémoire). La Référence n'en dépend plus pour ce qui est écrit d'ici : l'outbox
// est fusionnée tant qu'une série attend (ADR 0014), et la copie d'historique
// de l'exo est relue dès l'acquittement (`refreshRead`, ADR 0020). Une copie
// dont les lignes ont changé ailleurs (autre appareil) est rattrapée par sa
// revalidation de fond, et la Capture montée suit ce changement
// (`onReadWritten`). Hors ligne, elle reste en retard jusqu'au retour du réseau.
import { loadLocalAccount } from './local-account';

const PREFIX = 'croustylift:readcache';

/** Délai du « réseau d'abord » avant repli sur la copie locale (ADR 0012). */
export const NETWORK_FIRST_TIMEOUT_MS = 3000;

/** Enveloppe versionnée : permet d'invalider d'un bloc si la forme change. */
interface Envelope {
  v: 1;
  value: unknown;
  /**
   * Copie PÉRIMÉE par une écriture faite depuis l'app (`invalidateReads`) : elle
   * n'est plus servie d'abord, seulement en secours quand le réseau ne répond pas.
   */
  stale?: true;
  /**
   * ESTAMPILLE de la lecture qui a écrit cette copie, relevée à son départ
   * (`setReadStamper`). Dit quelles écritures locales la copie ne peut pas
   * contenir. Absente d'une copie écrite avant ce champ, ou sans estampilleur.
   */
  stamp?: number;
}

/**
 * Estampilleur des lectures : relevé au DÉPART de chaque lecture réseau, et
 * gardé avec la copie qu'elle écrit (`cachedReadStamped`, `peekReadStamped`).
 * Posé par la couche qui tient le registre d'écritures (capture/data.ts) : le
 * cache n'en connaît que le nombre. Sans estampilleur, aucune copie n'en porte.
 */
let stamper: (() => number) | null = null;

export function setReadStamper(next: (() => number) | null): void {
  stamper = next;
}

/** Registre mémoire des revalidations connues de cette session (clé → refetch). */
const revalidators = new Map<string, () => Promise<void>>();

/**
 * Numéro de la lecture dont la réponse a été ÉCRITE en dernier, par clé. Une
 * réponse n'écrit que si elle est partie APRÈS celle-là : une revalidation
 * partie avant un acquittement ne peut pas écraser la relecture qui a suivi.
 * On compare à la dernière réponse écrite, pas à la dernière lecture partie :
 * sinon une relance qui échoue (« Réessayer » sur réseau lent) empêcherait la
 * réponse tardive, valide, de la lecture précédente de semer la copie.
 */
const lastWritten = new Map<string, number>();
let readSeq = 0;
/** Incrémenté à chaque purge : une réponse partie avant ne ressème rien. */
let purgeGen = 0;
/**
 * Seuil par clé, posé par une relecture qui suit une écriture ACQUITTÉE
 * (`refreshRead`) : toute réponse partie avant ce seuil décrit la base d'avant
 * l'écriture et ne peut plus écrire la copie, MÊME si la relecture échoue
 * (sinon une série ou une séance supprimée reviendrait dans la Référence).
 */
const floor = new Map<string, number>();

function fullKey(userId: string, key: string): string {
  return `${PREFIX}:${userId}:${key}`;
}

/**
 * Invalidations ciblées (`invalidateReads`) : préfixe complet (compte compris)
 * → numéro de la dernière lecture partie AVANT l'invalidation. Une réponse de
 * numéro inférieur ou égal, sur une clé de ce préfixe, décrit la base d'avant
 * l'écriture : elle n'écrit pas la copie. Les autres clés ne sont pas touchées.
 */
const invalidatedAt = new Map<string, number>();

/** La lecture `seq` de `storageKey` est-elle partie avant une invalidation de sa clé ? */
function departedBeforeInvalidation(storageKey: string, seq: number): boolean {
  for (const [prefix, at] of invalidatedAt) {
    if (seq <= at && storageKey.startsWith(prefix)) return true;
  }
  return false;
}

/** Lit une entrée. `null` = absente ou illisible (jamais « valeur null »). */
function readEntry<T>(key: string): { value: T; stale: boolean; stamp: number | null } | null {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as Envelope).v === 1 &&
      'value' in (parsed as Envelope)
    ) {
      const stamp = (parsed as Envelope).stamp;
      return {
        value: (parsed as Envelope).value as T,
        stale: (parsed as Envelope).stale === true,
        stamp: typeof stamp === 'number' ? stamp : null,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Écrit une entrée (dégrade en silence si quota plein / mode privé), puis
 * prévient les abonnés (`onReadWritten`) si le CONTENU a changé.
 */
function writeEntry(key: string, value: unknown, stamp: number | null = null): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const before = readEntry<unknown>(key);
    const after = JSON.stringify({ v: 1, value, ...(stamp !== null ? { stamp } : {}) } satisfies Envelope);
    localStorage.setItem(key, after);
    // Seul un CONTENU qui change prévient les abonnés : une copie relue à
    // l'identique, sous une estampille plus récente, ne fait bouger aucun écran.
    if (before === null || before.stale || JSON.stringify(before.value) !== JSON.stringify(value)) {
      notifyWritten(key);
    }
  } catch {
    // Sans copie persistée, la lecture repartira sur le réseau la prochaine
    // fois : dégradation acceptable, on ne bloque jamais la lecture en cours.
  }
}

/** Abonnés aux écritures de copies (cf. `onReadWritten`). */
const writeListeners = new Set<(key: string) => void>();

function notifyWritten(storageKey: string): void {
  if (writeListeners.size === 0) return;
  const account = loadLocalAccount();
  if (!account) return;
  const scope = fullKey(account.userId, '');
  if (!storageKey.startsWith(scope)) return;
  const key = storageKey.slice(scope.length);
  for (const listener of [...writeListeners]) listener(key);
}

/**
 * S'abonne aux copies dont le contenu CHANGE : `listener` reçoit la clé (sans
 * l'étiquette de compte) de chaque copie réécrite avec une autre valeur. Seules
 * les écritures passées par les gardes d'ordre notifient (`guardedFetch`,
 * `seedRead`) : une réponse supplantée, donc non écrite, ne prévient personne,
 * et une copie réécrite à l'identique non plus. Une purge ou une invalidation
 * ne sont pas des écritures : elles ne notifient pas. Rend la fonction de
 * désabonnement.
 */
export function onReadWritten(listener: (key: string) => void): () => void {
  writeListeners.add(listener);
  return () => {
    writeListeners.delete(listener);
  };
}

/**
 * Lit le réseau et sème la copie, sous gardes : la réponse n'écrit que si elle
 * est partie après la dernière réponse écrite pour cette clé (sinon elle
 * écraserait du plus frais avec du plus vieux), si aucune purge ni invalidation
 * de sa clé n'a eu lieu depuis son départ, et si le compte reconnu est toujours
 * celui du départ.
 * Dans tous les cas la valeur est rendue à l'appelant.
 */
async function guardedFetch<T>(
  userId: string,
  storageKey: string,
  fetcher: () => Promise<T>,
  raisesFloor = false,
): Promise<T> {
  return (await guardedFetchStamped(userId, storageKey, fetcher, raisesFloor)).value;
}

/** `guardedFetch`, qui rend aussi l'estampille relevée au départ de la lecture. */
async function guardedFetchStamped<T>(
  userId: string,
  storageKey: string,
  fetcher: () => Promise<T>,
  raisesFloor = false,
): Promise<{ value: T; stamp: number | null }> {
  readSeq += 1;
  const seq = readSeq;
  const gen = purgeGen;
  if (raisesFloor) floor.set(storageKey, seq);
  const stamp = stamper ? stamper() : null;
  const value = await fetcher();
  if (
    gen === purgeGen &&
    seq >= (floor.get(storageKey) ?? 0) &&
    seq > (lastWritten.get(storageKey) ?? 0) &&
    !departedBeforeInvalidation(storageKey, seq) &&
    loadLocalAccount()?.userId === userId
  ) {
    writeEntry(storageKey, value, stamp);
    lastWritten.set(storageKey, seq);
  }
  return { value, stamp };
}

/** Borne une promesse : rejette après `ms` (la promesse d'origine continue). */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Pas de réponse du serveur sous ${ms} ms.`)),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

/**
 * Lecture « cache d'abord » (ADR 0012) : la copie locale est servie
 * immédiatement si elle existe (boot instantané, en ligne comme hors-ligne),
 * pendant qu'une revalidation silencieuse met la copie à jour pour la
 * prochaine lecture. Sans copie : on attend le réseau et on sème le cache.
 */
export async function cachedRead<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  return (await cachedReadStamped(key, fetcher)).value;
}

/**
 * `cachedRead`, qui rend aussi l'ESTAMPILLE de ce qu'il sert : celle de la
 * lecture qui a écrit la copie servie, ou celle de la lecture réseau qui vient
 * de répondre. `null` : copie d'avant ce champ, ou aucun estampilleur posé.
 */
export async function cachedReadStamped<T>(
  key: string,
  fetcher: () => Promise<T>,
): Promise<{ value: T; stamp: number | null }> {
  const account = loadLocalAccount();
  if (!account) {
    const stamp = stamper ? stamper() : null;
    return { value: await fetcher(), stamp };
  }

  const storageKey = fullKey(account.userId, key);
  const refresh = async () => {
    await guardedFetch(account.userId, storageKey, fetcher);
  };
  revalidators.set(storageKey, refresh);

  const cached = readEntry<T>(storageKey);
  if (cached !== null && !cached.stale) {
    // Revalidation en arrière-plan : hors-ligne elle échoue en silence, la
    // copie servie reste la vérité locale jusqu'au prochain passage en ligne.
    void refresh().catch(() => {});
    return { value: cached.value, stamp: cached.stamp };
  }

  const attempt = guardedFetchStamped(account.userId, storageKey, fetcher);
  if (cached === null) return attempt;
  // Copie PÉRIMÉE par une écriture faite d'ici (`invalidateReads`) : réseau
  // d'abord, borné ; la copie ne sert qu'en secours (hors ligne, wifi zombie).
  // Une réponse tardive la remettra à neuf pour la lecture suivante.
  void attempt.catch(() => {});
  try {
    return await withTimeout(attempt, NETWORK_FIRST_TIMEOUT_MS);
  } catch {
    return { value: cached.value, stamp: cached.stamp };
  }
}

/**
 * Marque PÉRIMÉES les copies dont la clé commence par un des préfixes : une
 * écriture faite depuis l'app (plan édité, exo renommé) vient de les rendre
 * fausses. Elles ne sont pas retirées, hors ligne la Capture doit toujours
 * s'ouvrir : la prochaine lecture passe par le réseau et ne retombe sur la copie
 * qu'en échec (cf. `cachedRead`). Le marquage est écrit dans la copie, il survit
 * au rechargement. Les lectures de ces clés encore en vol sont parties avant
 * l'écriture : leur réponse n'écrit rien. Les clés hors préfixes ne sont pas
 * concernées, leurs lectures en vol sèment leur copie comme d'habitude.
 */
export function invalidateReads(prefixes: readonly string[]): void {
  const account = loadLocalAccount();
  if (!account || typeof localStorage === 'undefined') return;
  for (const prefix of prefixes) invalidatedAt.set(fullKey(account.userId, prefix), readSeq);
  for (const prefix of prefixes) {
    for (const key of cachedKeys(prefix)) {
      const storageKey = fullKey(account.userId, key);
      const entry = readEntry<unknown>(storageKey);
      if (entry === null || entry.stale) continue;
      try {
        localStorage.setItem(
          storageKey,
          JSON.stringify({
            v: 1,
            value: entry.value,
            stale: true,
            ...(entry.stamp !== null ? { stamp: entry.stamp } : {}),
          } satisfies Envelope),
        );
      } catch {
        // Quota plein : faute de pouvoir la marquer, la copie fausse est retirée.
        localStorage.removeItem(storageKey);
      }
    }
  }
}

/**
 * Relecture RÉSEAU d'une clé, qui remplace la copie locale (sous les gardes de
 * `guardedFetch`). Pour les copies qu'une écriture qui vient d'être acquittée a
 * rendues périmées. Ne jette jamais : en échec, la copie reste telle quelle.
 */
export async function refreshRead<T>(key: string, fetcher: () => Promise<T>): Promise<void> {
  const account = loadLocalAccount();
  if (!account) return;
  try {
    await guardedFetch(account.userId, fullKey(account.userId, key), fetcher, true);
  } catch {
    // Hors-ligne ou erreur serveur : la copie servie reste la vérité locale.
  }
}

/**
 * Écrit dans la copie une valeur que l'app SAIT être en base : celle d'une
 * écriture qui vient d'être acquittée (note d'instructions, cf. capture/sync).
 * Pose aussi le seuil : une lecture partie avant décrit la base d'avant cette
 * écriture et ne peut plus écraser la copie. Réservé aux valeurs scalaires dont
 * la forme locale EST la forme serveur (l'ADR 0014 écarte le reste).
 *
 * `writerId` : le compte sous lequel l'écriture est partie. La copie n'est écrite
 * que s'il est encore celui que l'appareil reconnaît : la note d'un compte ne
 * doit jamais atterrir dans les copies d'un autre arrivé entre-temps.
 */
export function seedRead(key: string, value: unknown, writerId?: string): void {
  const account = loadLocalAccount();
  if (!account) return;
  if (writerId !== undefined && writerId !== account.userId) return;
  const storageKey = fullKey(account.userId, key);
  readSeq += 1;
  floor.set(storageKey, readSeq);
  lastWritten.set(storageKey, readSeq);
  writeEntry(storageKey, value);
}

/**
 * La copie locale d'une clé, telle quelle, SANS lecture réseau ni revalidation ;
 * `null` si absente ou illisible. Pour décider d'après son contenu (ex. quelles
 * copies contiennent une ligne supprimée), pas pour servir un écran.
 */
export function peekRead<T>(key: string): T | null {
  return peekReadStamped<T>(key)?.value ?? null;
}

/** `peekRead`, avec l'estampille de la copie (cf. `cachedReadStamped`). */
export function peekReadStamped<T>(key: string): { value: T; stamp: number | null } | null {
  const account = loadLocalAccount();
  if (!account) return null;
  const entry = readEntry<T>(fullKey(account.userId, key));
  return entry === null ? null : { value: entry.value, stamp: entry.stamp };
}

/**
 * Comme `peekRead`, mais `null` pour une copie marquée périmée par une écriture
 * faite depuis cet appareil (`invalidateReads`) : pour affirmer quelque chose à
 * l'utilisateur d'après la copie (« il figure dans Push A »), jamais d'après un
 * état que l'appareil sait dépassé.
 */
export function peekFreshRead<T>(key: string): T | null {
  const account = loadLocalAccount();
  if (!account) return null;
  const entry = readEntry<T>(fullKey(account.userId, key));
  return entry && !entry.stale ? entry.value : null;
}

/**
 * Retire UNE copie locale (et sa revalidation connue). Pour l'éviction des
 * copies qui ne seront plus jamais lues (cf. `pruneCaptureCopies`) : sans elle
 * le cache ne faisait que grossir, sur le quota que l'outbox partage.
 */
export function dropRead(key: string): void {
  const account = loadLocalAccount();
  if (!account || typeof localStorage === 'undefined') return;
  const storageKey = fullKey(account.userId, key);
  revalidators.delete(storageKey);
  try {
    localStorage.removeItem(storageKey);
  } catch {
    /* no-op */
  }
}

/** Les clés (sans l'étiquette de compte) des copies existantes sous `prefix`. */
export function cachedKeys(prefix: string): string[] {
  const account = loadLocalAccount();
  if (!account || typeof localStorage === 'undefined') return [];
  const scope = fullKey(account.userId, '');
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key !== null && key.startsWith(scope + prefix)) keys.push(key.slice(scope.length));
  }
  return keys;
}

/**
 * Lecture « réseau d'abord » bornée (3 s), copie locale en secours. À réserver
 * aux décisions qui exigent le frais juste après une écriture (read-after-write),
 * comme le check de premier lancement — un `cachedRead` y servirait la copie
 * PÉRIMÉE juste après la création de la routine et rebouclerait sur l'écran de
 * premier lancement.
 */
export async function networkFirstRead<T>(
  key: string,
  fetcher: () => Promise<T>,
  timeoutMs: number = NETWORK_FIRST_TIMEOUT_MS,
): Promise<T> {
  const account = loadLocalAccount();
  if (!account) return fetcher();

  const storageKey = fullKey(account.userId, key);
  // Même si la course est perdue (délai), une réponse tardive ressème la copie.
  const attempt = guardedFetch(account.userId, storageKey, fetcher);
  void attempt.catch(() => {});

  try {
    return await withTimeout(attempt, timeoutMs);
  } catch (err) {
    const cached = readEntry<T>(storageKey);
    if (cached !== null) return cached.value;
    throw err;
  }
}

/**
 * Rejoue toutes les revalidations connues de la session (no-op hors-ligne).
 * Appelée après un flush d'outbox réussi (App). L'historique des exos touchés
 * par le flush est en plus relu par `flushOutbox` lui-même, sous seuil (sync.ts).
 */
export function revalidateReadCache(): void {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  for (const refresh of revalidators.values()) {
    void refresh().catch(() => {});
  }
}

/** Purge TOUTES les copies locales, tous comptes (Déconnexion / forçage). */
export function clearReadCache(): void {
  revalidators.clear();
  // Les lectures encore en vol sont parties avant la purge : leur réponse ne
  // ressèmera pas une copie qu'on vient de purger.
  lastWritten.clear();
  floor.clear();
  invalidatedAt.clear();
  purgeGen += 1;
  if (typeof localStorage === 'undefined') return;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key !== null && key.startsWith(`${PREFIX}:`)) doomed.push(key);
    }
    for (const key of doomed) localStorage.removeItem(key);
  } catch {
    /* no-op */
  }
}
