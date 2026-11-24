// Lectures « au calme » servies depuis une copie datée (UX 7, ADR 0012).
//
// PROBLÈME : hors ligne, Séances et l'Analyse restaient 7 s sur « Chargement… »
// puis disaient « Erreur », alors que l'app savait déjà qu'elle était hors
// ligne, et que la salle sans réseau est le cas normal. Seule la Capture lisait
// sa copie locale.
//
// ICI : chaque écran au calme lit UN agrégat (la liste des routines, une
// routine, la vue d'ensemble de l'Analyse, le Journal) par `cachedRead`, emballé
// avec l'heure de sa lecture réseau (`at`) : l'écran peut dire de quand date la
// copie qu'il montre. Règles :
//   - hors ligne, on ne lance AUCUNE lecture : la copie si elle existe (même
//     périmée), sinon l'état `offline` (« Séances se consulte avec le réseau. La
//     Salle marche sans. »), jamais « Erreur » ;
//   - en ligne, `cachedRead` : la copie tout de suite, puis la revalidation de
//     fond la remplace ; `watchDated` prévient l'écran quand elle arrive ;
//   - JAMAIS de relecture en tâche de fond pendant la séance : ces lectures
//     couvrent tout l'historique (le Journal pèse vite 100 k caractères), et le
//     flush qui suit chaque série loggée les aurait relues sur le réseau de la
//     salle. Elles ne sont pas rejouées par `revalidateReadCache`
//     (`replay: false`) : une copie se relit à l'ouverture de son écran, montrée
//     d'abord. On ne la marque pas non plus périmée après un flush : périmée,
//     elle ne se montrerait plus d'abord (réseau d'abord, jusqu'à 3 s) ;
//   - une écriture faite d'ici rend périmées les copies qu'elle fausse
//     (`invalidateViews`) : celles de Séances après une écriture du plan
//     (`SEANCES_VIEWS`), celles de l'Analyse après la correction d'une séance.
//     La lecture suivante repasse par le réseau, la copie ne sert qu'en secours.
//   - exception à la règle du flush : quand une passe ACQUITTE une écriture
//     du réalisé (séries, séances, métriques), les copies de l'Analyse sont
//     marquées à rafraîchir, écran monté ou non (`viewsAcknowledged`) : elles
//     restent, se montrent d'abord, et leur revalidation les remplace ; une
//     lecture partie avant l'acquittement n'écrit plus la copie, et les vues
//     montées sont relues, dans cet onglet et dans les autres (BroadcastChannel).
//     Sans elle, la relecture que le retour du réseau lance en parallèle du
//     flush pouvait atteindre la base avant un DELETE et garder la séance
//     supprimée au Journal ;
//
// Les clés commencent toutes par `VIEW_PREFIX` : une seule invalidation les
// couvre, et l'éviction les sacrifie en premier quand le stockage est plein
// (capture/cache-eviction : une copie se relit, pas une saisie). La valeur doit
// survivre à JSON : des tableaux, jamais de `Set` ni de `Map`.
import { cachedRead, invalidateReads, markToRefresh, onReadAccepted, peekRead } from './read-cache';
import { errorMessage } from './error-message';
import { loadLocalAccount } from './local-account';

/** Début de clé de toutes les copies d'écran au calme. */
export const VIEW_PREFIX = 'vue:';

/** La liste des routines de Séances. */
export const ROUTINES_VIEW = `${VIEW_PREFIX}seances`;
/** Une routine de Séances : `vue:routine:<id>`. */
export const ROUTINE_VIEW_PREFIX = `${VIEW_PREFIX}routine:`;
/** Les copies qu'une écriture du plan fausse : celles de Séances seulement. */
export const SEANCES_VIEWS = [ROUTINES_VIEW, ROUTINE_VIEW_PREFIX] as const;
/** La vue d'ensemble de l'Analyse (courbes, mesures de séance, plan). */
export const OVERVIEW_VIEW = `${VIEW_PREFIX}analyse`;
/** Le Journal de l'Analyse. */
export const JOURNAL_VIEW = `${VIEW_PREFIX}journal`;

/** Les comparaisons de blocs d'un exo : `vue:blocs:<exerciseId>`. */
export const BLOCKS_VIEW_PREFIX = `${VIEW_PREFIX}blocs:`;
/** Les copies qu'une écriture du réalisé (séries, séances, métriques) fausse : celles de l'Analyse. */
export const REALISED_VIEWS = [OVERVIEW_VIEW, JOURNAL_VIEW, BLOCKS_VIEW_PREFIX] as const;

/** Les vues lues par un écran MONTÉ (`useDatedLoad`) : clé → ses relectures. */
const mounted = new Map<string, Set<() => void>>();

/**
 * Déclare la vue `key` lue par un écran monté : `refresh` la relit (sans
 * repasser par « chargement »). Rend la fonction de démontage.
 */
export function mountView(key: string, refresh: () => void): () => void {
  ackBus();
  const set = mounted.get(key) ?? new Set();
  set.add(refresh);
  mounted.set(key, set);
  return () => {
    set.delete(refresh);
    if (set.size === 0 && mounted.get(key) === set) mounted.delete(key);
  };
}

/** Le canal qui porte les acquittements d'un onglet aux autres (`viewsAcknowledged`). */
export const ACK_CHANNEL = 'croustylift:acquittements';
let ackChannel: BroadcastChannel | null = null;

/** Ouvre le canal à la première vue montée (ou au premier acquittement). */
function ackBus(): BroadcastChannel | null {
  if (ackChannel === null && typeof BroadcastChannel !== 'undefined') {
    ackChannel = new BroadcastChannel(ACK_CHANNEL);
    ackChannel.onmessage = (event: MessageEvent) => {
      const data = event.data as { userId?: unknown; prefixes?: unknown } | null;
      if (!Array.isArray(data?.prefixes) || data.userId !== loadLocalAccount()?.userId) return;
      applyAck(data.prefixes.filter((p): p is string => typeof p === 'string'));
    };
    // Sous Node (tests), le canal ne retient pas le processus.
    (ackChannel as { unref?: () => void }).unref?.();
  }
  return ackChannel;
}

/** Ferme le canal (tests : un canal ouvert survivrait au fichier). */
export function closeAckChannel(): void {
  ackChannel?.close();
  ackChannel = null;
}

function applyAck(prefixes: readonly string[]): void {
  markToRefresh(prefixes);
  for (const [key, refreshers] of mounted) {
    if (prefixes.some((p) => key.startsWith(p))) for (const refresh of [...refreshers]) refresh();
  }
}

/**
 * Une écriture vient d'être ACQUITTÉE (flush, cf. capture/sync) : les copies
 * qu'elle fausse sont marquées à rafraîchir, montées ou non (`markToRefresh` :
 * gardées, montrées d'abord, revalidées), et les vues montées sont relues.
 * Une lecture partie avant l'acquittement (le retour du réseau relit le Journal
 * en parallèle du flush) a pu décrire la base d'avant : sa réponse n'écrit plus
 * la copie. L'acquittement est aussi porté aux AUTRES onglets (BroadcastChannel)
 * : le flush n'a lieu que dans l'onglet qui tient le verrou de la file, et le
 * Journal d'un autre onglet doit être relu de même.
 */
export function viewsAcknowledged(prefixes: readonly string[]): void {
  applyAck(prefixes);
  const userId = loadLocalAccount()?.userId;
  if (userId) ackBus()?.postMessage({ userId, prefixes: [...prefixes] });
}

/** Une valeur et l'heure (ms) de la lecture réseau qui l'a produite. */
export interface Dated<T> {
  at: number;
  value: T;
}

export type DatedState<T> =
  | { phase: 'loading' }
  /** Hors ligne, sans copie sur l'appareil : rien n'a été lu. */
  | { phase: 'offline' }
  | { phase: 'error'; message: string }
  /** `copy` : la valeur vient de la copie locale, pas d'une lecture de ce passage. */
  | { phase: 'ready'; value: T; at: number; copy: boolean };

function isDated<T>(v: unknown): v is Dated<T> {
  return typeof v === 'object' && v !== null && typeof (v as Dated<T>).at === 'number' && 'value' in (v as Dated<T>);
}

/** La copie locale d'une vue, telle quelle (périmée comprise), ou `null`. */
export function peekDated<T>(key: string): Dated<T> | null {
  const v = peekRead<unknown>(key);
  return isDated<T>(v) ? v : null;
}

/**
 * Lit une vue. Hors ligne : la copie, ou `offline` sans rien lancer. En ligne :
 * `cachedRead` (copie d'abord si elle est fraîche, réseau sinon). N'échoue
 * jamais : l'échec est un état.
 */
export async function loadDated<T>(
  key: string,
  fetcher: () => Promise<T>,
  { offline, now = Date.now }: { offline: boolean; now?: () => number },
): Promise<DatedState<T>> {
  if (offline) {
    const copy = peekDated<T>(key);
    return copy ? { phase: 'ready', value: copy.value, at: copy.at, copy: true } : { phase: 'offline' };
  }
  const start = now();
  try {
    const read = await cachedRead<Dated<T>>(key, async () => ({ at: now(), value: await fetcher() }), { replay: false });
    return { phase: 'ready', value: read.value, at: read.at, copy: read.at < start };
  } catch (err) {
    return { phase: 'error', message: errorMessage(err) };
  }
}

/**
 * Suit une vue : `listener` reçoit la valeur fraîche chaque fois qu'une lecture
 * réseau acceptée la remplace (revalidation de fond, relecture après une
 * écriture), MÊME si sa copie n'a pas pu s'écrire (stockage plein) : l'écran
 * montre ce que le réseau vient de dire, pas l'ancienne copie. Rend le
 * désabonnement.
 */
export function watchDated<T>(key: string, listener: (state: DatedState<T>) => void): () => void {
  return onReadAccepted((accepted, value) => {
    if (accepted !== key || !isDated<T>(value)) return;
    listener({ phase: 'ready', value: value.value, at: value.at, copy: false });
  });
}

/** Une écriture faite d'ici : les copies d'écran au calme qu'elle fausse sont périmées. */
export function invalidateViews(prefixes: readonly string[]): void {
  invalidateReads(prefixes);
}

