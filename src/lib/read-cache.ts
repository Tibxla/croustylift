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
//     revalidation en arrière-plan (met à jour le CACHE, jamais l'UI montée —
//     l'écran relit à son prochain montage ; on ne re-rend pas une capture en
//     cours de saisie). Sans copie : réseau, et l'échec remonte à l'appelant.
//   - `tolerantRead`    : pareil, mais un échec total rend un repli fourni —
//     pour les lectures datées du jour (exécution en cours, repère « tu
//     notais ») dont l'absence est un état valide du système.
//   - `networkFirstRead`: réseau d'abord BORNÉ (3 s), copie locale en secours.
//     Réservé aux décisions qui exigent le frais après une écriture (le check
//     de premier lancement : créer sa routine puis la relire doit la voir).
//
// Étiquetage : chaque entrée est scoppée au `userId` du marqueur local
// (local-account) et purgée par `clearReadCache` à la Déconnexion. Sans
// marqueur, tout passe en direct (aucun cache) — l'app n'est alors pas censée
// être authentifiée.
//
// LIMITE ASSUMÉE (cf. docs/future-improvements.md) : la revalidation ne sait
// rejouer que les lectures déjà VUES dans la session en cours (registre
// mémoire). Une copie jamais revalidée depuis la dernière synchro peut servir
// une Référence en retard d'une exécution — même classe d'imprécision que le
// last-write-wins déjà accepté (ADR 0003).
import { loadLocalAccount } from './local-account';

const PREFIX = 'croustylift:readcache';

/** Délai du « réseau d'abord » avant repli sur la copie locale (ADR 0012). */
export const NETWORK_FIRST_TIMEOUT_MS = 3000;

/** Enveloppe versionnée : permet d'invalider d'un bloc si la forme change. */
interface Envelope {
  v: 1;
  value: unknown;
}

/** Registre mémoire des revalidations connues de cette session (clé → refetch). */
const revalidators = new Map<string, () => Promise<void>>();

function fullKey(userId: string, key: string): string {
  return `${PREFIX}:${userId}:${key}`;
}

/** Lit une entrée. `null` = absente ou illisible (jamais « valeur null »). */
function readEntry<T>(key: string): { value: T } | null {
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
      return { value: (parsed as Envelope).value as T };
    }
    return null;
  } catch {
    return null;
  }
}

/** Écrit une entrée (dégrade en silence si quota plein / mode privé). */
function writeEntry(key: string, value: unknown): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify({ v: 1, value } satisfies Envelope));
  } catch {
    // Sans copie persistée, la lecture repartira sur le réseau la prochaine
    // fois : dégradation acceptable, on ne bloque jamais la lecture en cours.
  }
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
  const account = loadLocalAccount();
  if (!account) return fetcher();

  const storageKey = fullKey(account.userId, key);
  const refresh = async () => {
    writeEntry(storageKey, await fetcher());
  };
  revalidators.set(storageKey, refresh);

  const cached = readEntry<T>(storageKey);
  if (cached !== null) {
    // Revalidation en arrière-plan : hors-ligne elle échoue en silence, la
    // copie servie reste la vérité locale jusqu'au prochain passage en ligne.
    void refresh().catch(() => {});
    return cached.value;
  }

  const value = await fetcher();
  writeEntry(storageKey, value);
  return value;
}

/**
 * `cachedRead` tolérant : un échec TOTAL (pas de copie, pas de réseau) rend le
 * repli fourni au lieu de jeter. Pour les lectures dont l'absence est un état
 * valide (exécution du jour, repère « tu notais » — cf. CONTEXT.md).
 */
export async function tolerantRead<T>(
  key: string,
  fetcher: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await cachedRead(key, fetcher);
  } catch {
    return fallback;
  }
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
  const attempt = fetcher();
  // Même si la course est perdue (délai), une réponse tardive ressème la copie.
  void attempt.then((value) => writeEntry(storageKey, value)).catch(() => {});

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
 * Appelée après un flush d'outbox réussi (App) : la Référence hors-ligne de la
 * prochaine séance intègre ainsi celle qui vient d'être synchronisée.
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

/**
 * Condensé court et stable d'une liste d'ids (djb2, hex) : clé de cache bornée
 * pour les lectures paramétrées par un ENSEMBLE (ex. toutes les versions d'une
 * séance), insensible à l'ordre.
 */
export function stableKeyOf(parts: readonly string[]): string {
  const joined = [...parts].sort().join('|');
  let hash = 5381;
  for (let i = 0; i < joined.length; i++) {
    hash = ((hash << 5) + hash + joined.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16);
}
