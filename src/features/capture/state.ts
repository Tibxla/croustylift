// État de la capture : l'Exécution en cours d'une séance, + reducer + persistance.
// Pas de Supabase cette passe — l'état vit en mémoire et survit au background via localStorage.
import type { PerformedSet, Side } from '../../domain/types';
import { defaultSide, nextOrderForSide } from '../../domain/unilateral';
import type { Session } from './fixtures';
import type { LocalWrite, OutboxOp, ReadStamp } from './outbox';
import { datedNotesReality, executionReality } from './execution-reality';
import { loadLocalAccount } from '../../lib/local-account';
import { forgetEntrustedExercises, writeMakingRoom } from './cache-eviction';
import { logicalSetRows, ranksAfterDeletion } from './set-ranks';
import { CAPTURE_STATE_PREFIX } from './storage-keys';
import { isExecutionRetired } from './written-elsewhere';

/**
 * Brouillon d'une NOTE DATÉE (issue #26) : le contexte d'une perf le jour de la
 * séance, par exo. `id` est l'UUID client de la ligne `dated_notes` (stable tant
 * que la séance dure → l'écriture via outbox vise toujours la même ligne,
 * idempotente). `body` est le texte tel que saisi (normalisé à l'écriture).
 */
export interface DatedNoteDraft {
  id: string;
  body: string;
}

/** Le réalisé d'un exercice : les séries loggées, dans l'ordre, + s'il a été passé. */
export interface ExerciseProgress {
  /** Séries réellement loggées (ordre = index + 1). */
  sets: PerformedSet[];
  /**
   * Id de chaque série (UUID, cf. ADR 0003), aligné par index avec `sets`. Au log
   * d'une série neuve c'est un id CLIENT, généré et persisté avec l'état : c'est
   * lui qui rend l'écriture Supabase idempotente (upsert/delete par id) et permet
   * à l'outbox de viser exactement la bonne ligne au rejeu. Tableau parallèle car
   * `PerformedSet` (domaine) ne porte pas d'id. Une série RÉHYDRATÉE depuis la base
   * porte son id RÉEL (DB), pour rester annulable (`handleUndo` enfile un
   * `deleteSet` qui vise la bonne ligne) — sans déclencher d'`insertSet`, déjà en
   * base (cf. hydratedState). `null` ne subsiste que pour un cache d'ANCIEN format
   * (séries persistées sans id avant ce champ) : ces séries restent affichées mais
   * non annulables en base, faute d'id connu.
   */
  setIds: (string | null)[];
  /** Exo explicitement passé par l'utilisateur (un trou assumé, pas un oubli). */
  skipped: boolean;
}

/**
 * Un geste d'édition de la séance en cours (issue #36) : un exo AJOUTÉ à la fin,
 * ou un exo du plan REMPLACÉ par un autre (`replaces`). Il porte ce qu'il faut du
 * catalogue pour reconstruire l'exo sans le relire (nom, unilatéral, muscles) :
 * la séance s'ouvre sur les copies locales, sans dépendre du catalogue.
 */
export interface LayoutEdit {
  kind: 'added' | 'swapped';
  exerciseId: string;
  name: string;
  unilateral: boolean;
  primaryMuscles: string[];
  /** Pour un remplacement : l'exo du plan dont celui-ci prend la place. */
  replaces?: string;
  /**
   * Pour un remplacement : l'exo remplacé AVAIT DÉJÀ des séries au moment du
   * geste (machine prise en cours d'exo). Il reste alors dans la séance, à sa
   * place, avec ses séries, et le remplaçant s'insère juste après lui. Inscrit
   * au moment du geste ou à la réception de ses séries : supprimer ensuite la série
   * de l'exo remplacé ne doit pas faire bouger la liste. Absent : le remplaçant
   * prend la place de l'exo (geste d'avant ce champ, ou exo pas commencé).
   */
  keepsReplaced?: true;
}

export interface CaptureState {
  sessionId: string;
  /**
   * Id de l'EXÉCUTION du jour, généré CÔTÉ CLIENT (`crypto.randomUUID()`) au
   * démarrage de la session, AVANT toute écriture (cf. ADR 0003 : UUID client →
   * les lignes créées offline remontent sans collision). Réutilisé tant que la
   * session dure, persisté avec l'état pour survivre au background : un log
   * offline et son upsert d'exécution partagent toujours le même id, donc le
   * rejeu de l'outbox reste idempotent et la FK séries→exécution tient.
   */
  executionId: string;
  /** Date ISO 'YYYY-MM-DD' de l'exécution. */
  date: string;
  /**
   * La version de séance sous laquelle l'exécution est NÉE. Une exécution n'en
   * change jamais (ADR 0021), alors que la séance peut être retouchée en plein
   * entraînement : la Capture remontée doit recharger le template de CETTE
   * version, pas celui de la version courante, sinon l'écran montre un plan que
   * l'exécution ne suit pas. Absent d'un état persisté avant ce champ (repli :
   * `adoptedVersionId`).
   */
  seanceVersionId?: string;
  /**
   * DISPOSITION de la séance : le journal des exos ajoutés ou remplacés en cours
   * de séance, dans l'ordre des gestes. La séance affichée vaut le template plus
   * ce journal, rien d'autre (`replayLayout`, session-edit.ts). Avant, ces gestes
   * ne vivaient que dans l'état React de l'écran : au changement d'onglet ou au
   * rechargement, la séance était reconstruite depuis le seul template, l'exo
   * ajouté disparaissait du sélecteur et ses séries sortaient du récap.
   *
   * Persistée AVEC l'état, donc liée à l'id d'exécution qu'il porte : elle ne se
   * rejoue jamais sur une autre exécution (la fusion garde celle de l'état local,
   * un état abandonné l'emporte avec lui). MÊME TÉLÉPHONE seulement : un autre
   * appareil qui reprend la séance n'a pas ce journal et ne montre que le
   * template ; on ne reconstruit pas la disposition depuis les séries en base.
   */
  layout?: LayoutEdit[];
  /**
   * Horodatage du LANCEMENT de la session de capture (epoch ms, `Date.now()`).
   * Sert à chronométrer la durée auto : `durationMin = round((Date.now() - startedAt) / 60000)`
   * à la clôture (cf. SessionEnd). Posé une fois au démarrage, persisté en
   * localStorage et CONSERVÉ tel quel à la restauration (la durée survit au
   * passage en arrière-plan).
   */
  startedAt: number;
  /** Exo actuellement ouvert dans le panneau de capture, ou null = on est sur le sélecteur. */
  activeExerciseId: string | null;
  /** Réalisé par exerciseId. */
  progress: Record<string, ExerciseProgress>;
  /**
   * Notes datées par exerciseId (issue #26) : le contexte saisi pour cet exo le
   * jour de la séance. Survit au background (persisté). Vidé au reset (la
   * nouvelle exécution repart sans note).
   */
  datedNotes: Record<string, DatedNoteDraft>;
  /**
   * Horodatage de CLÔTURE (epoch ms) si la séance vient d'être clôturée, sinon
   * `null`. Vit en MÉMOIRE le temps du récap immédiat ; PAS restauré (ADR 0009 :
   * clôture = geste transitoire). Le câblage de persistance NETTOIE le cache
   * quand `closedAt !== null`, donc `loadPersisted` le force toujours à `null` :
   * au remontage (onglet, reload, réouverture) on repart sur une capture vierge,
   * jamais sur l'écran « Séance terminée ». La restauration d'une séance EN COURS
   * (non clôturée) reste, elle, indispensable à l'offline.
   */
  closedAt: number | null;
  /**
   * ESTAMPILLE de ce réalisé (`readStamp`, outbox.ts) : le numéro du registre
   * d'écritures à l'instant où il a été établi (montage, réponse de la base). Il
   * contient toutes les écritures locales acquittées jusque-là. À la reprise
   * sans réponse de la base (hors ligne), c'est LUI la lecture : les écritures
   * locales qu'il ne contient pas (`writesSince(asOf)`) sont appliquées
   * par-dessus, par la même règle que sur une réponse de la base
   * (execution-reality.ts). Absent d'un état enregistré avant ce champ : seules
   * les écritures non acquittées sont alors appliquées.
   */
  asOf?: ReadStamp;
}

export type CaptureAction =
  | { type: 'open-exercise'; exerciseId: string }
  | { type: 'back-to-picker' }
  // `setId` est l'UUID client de la série (cf. ADR 0003) : fourni par le caller
  // pour que l'état local et l'op d'outbox partagent EXACTEMENT le même id.
  | { type: 'log-set'; exerciseId: string; setId: string; set: Omit<PerformedSet, 'order'> }
  | { type: 'undo-last-set'; exerciseId: string }
  // Corrige une série déjà loggée, où qu'elle soit dans l'exo : seules ses
  // valeurs changent (id, rang et côté restent). Construite par `correctSet`
  // (set-gestures.ts), qui borne les valeurs et rend l'écriture à enfiler.
  | {
      type: 'correct-set';
      exerciseId: string;
      setId: string;
      values: Pick<PerformedSet, 'weightKg' | 'reps' | 'rir'>;
    }
  // Change le CÔTÉ d'une ligne d'un exo unilatéral (saisie du mauvais côté) : ni
  // son rang ni ses valeurs ne bougent. Construite par `changeSetSide`
  // (set-gestures.ts), qui vérifie que l'autre côté de ce rang est libre.
  | { type: 'change-set-side'; exerciseId: string; setId: string; side: Side }
  // Supprime la série LOGIQUE de la ligne d'id `setId`, où qu'elle soit : la
  // ligne seule, ou la paire gauche et droite de son rang en unilatéral
  // (`logicalSetRows`, set-ranks.ts). Les rangs des suivantes suivent la règle
  // de `ranksAfterDeletion`. Construite par `deleteSet` (set-gestures.ts), qui
  // rend aussi les écritures à enfiler.
  | { type: 'delete-set'; exerciseId: string; setId: string }
  // Note datée d'un exo (issue #26). `noteId` = UUID client de la ligne
  // `dated_notes`, fourni par le caller pour que l'état et l'op d'outbox visent
  // la même ligne. Un `body` vide est conservé tel quel dans l'état ; c'est la
  // couche data (datedNoteOutboxOp) qui traduit « vide » en suppression.
  | { type: 'set-dated-note'; exerciseId: string; noteId: string; body: string }
  | { type: 'skip-exercise'; exerciseId: string }
  | { type: 'unskip-exercise'; exerciseId: string }
  // Réponse de la base pour l'exécution en cours, arrivée sur le tableau déjà
  // monté (ouverture bornée à 3 s) : le réalisé devient cette lecture plus les
  // écritures locales qu'elle ne contient pas (execution-reality.ts). Rien
  // d'autre ne bouge : exo ouvert, disposition, chrono.
  | {
      type: 'reconcile-progress';
      /** Le réalisé lu en base pour cette exécution. */
      base: Record<string, HydratedProgress>;
      /**
       * Les écritures locales que la lecture ne contient pas, relevées au moment
       * d'APPLIQUER la réponse (`writesSince(estampille de la lecture)`,
       * outbox.ts), et non à son arrivée : la boîte tardive peut l'avoir gardée.
       */
      writes: readonly LocalWrite[];
      /** L'estampille du registre à l'instant où `writes` a été relevé (`CaptureState.asOf`). */
      asOf?: ReadStamp;
      /** Notes datées de la base pour cette exécution, par exo (cf. `reconcileDatedNotes`). */
      datedNotes?: Record<string, DatedNoteDraft>;
    }
  // Des séries viennent d'être ABANDONNÉES dans la feuille des saisies refusées
  // (`forgetAbandonedSets`) : la base ne les a jamais eues et ne les aura pas,
  // elles quittent le tableau tout de suite, comme le ferait sa prochaine
  // réponse. Les autres séries gardent leur rang.
  | { type: 'forget-sets'; setIds: readonly string[] }
  // Geste d'édition de la séance (exo ajouté ou remplacé), ajouté au journal.
  | { type: 'edit-layout'; edit: LayoutEdit }
  // Réancre le chrono (ADR 0011) : pose `startedAt` (epoch ms fourni par le
  // caller). Sert à l'expiration d'un lancement (1er set >1h après le lancement →
  // on réancre sur ce set) sans toucher au réalisé ni à l'exécution.
  | { type: 'set-started-at'; startedAt: number }
  // Clôture de la séance : fige `closedAt` (epoch ms fourni par le caller, pour
  // garder le reducer testable). En MÉMOIRE seulement → sert au récap immédiat ;
  // le câblage de persistance nettoie alors le cache (ADR 0009 : clôture
  // transitoire), donc rien n'est restauré au remontage.
  | { type: 'close'; closedAt: number };

function emptyProgress(): ExerciseProgress {
  return { sets: [], setIds: [], skipped: false };
}

/**
 * UUID généré côté client (cf. ADR 0003). Centralisé ici pour une éventuelle
 * substitution en test, et pour tolérer un environnement sans `crypto.randomUUID`
 * (fallback non-cryptographique mais suffisant pour distinguer des lignes locales).
 */
export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback rarissime (très vieux runtime) : pas cryptographique, juste unique.
  return `loc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getProgress(state: CaptureState, exerciseId: string): ExerciseProgress {
  return state.progress[exerciseId] ?? emptyProgress();
}

/** Note datée de l'exo dans l'exécution courante, ou `null` si aucune saisie. */
export function getDatedNote(
  state: CaptureState,
  exerciseId: string,
): DatedNoteDraft | null {
  return state.datedNotes[exerciseId] ?? null;
}

/** Le plus grand `order` déjà loggé, ou 0 si aucune série. */
function maxOrder(progress: ExerciseProgress): number {
  return progress.sets.reduce((max, s) => (s.order > max ? s.order : max), 0);
}

/**
 * Ordre (set_order) de la PROCHAINE série pour ce côté. Pur, partagé par le
 * reducer ET la couche outbox pour que l'état local et l'op d'écriture portent
 * EXACTEMENT le même order :
 *   - BILATÉRAL (`side` absent) : incrémentation simple (max order + 1) ;
 *   - UNILATÉRAL : délègue à `nextOrderForSide` (domaine), AGNOSTIQUE de l'ordre
 *     de saisie (issue #63) — le côté complète la série en cours entamée par
 *     l'autre côté (même order, qu'on ait commencé par G ou par D), sinon ouvre
 *     une nouvelle série. Remplace l'ancienne hypothèse « gauche d'abord » (#46).
 */
export function nextSetOrder(progress: ExerciseProgress, side: Side | undefined): number {
  if (side === undefined) return maxOrder(progress) + 1;
  return nextOrderForSide(progress.sets, side);
}

/**
 * Côté PROPOSÉ par défaut au sélecteur pour la prochaine saisie d'un exo
 * unilatéral (issue #63) : le côté MANQUANT de la série en cours (l'autre que
 * celui déjà loggé), `'left'` quand aucune série n'est entamée ou que la série
 * en cours est complète. `null` s'il n'y a encore rien (le sélecteur reste libre
 * tant que rien n'est loggé). Délègue au domaine (`defaultSide`) ; remplace
 * l'ancienne logique « gauche d'abord » (#46). Sert à l'UI à amorcer le sélecteur.
 */
export function pendingSide(progress: ExerciseProgress): Side | null {
  if (progress.sets.length === 0) return null;
  return defaultSide(progress.sets);
}

/** Aujourd'hui en ISO 'YYYY-MM-DD' (timezone locale). */
export function todayIso(): string {
  const d = new Date();
  const z = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

/**
 * La VEILLE d'une date ISO 'YYYY-MM-DD', en ISO. Pur (dérivé de l'argument, pas de
 * `Date.now()`) → testable et déterministe. Le `Date(y, m-1, d)` local gère les
 * débordements de mois/année et le DST (on ne manipule que la partie calendaire).
 */
export function previousDayIso(dateIso: string): string {
  const [y, m, d] = dateIso.split('-').map(Number);
  if (y === undefined || m === undefined || d === undefined) {
    throw new Error(`previousDayIso: date ISO invalide « ${dateIso} »`);
  }
  const prev = new Date(y, m - 1, d - 1);
  const z = (n: number) => String(n).padStart(2, '0');
  return `${prev.getFullYear()}-${z(prev.getMonth() + 1)}-${z(prev.getDate())}`;
}

/** Une heure en ms : un lancement sans aucun set expire au-delà (ADR 0011). */
export const LAUNCH_EXPIRY_MS = 60 * 60 * 1000;

/** Total des séries loggées dans un état (tous exos confondus). */
export function totalLoggedSets(state: CaptureState): number {
  return Object.values(state.progress).reduce((n, p) => n + p.sets.length, 0);
}

/**
 * Un état de capture restauré est-il REPRENABLE (ADR 0011) ? Oui s'il porte au
 * moins une série (séance réellement en cours), ou si son lancement date de moins
 * d'1 h (on vient de démarrer, le chrono tourne légitimement). Un lancement SANS
 * aucun set vieux de plus d'1 h a EXPIRÉ : on ne le reprend pas (le chrono aurait
 * tourné dans le vide), on repropose le lancement. `now` injecté pour les tests.
 */
export function isResumable(state: CaptureState, now = Date.now()): boolean {
  if (totalLoggedSets(state) > 0) return true;
  return now - state.startedAt <= LAUNCH_EXPIRY_MS;
}

/**
 * L'exécution de cet état existe-t-elle DÉJÀ — en base, ou enfilée vers elle ?
 * Vrai si l'état porte une série ou une note datée (toutes deux n'ont pu naître
 * qu'en enfilant l'exécution), si l'exécution du jour a été réhydratée de la
 * base sous le même id, ou si son `upsertExecution` attend encore en outbox.
 *
 * C'est LA question qui garde le chrono (ADR 0011), posée au montage de l'écran.
 * L'ancienne garde était une ref de montage (« aucune op d'exécution enfilée
 * depuis CE montage »), remise à zéro à chaque changement d'onglet : sur une
 * séance de plus d'1 h, la série suivante réancrait `startedAt` et l'upsert
 * réécrivait `started_at` en base — 1 h 30 de séance devenaient 25 min.
 *
 * `pendingOps` : la file de l'outbox (seuls `type` et `id` sont lus, pour ne pas
 * faire dépendre ce module de la forme des ops).
 */
export function isExecutionStarted(
  state: CaptureState,
  hydratedExecutionId: string | null,
  pendingOps: readonly { type: string; id: string }[],
): boolean {
  if (totalLoggedSets(state) > 0) return true;
  if (Object.keys(state.datedNotes).length > 0) return true;
  if (hydratedExecutionId !== null && hydratedExecutionId === state.executionId) return true;
  return pendingOps.some((op) => op.type === 'upsertExecution' && op.id === state.executionId);
}

/**
 * L'état est-il INTACT, tel qu'à l'ouverture d'une séance neuve : rien de
 * saisi (ni série, ni note datée), aucun exo ouvert, passé, ajouté ou remplacé ?
 * C'est la condition pour l'abandonner sans rien perdre de ce que l'utilisateur
 * a fait (adoption tardive d'une exécution trouvée en base, cf. CaptureScreen).
 */
export function isPristine(state: CaptureState): boolean {
  if (state.activeExerciseId !== null) return false;
  if ((state.layout?.length ?? 0) > 0) return false;
  if (Object.keys(state.datedNotes).length > 0) return false;
  return Object.values(state.progress).every((p) => p.sets.length === 0 && !p.skipped);
}

/**
 * Peut-on ADOPTER l'exécution du jour que la base vient de rendre, trop tard
 * pour l'ouverture, à la place de l'exécution provisoire `provisionalExecutionId`
 * sous laquelle la séance s'est ouverte ? Seulement si rien n'a été fait sous
 * l'id provisoire : aucune saisie partie (`isExecutionStarted`), et un tableau
 * intact (`isPristine`).
 *
 * `current` : l'état COURANT du tableau monté, pas sa copie enregistrée. Stockage
 * plein, l'écriture de l'état est refusée : la copie paraissait intacte alors
 * que l'utilisateur avait ouvert un exo ou en avait ajouté un, et l'adoption
 * remontait le tableau en jetant ces gestes. `null` : le tableau n'est pas
 * encore monté, rien n'a donc pu y être fait.
 */
export function canAdoptLateExecution(
  current: CaptureState | null,
  provisionalExecutionId: string,
  pendingOps: readonly OutboxOp[],
): boolean {
  if (current === null) {
    return !pendingOps.some((op) => op.type === 'upsertExecution' && op.id === provisionalExecutionId);
  }
  if (current.executionId !== provisionalExecutionId) return false;
  if (isExecutionStarted(current, null, pendingOps)) return false;
  return isPristine(current);
}

/**
 * Faut-il RÉANCRER le chrono sur le set qu'on logge (ADR 0011) ? Seulement si le
 * lancement a expiré (plus d'1 h) ET que l'exécution n'est pas encore née : un
 * lancement oublié, jamais suivi d'un set. Une séance entamée garde son
 * lancement, quel que soit son âge et quel que soit le nombre de remontages —
 * sa ré-affirmation ne touche plus la ligne (`upsertExecution` est une insertion
 * seule), donc le `started_at` en base reste celui du lancement.
 */
export function shouldReanchorLaunch(
  state: CaptureState,
  executionStarted: boolean,
  now = Date.now(),
): boolean {
  return !executionStarted && now - state.startedAt > LAUNCH_EXPIRY_MS;
}

/**
 * La version de séance dont la Capture doit charger le template : celle de
 * l'exécution ADOPTÉE, pas forcément la version courante (ADR 0021 : une
 * exécution garde sa version de naissance, même si la séance est retouchée en
 * plein entraînement). L'identité et la version se résolvent ensemble, dans
 * l'ordre de priorité de la fusion (`mergeProgress`) :
 *   1. un état local existe : c'est SON exécution qui est adoptée. Sa version
 *      est celle qu'il porte ; à défaut (état persisté avant ce champ), celle de
 *      son `upsertExecution` encore en file ; à défaut, celle de la base si elle
 *      a rendu la MÊME exécution ;
 *   2. pas d'état local : l'exécution ouverte que la base a rendue, donc sa version ;
 *   3. rien de tout cela (séance neuve, ou version inconnue) : la version courante.
 * `pendingOps` : la file d'écritures (seuls `type`, `id` et `seanceVersionId` lus).
 */
export function adoptedVersionId(input: {
  restored: CaptureState | null;
  pendingOps: readonly { type: string; id: string; seanceVersionId?: string }[];
  today: { executionId: string; seanceVersionId: string | null } | null;
  currentVersionId: string;
}): string {
  const { restored, pendingOps, today, currentVersionId } = input;
  if (restored) {
    if (restored.seanceVersionId) return restored.seanceVersionId;
    const queued = pendingOps.find(
      (op) => op.type === 'upsertExecution' && op.id === restored.executionId,
    );
    if (queued?.seanceVersionId) return queued.seanceVersionId;
    if (today && today.executionId === restored.executionId && today.seanceVersionId) {
      return today.seanceVersionId;
    }
    return currentVersionId;
  }
  return today?.seanceVersionId ?? currentVersionId;
}

/**
 * Les versions de séance que portent les états de capture persistés (séances en
 * cours sur l'appareil) : leurs templates ne doivent pas être évincés du cache
 * de lecture, même s'ils ne sont plus ceux de la version courante.
 */
export function persistedVersionIds(): string[] {
  if (typeof localStorage === 'undefined') return [];
  const ids = new Set<string>();
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key === null || !key.startsWith(STORAGE_PREFIX)) continue;
      try {
        const parsed = JSON.parse(localStorage.getItem(key) ?? 'null') as Partial<CaptureState> | null;
        if (typeof parsed?.seanceVersionId === 'string') ids.add(parsed.seanceVersionId);
      } catch {
        // État illisible : rien à en tirer.
      }
    }
  } catch {
    /* no-op */
  }
  return [...ids];
}

/**
 * Résout la séance de capture à reprendre au montage, gérant la FRONTIÈRE MINUIT
 * (bug F10) : une séance ENTAMÉE la veille et NON CLÔTURÉE doit pouvoir être
 * reprise après minuit, sinon elle « disparaît » de l'écran (la clé de cache
 * `sessionId:date` basculait sur `today` au remontage et ne retrouvait plus le
 * cache d'hier).
 *
 * Stratégie, dans l'ordre :
 *   1. cache de `today` présent → on l'adopte tel quel (cas NOMINAL, strictement
 *      inchangé : le repli ci-dessous n'intervient JAMAIS si `today` existe) ;
 *   2. sinon, cache de la VEILLE présent ET non clôturé (`closedAt === null`,
 *      garanti par `loadPersisted`, qui ne restaure jamais une clôture) → on le
 *      reprend en CONSERVANT SA date (la veille), pour que la persistance et les
 *      ops (`performed_on`) continuent de viser la bonne journée ;
 *   3. sinon → capture vierge pour `today` (rien à reprendre, ou veille clôturée
 *      donc rangée — cohérent ADR 0009 : une clôture ne se restaure jamais).
 *
 * `date` est la date ADOPTÉE (today ou la veille) : le composant DOIT l'utiliser
 * partout (clé de persistance, `performedOn`) pour rester cohérent avec `restored`.
 */
export function resolveCaptureDate(
  session: Session,
  today = todayIso(),
): { date: string; restored: CaptureState | null } {
  // On n'adopte un cache que s'il est REPRENABLE (ADR 0011) : un lancement vide de
  // plus d'1 h a expiré (chrono dans le vide) → on l'ignore et on repropose le
  // lancement (capture vierge). Un cache avec des séries, ou un lancement récent,
  // reste repris.
  const fromToday = loadPersisted(session, today);
  if (fromToday && isResumable(fromToday)) return { date: today, restored: fromToday };

  // Rien de reprenable aujourd'hui : une séance d'hier non clôturée se reprend
  // telle quelle (frontière minuit). `loadPersisted` a déjà écarté toute clôture.
  const yesterday = previousDayIso(today);
  const fromYesterday = loadPersisted(session, yesterday);
  if (fromYesterday && isResumable(fromYesterday)) return { date: yesterday, restored: fromYesterday };

  return { date: today, restored: null };
}

export function initialState(
  session: Session,
  date = todayIso(),
  // `startedAt` = instant du LANCEMENT de la séance (ADR 0011), fourni par le
  // caller (le geste « Démarrer »). Défaut « maintenant » pour les tests / appels
  // sans lancement explicite.
  startedAt = Date.now(),
): CaptureState {
  return {
    sessionId: session.id,
    executionId: newId(),
    date,
    startedAt,
    activeExerciseId: null,
    progress: {},
    datedNotes: {},
    closedAt: null,
  };
}

/**
 * Réalisé d'un exo réhydraté depuis la base : ses séries ET l'id RÉEL de chaque
 * ligne `performed_sets` (aligné par index avec `sets`). Cet id réel est ce qui
 * rend une série réhydratée ANNULABLE : `handleUndo` peut enfiler un `deleteSet`
 * qui vise la bonne ligne en base (bug H2/F1 : avant, ces séries portaient `null`
 * et l'annulation restait sans effet en base). Il ne déclenche AUCUN `insertSet`
 * (l'insert n'est enfilé qu'au LOG d'une série neuve, cf. handleLog) : la ligne
 * est déjà en base.
 */
export interface HydratedProgress {
  sets: PerformedSet[];
  /** Id réel (DB) de chaque série, aligné par index avec `sets`. */
  setIds: string[];
}

/**
 * État construit à partir du réalisé persisté en base (Supabase fait foi au
 * reload). `progressByExercise` = séries déjà loggées par exerciseId, AVEC leur
 * id réel (`HydratedProgress`) pour qu'une série réhydratée reste annulable ;
 * `datedNotesByExercise` = notes datées déjà en base (issue #26), par exerciseId,
 * avec leur id réel pour que l'édition vise la bonne ligne. `executionId` est
 * l'id RÉEL de l'exécution du jour quand elle existe en base (à fournir par le
 * caller) ; à défaut un `newId()` (séance neuve, aucune exécution en base) — sans
 * quoi l'UI repartirait sous un id fantôme, décorrélé des séries en base, et les
 * nouvelles ops créeraient une 2ᵉ exécution orpheline (bug H1).
 */
export function hydratedState(
  session: Session,
  progressByExercise: Record<string, HydratedProgress>,
  datedNotesByExercise: Record<string, DatedNoteDraft> = {},
  date = todayIso(),
  executionId = newId(),
  // `startedAt` = lancement de la séance (ADR 0011) : à la REPRISE d'une exécution
  // en base, c'est son `started_at` lu en base (le chrono survit au reload / au
  // multi-appareil) ; pour une séance neuve, l'instant du « Démarrer ». Défaut
  // « maintenant » (cas dégénéré : reprise d'une exécution legacy sans started_at).
  startedAt = Date.now(),
): CaptureState {
  const progress: Record<string, ExerciseProgress> = {};
  for (const [exerciseId, hydrated] of Object.entries(progressByExercise)) {
    // Séries venues de la base : déjà persistées. On porte leur id RÉEL (et non
    // plus `null`) pour qu'une annulation puisse viser la bonne ligne (deleteSet)
    // ; aucun `insertSet` n'en découle (l'insert ne part qu'au log d'une série
    // neuve, jamais d'une réhydratée — cf. handleLog/HydratedProgress).
    if (hydrated.sets.length > 0) {
      progress[exerciseId] = {
        sets: hydrated.sets,
        setIds: [...hydrated.setIds],
        skipped: false,
      };
    }
  }
  return {
    sessionId: session.id,
    executionId,
    date,
    startedAt,
    activeExerciseId: null,
    progress,
    datedNotes: { ...datedNotesByExercise },
    // Le réalisé venu de la base ne porte pas la notion de clôture (locale).
    closedAt: null,
  };
}

/**
 * Réunit deux états « en cours » au montage : `a` = hydraté de la base, `b` =
 * restauré du localStorage (ce que l'appareil a gardé : écritures pas encore
 * synchronisées, survie au background).
 *
 * L'état LOCAL prime pour tout ce qui identifie la séance en cours :
 * `executionId` et `startedAt` (c'est l'exécution que visent les écritures déjà
 * au registre, sinon leur envoi créerait une exécution orpheline, et son
 * lancement est celui qui a réellement été enregistré), version de séance,
 * disposition, et son réalisé (dont les exos passés, que la base ne connaît
 * pas). Les notes datées se réunissent par exo, le local d'abord.
 *
 * Le RÉALISÉ final ne se décide pas ici : l'appelant l'établit par la règle
 * unique (`executionReality`, execution-reality.ts), sur la réponse de la base
 * quand elle a répondu pour cette exécution, sinon sur ce réalisé local. Il
 * n'existe plus de fusion par longueur (« la liste la plus longue gagne »).
 * Pur (aucun React/localStorage).
 */
export function mergeProgress(a: CaptureState, b: CaptureState): CaptureState {
  const progress = b.progress;
  // Notes datées : le LOCAL (b) prime par exo (une saisie offline pas encore
  // synchronisée ne doit pas être écrasée par la base), mais on garde la note de
  // la base (a) pour un exo que le local ne porte pas. Les ids alignés sur
  // b.executionId restent cohérents avec les ops déjà en outbox.
  const datedNotes: CaptureState['datedNotes'] = { ...a.datedNotes, ...b.datedNotes };
  // `closedAt` reste `null` : on ne fusionne QUE des états « en cours ». La clôture
  // est transitoire (ADR 0009) et n'est jamais restaurée — `loadPersisted` (b) la
  // force à null et la base (a) ne la connaît pas. Une séance close a vu son cache
  // nettoyé, donc `mergeProgress` ne s'exécute même pas dessus (fromLocal == null).
  return {
    ...a,
    executionId: b.executionId,
    // La version suit l'exécution : celle de l'état local, comme son id.
    seanceVersionId: b.seanceVersionId ?? a.seanceVersionId,
    // La disposition aussi : seul l'état local la connaît (cf. `layout`).
    layout: b.layout,
    startedAt: b.startedAt,
    // L'exo ouvert aussi : la base ne connaît pas l'écran. L'app tuée par le
    // système en pleine série se rouvre sur l'instrument, pas sur le Sommaire.
    // Un exo absent de la séance rejouée retombe sur le Sommaire au rendu.
    activeExerciseId: b.activeExerciseId,
    progress,
    datedNotes,
    closedAt: null,
  };
}

/**
 * RÉCONCILIE les notes datées locales avec celles que la base vient de rendre
 * pour la MÊME exécution (réponse tardive, tableau déjà monté). Même règle que
 * la fusion au montage (`mergeProgress`) : le LOCAL prime par exo.
 *   - un exo sans note locale ADOPTE celle de la base, avec son id. C'est le cas
 *     d'une note écrite ailleurs (autre appareil, ancien client à id aléatoire)
 *     que l'état local ignorait : sans cela le champ restait vide et la saisie
 *     suivante repartait de rien ;
 *   - un exo qui porte déjà une note locale la GARDE telle quelle, corps vidé
 *     compris (un effacement est une édition) : la saisie de l'utilisateur ne
 *     bouge pas sous ses doigts ;
 * `base` est la lecture de la base APRÈS application des écritures de notes
 * locales qu'elle ne contient pas (`datedNotesReality`, execution-reality.ts) :
 * une note dont l'effacement attend, ou a été acquitté pendant le trajet de la
 * lecture, n'y figure plus et n'est donc pas réadoptée.
 * Rend `local` lui-même quand rien n'est adopté. Pur.
 */
export function reconcileDatedNotes(
  local: Record<string, DatedNoteDraft>,
  base: Record<string, DatedNoteDraft>,
): Record<string, DatedNoteDraft> {
  let next: Record<string, DatedNoteDraft> | null = null;
  for (const [exerciseId, note] of Object.entries(base)) {
    if (local[exerciseId] !== undefined) continue;
    next ??= { ...local };
    next[exerciseId] = { id: note.id, body: note.body };
  }
  return next ?? local;
}

/**
 * L'ÉTAT DU TABLEAU À SON MONTAGE : ce que la base a hydraté (`hydrated`), ce que
 * l'appareil a gardé (`restored`), et LE RÉALISÉ établi par la règle unique
 * (execution-reality.ts) : une lecture, puis les écritures locales qu'elle ne
 * contient pas.
 *
 * La lecture est la réponse de la base (`read`) quand elle a répondu pour
 * l'exécution que le tableau adopte : une série supprimée ailleurs n'y revient
 * pas, une série écrite ailleurs y entre. Sinon (`read` nul : hors ligne, délai
 * dépassé) c'est le réalisé gardé par l'appareil, avec l'estampille de son
 * enregistrement (`restored.asOf`). Dans les deux cas une série ajoutée depuis
 * le Journal et pas encore envoyée entre au tableau, et son rang est pris.
 *
 * `writesSince` : le lecteur du registre d'écritures (outbox.ts), `asOf` :
 * l'estampille du registre au même instant, gardée dans l'état. Pur.
 */
export function openingState(input: {
  hydrated: CaptureState;
  restored: CaptureState | null;
  read: { progress: Record<string, HydratedProgress>; datedNotes: Record<string, DatedNoteDraft>; stamp: ReadStamp } | null;
  writesSince: (stamp: ReadStamp | null) => readonly LocalWrite[];
  asOf: ReadStamp;
}): CaptureState {
  const { hydrated, restored, read } = input;
  const merged = restored ? mergeProgress(hydrated, restored) : hydrated;
  const writes = input.writesSince(read ? read.stamp : (restored?.asOf ?? null));
  const reality = executionReality({
    executionId: merged.executionId,
    read: read ? read.progress : merged.progress,
    writes,
    skipped: new Set(
      Object.entries(merged.progress)
        .filter(([, entry]) => entry.skipped)
        .map(([exerciseId]) => exerciseId),
    ),
  });
  // Les notes datées, sous la même règle ; une note locale prime par exo.
  const datedNotes = reconcileDatedNotes(
    restored?.datedNotes ?? {},
    datedNotesReality(merged.executionId, read ? read.datedNotes : hydrated.datedNotes, writes),
  );
  return { ...withReconciledProgress(merged, reality), datedNotes, asOf: input.asOf };
}

/** Adopte un réalisé établi par `executionReality`, et garde les exos remplacés qui ont une série. */
export function withReconciledProgress(state: CaptureState, progress: CaptureState['progress']): CaptureState {
  const layout = state.layout;
  let corrected: LayoutEdit[] | undefined;
  if (layout) {
    // Un exo réajouté depuis son remplacement a déjà sa place. Seul son
    // dernier retrait peut encore le masquer, même après plusieurs échanges.
    const restored = new Set<string>();
    for (let i = layout.length - 1; i >= 0; i--) {
      const edit: LayoutEdit = layout[i]!;
      const target = edit.replaces;
      if (target && !edit.keepsReplaced && !restored.has(target) && progress[target]?.sets.length) {
        corrected ??= layout.slice();
        corrected[i] = { ...edit, keepsReplaced: true };
      }
      restored.add(edit.exerciseId);
    }
  }
  if (!corrected && state.progress === progress) return state;
  return { ...state, progress, ...(corrected && { layout: corrected }) };
}

export function captureReducer(state: CaptureState, action: CaptureAction): CaptureState {
  switch (action.type) {
    case 'open-exercise':
      return { ...state, activeExerciseId: action.exerciseId };

    case 'back-to-picker':
      return { ...state, activeExerciseId: null };

    case 'log-set': {
      const prev = getProgress(state, action.exerciseId);
      // Order partagé par G/D d'une même série unilatérale (cf. nextSetOrder) ;
      // simple incrément pour le bilatéral.
      const nextSet: PerformedSet = {
        ...action.set,
        order: nextSetOrder(prev, action.set.side),
      };
      return {
        ...state,
        progress: {
          ...state.progress,
          [action.exerciseId]: {
            sets: [...prev.sets, nextSet],
            setIds: [...prev.setIds, action.setId],
            skipped: false,
          },
        },
      };
    }

    case 'set-dated-note':
      return {
        ...state,
        datedNotes: {
          ...state.datedNotes,
          [action.exerciseId]: { id: action.noteId, body: action.body },
        },
      };

    case 'undo-last-set': {
      const prev = getProgress(state, action.exerciseId);
      if (prev.sets.length === 0) return state;
      return {
        ...state,
        progress: {
          ...state.progress,
          [action.exerciseId]: {
            ...prev,
            sets: prev.sets.slice(0, -1),
            setIds: prev.setIds.slice(0, -1),
          },
        },
      };
    }

    case 'correct-set': {
      const prev = getProgress(state, action.exerciseId);
      const index = prev.setIds.indexOf(action.setId);
      const current = index === -1 ? undefined : prev.sets[index];
      if (current === undefined) return state;
      const sets = prev.sets.slice();
      sets[index] = { ...current, ...action.values };
      return {
        ...state,
        progress: { ...state.progress, [action.exerciseId]: { ...prev, sets } },
      };
    }

    case 'change-set-side': {
      const prev = getProgress(state, action.exerciseId);
      const index = prev.setIds.indexOf(action.setId);
      const current = index === -1 ? undefined : prev.sets[index];
      if (current === undefined) return state;
      const sets = prev.sets.slice();
      sets[index] = { ...current, side: action.side };
      return {
        ...state,
        progress: { ...state.progress, [action.exerciseId]: { ...prev, sets } },
      };
    }

    case 'delete-set': {
      const prev = getProgress(state, action.exerciseId);
      const index = prev.setIds.indexOf(action.setId);
      if (prev.sets[index] === undefined) return state;
      // Les ids suivent leurs séries : on renumérote des paires (série, id).
      const before = prev.sets.map((set, i) => ({ ...set, id: prev.setIds[i] ?? null }));
      const removed = logicalSetRows(before, index);
      const rows = ranksAfterDeletion(before, removed);
      return {
        ...state,
        progress: {
          ...state.progress,
          [action.exerciseId]: {
            ...prev,
            sets: rows.map(({ id: _id, ...set }) => set),
            setIds: rows.map((row) => row.id),
          },
        },
      };
    }

    case 'skip-exercise': {
      const prev = getProgress(state, action.exerciseId);
      return {
        ...state,
        activeExerciseId: null,
        progress: {
          ...state.progress,
          [action.exerciseId]: { ...prev, skipped: true },
        },
      };
    }

    case 'unskip-exercise': {
      const prev = getProgress(state, action.exerciseId);
      return {
        ...state,
        progress: {
          ...state.progress,
          [action.exerciseId]: { ...prev, skipped: false },
        },
      };
    }

    case 'reconcile-progress': {
      // LA règle du réalisé (execution-reality.ts) : la lecture de la base, puis
      // les écritures locales qu'elle ne contient pas, colonne par colonne. Ce
      // que l'utilisateur a saisi, corrigé ou supprimé pendant le trajet de la
      // lecture est au registre, en attente ou acquitté depuis : rien d'autre
      // n'est à lui rappeler.
      const skipped = new Set(
        Object.entries(state.progress)
          .filter(([, progress]) => progress.skipped)
          .map(([exerciseId]) => exerciseId),
      );
      const progress = executionReality({
        executionId: state.executionId,
        read: action.base,
        writes: action.writes,
        skipped,
      });
      return {
        ...withReconciledProgress(state, progress),
        ...(action.asOf !== undefined ? { asOf: action.asOf } : {}),
        datedNotes: action.datedNotes
          ? reconcileDatedNotes(
              state.datedNotes,
              datedNotesReality(state.executionId, action.datedNotes, action.writes),
            )
          : state.datedNotes,
      };
    }

    case 'forget-sets': {
      const progress = withoutSets(state.progress, action.setIds);
      return progress === state.progress ? state : { ...state, progress };
    }

    case 'edit-layout': {
      const { edit } = action;
      const started = edit.replaces && state.progress[edit.replaces]?.sets.length;
      return { ...state, layout: [...(state.layout ?? []), started ? { ...edit, keepsReplaced: true } : edit] };
    }

    case 'close':
      // Fige la clôture EN MÉMOIRE. Tout le reste (réalisé, ids) est conservé : le
      // récap de fin se lit dans la foulée immédiate. Au remontage, rien ne
      // revient (le cache a été nettoyé) — la clôture est transitoire (ADR 0009).
      return { ...state, closedAt: action.closedAt };

    case 'set-started-at':
      // Réancre le chrono (ADR 0011, expiration d'un lancement) : on ne touche QUE
      // `startedAt`, le réalisé et l'exécution restent intacts.
      return { ...state, startedAt: action.startedAt };

    default:
      return state;
  }
}

// --- Persistance « survit au background » -----------------------------------
// L'exécution en cours est sauvée en localStorage et restaurée au montage.

/** Préfixe des clés d'état de capture : `croustylift:capture:<séance>:<date>`. */
export const STORAGE_PREFIX = CAPTURE_STATE_PREFIX;

function storageKey(sessionId: string, date: string): string {
  return `${STORAGE_PREFIX}${sessionId}:${date}`;
}

/**
 * Normalise le `progress` lu du cache : garantit un `setIds` aligné avec `sets`
 * (un cache d'ancien format n'en avait pas → on remplit de `null`, ces séries
 * passent pour « déjà connues localement », pas de mutation outbox dessus).
 */
function normalizeProgress(raw: unknown): Record<string, ExerciseProgress> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, ExerciseProgress> = {};
  for (const [exerciseId, value] of Object.entries(raw as Record<string, unknown>)) {
    const p = value as Partial<ExerciseProgress>;
    const sets = Array.isArray(p?.sets) ? p.sets : [];
    const ids = Array.isArray(p?.setIds) ? p.setIds : [];
    out[exerciseId] = {
      sets,
      // Aligne la longueur : complète les ids manquants par `null`.
      setIds: sets.map((_, i) => (typeof ids[i] === 'string' ? (ids[i] as string) : null)),
      skipped: Boolean(p?.skipped),
    };
  }
  return out;
}

/**
 * Normalise les notes datées lues du cache : ne garde que les entrées bien
 * formées (id + body en chaîne). Un cache d'ancien format (sans datedNotes) ->
 * objet vide.
 */
function normalizeDatedNotes(raw: unknown): Record<string, DatedNoteDraft> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, DatedNoteDraft> = {};
  for (const [exerciseId, value] of Object.entries(raw as Record<string, unknown>)) {
    const n = value as Partial<DatedNoteDraft>;
    if (typeof n?.id === 'string' && typeof n?.body === 'string') {
      out[exerciseId] = { id: n.id, body: n.body };
    }
  }
  return out;
}

/**
 * Normalise la disposition lue du cache : ne garde que les gestes bien formés
 * (un remplacement sans cible n'est pas rejouable). Absente ou vide : pas de champ.
 */
function normalizeLayout(raw: unknown): { layout?: LayoutEdit[] } {
  if (!Array.isArray(raw)) return {};
  const layout: LayoutEdit[] = [];
  for (const value of raw) {
    if (!value || typeof value !== 'object') continue;
    const e = value as Partial<LayoutEdit>;
    if (e.kind !== 'added' && e.kind !== 'swapped') continue;
    if (typeof e.exerciseId !== 'string' || typeof e.name !== 'string') continue;
    if (e.kind === 'swapped' && typeof e.replaces !== 'string') continue;
    layout.push({
      kind: e.kind,
      exerciseId: e.exerciseId,
      name: e.name,
      unilateral: e.unilateral === true,
      primaryMuscles: Array.isArray(e.primaryMuscles)
        ? e.primaryMuscles.filter((m): m is string => typeof m === 'string')
        : [],
      ...(e.kind === 'swapped' ? { replaces: e.replaces } : {}),
      ...(e.kind === 'swapped' && e.keepsReplaced === true ? { keepsReplaced: true as const } : {}),
    });
  }
  return layout.length > 0 ? { layout } : {};
}

/** Charge l'exécution persistée pour cette séance/jour, ou null si rien/invalide. */
export function loadPersisted(session: Session, date: string): CaptureState | null {
  if (typeof localStorage === 'undefined') return null;
  // À partir d'ici, un abandon fait dans un autre onglet concerne cette page.
  listenToOtherTabs();
  try {
    const raw = localStorage.getItem(storageKey(session.id, date));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CaptureState> & { ownerId?: unknown };
    if (parsed.sessionId !== session.id || parsed.date !== date) return null;
    // État persisté par un AUTRE compte (audit sécurité, constat 1) : ce n'est pas
    // la capture de celui que l'appareil reconnaît. Il n'est pas restauré, et pas
    // effacé non plus (son compte le retrouvera). Sans `ownerId` (ancien format),
    // l'état est tenu pour celui du compte reconnu.
    if (typeof parsed.ownerId === 'string' && parsed.ownerId !== loadLocalAccount()?.userId) {
      return null;
    }
    return {
      sessionId: session.id,
      // CONSERVE l'executionId persisté : un log offline et son upsert d'exécution
      // doivent garder le même id à la restauration. Cache pré-executionId (ancien
      // format) : on en forge un neuf pour ne pas casser la session restaurée.
      executionId: typeof parsed.executionId === 'string' ? parsed.executionId : newId(),
      ...(typeof parsed.seanceVersionId === 'string'
        ? { seanceVersionId: parsed.seanceVersionId }
        : {}),
      date,
      // CONSERVE le startedAt persisté (la durée survit au background). Si une
      // session pré-startedAt traînait en cache, on retombe sur « maintenant ».
      startedAt:
        typeof parsed.startedAt === 'number' && Number.isFinite(parsed.startedAt)
          ? parsed.startedAt
          : Date.now(),
      activeExerciseId:
        typeof parsed.activeExerciseId === 'string' ? parsed.activeExerciseId : null,
      progress: normalizeProgress(parsed.progress),
      datedNotes: normalizeDatedNotes(parsed.datedNotes),
      ...normalizeLayout(parsed.layout),
      ...(typeof parsed.asOf === 'number' && Number.isFinite(parsed.asOf) ? { asOf: parsed.asOf } : {}),
      // NE RESTAURE JAMAIS la clôture (ADR 0009 : clôture transitoire). On ne
      // restaure que l'état d'une séance EN COURS (offline : ne pas perdre les
      // séries loggées sur un reload). Le câblage de persistance nettoie d'ailleurs
      // le cache dès qu'une séance est close, donc `closedAt` y vaut toujours null
      // en pratique ; on le force ici pour que repartir vierge ne tienne pas au
      // hasard d'un vieux cache. Un cache pré-ADR portant un `closedAt` est ignoré.
      closedAt: null,
    };
  } catch {
    return null;
  }
}

/** La dernière sauvegarde de l'état de capture a-t-elle été refusée par le stockage ? */
let persistFailing = false;

/**
 * Vrai tant que l'état de capture en cours n'a pas pu être écrit sur l'appareil
 * (stockage plein) : il ne tient qu'en mémoire et ne survivrait pas à la
 * fermeture de l'app. La bannière de synchro le dit.
 */
export function capturePersistFailing(): boolean {
  return persistFailing;
}

/**
 * L'état de capture que le stockage a refusé, RETENU en mémoire tel qu'il devait
 * être écrit. Sans cela il n'existait que dans le tableau monté : un exo ajouté
 * à la séance n'alimente pas la file d'écritures, donc rien ne signalait qu'un
 * rechargement (mise à jour de l'app au changement d'onglet) allait le détruire,
 * et quitter la Capture le perdait sans nouvel essai. Retenu, il peut être
 * réécrit plus tard (`retryPersistCaptureState`) et retient le rechargement
 * tant qu'il ne l'est pas (`hasUnpersistedCaptureState`, pwa/reload-guards).
 *
 * Levé dès que l'état est écrit, que sa séance est close, annulée ou supprimée,
 * ou que le compte est purgé.
 */
let unsaved: {
  key: string;
  value: string;
  date: string;
  executionId: string;
  exerciseIds: string[];
} | null = null;

function forgetUnsaved(): void {
  unsaved = null;
  persistFailing = false;
}

/**
 * Un état de capture ne tient-il qu'en mémoire, faute d'avoir pu être écrit ?
 * Borné dans le temps : un état d'avant la veille de `today` n'est plus
 * reprenable (`resolveCaptureDate`), il ne retient donc plus rien. Sans cette
 * borne, un stockage resté plein sur une séance jamais close retiendrait la
 * mise à jour de l'app sans fin.
 */
export function hasUnpersistedCaptureState(today: string = todayIso()): boolean {
  return unsaved !== null && unsaved.date >= previousDayIso(today);
}

/**
 * Retente d'écrire l'état de capture retenu en mémoire (l'utilisateur a pu
 * libérer de la place). Rend vrai s'il n'y a plus rien de retenu en sortie.
 */
export function retryPersistCaptureState(): boolean {
  if (unsaved === null) return true;
  if (typeof localStorage === 'undefined') return false;
  const { key, value, exerciseIds } = unsaved;
  const written = writeMakingRoom(() => {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }, exerciseIds);
  if (written) forgetUnsaved();
  return written;
}

/** Le réalisé sans les séries `setIds` ; le même objet si aucune n'y figure. */
function withoutSets<P extends { sets: unknown[]; setIds: readonly (string | null)[] }>(
  progress: Record<string, P>,
  setIds: readonly string[],
): Record<string, P> {
  const gone = new Set(setIds);
  let next: Record<string, P> | null = null;
  for (const [exerciseId, entry] of Object.entries(progress)) {
    if (!Array.isArray(entry?.setIds) || !Array.isArray(entry.sets)) continue;
    const stays = entry.setIds.map((id) => id === null || !gone.has(id));
    if (stays.every(Boolean)) continue;
    next ??= { ...progress };
    next[exerciseId] = {
      ...entry,
      sets: entry.sets.filter((_, i) => stays[i] ?? true),
      setIds: entry.setIds.filter((_, i) => stays[i]),
    };
  }
  return next ?? progress;
}

/** Canal par lequel les autres onglets apprennent un abandon. */
export const SETS_ABANDONED_CHANNEL = 'croustylift:sets-abandoned';

// Les séries abandonnées depuis que cette page est ouverte, ici ou dans un
// autre onglet, et ceux qui veulent le savoir. Retenues : un tableau qui lit
// son état AVANT l'abandon et ne se monte qu'après l'apprend en s'abonnant.
const abandonedSets = new Set<string>();
const abandonListeners = new Set<(setIds: string[]) => void>();
let abandonChannel: BroadcastChannel | null = null;

function announceAbandoned(ids: unknown): void {
  if (!Array.isArray(ids)) return;
  const setIds = ids.filter((id): id is string => typeof id === 'string');
  for (const id of setIds) abandonedSets.add(id);
  for (const listener of [...abandonListeners]) listener(setIds);
}

/** Ouvre, une fois, l'écoute des abandons faits dans les autres onglets. */
function listenToOtherTabs(): BroadcastChannel | null {
  if (abandonChannel === null && typeof BroadcastChannel !== 'undefined') {
    abandonChannel = new BroadcastChannel(SETS_ABANDONED_CHANNEL);
    abandonChannel.onmessage = (event) => announceAbandoned(event.data);
    // Hors navigateur (tests), ce canal ne doit pas retenir le processus.
    (abandonChannel as unknown as { unref?: () => void }).unref?.();
  }
  return abandonChannel;
}

/**
 * S'abonne aux séries abandonnées (`forgetAbandonedSets`), d'où qu'elles
 * viennent : cet onglet ou un autre. Un tableau monté dans un autre onglet
 * gardait la série en mémoire, et son prochain geste la réécrivait dans l'état
 * gardé par l'appareil. `listener` reçoit d'abord celles déjà abandonnées
 * depuis l'ouverture de la page. Rend la fonction de désabonnement.
 */
export function onSetsAbandoned(listener: (setIds: string[]) => void): () => void {
  listenToOtherTabs();
  abandonListeners.add(listener);
  if (abandonedSets.size > 0) listener([...abandonedSets]);
  return () => {
    abandonListeners.delete(listener);
  };
}

/**
 * Des écritures viennent d'être ABANDONNÉES dans la feuille des saisies
 * refusées (`abandonRefused`, outbox.ts) : les séries dont la CRÉATION en fait
 * partie n'existeront jamais en base. Le registre ne les porte plus ; l'état de
 * capture, lui, les avait prises au moment du geste, et les gardait jusqu'à la
 * prochaine réponse de la base : hors ligne, elles restaient au tableau. Elles
 * sont retirées ici de tout état gardé par l'appareil (une écriture qui ne
 * grandit pas : elle passe même stockage plein) et les tableaux montés sont
 * prévenus, dans tous les onglets (`onSetsAbandoned`, action `forget-sets`).
 *
 * Une série RÉÉCRITE (`rewrites` : elle existait avant l'écriture abandonnée,
 * édition depuis le Journal) n'est pas retirée : elle est toujours en base.
 */
export function forgetAbandonedSets(ops: readonly OutboxOp[]): void {
  const setIds = ops.flatMap((op) => (op.type === 'insertSet' && !op.rewrites ? [op.id] : []));
  if (setIds.length === 0) return;
  const scrub = (raw: string): string | null => {
    try {
      const parsed = JSON.parse(raw) as { progress?: Record<string, ExerciseProgress> } | null;
      if (!parsed || typeof parsed.progress !== 'object' || parsed.progress === null) return null;
      const progress = withoutSets(parsed.progress, setIds);
      return progress === parsed.progress ? null : JSON.stringify({ ...parsed, progress });
    } catch {
      return null; // Illisible : rien à y retirer.
    }
  };
  if (unsaved !== null) unsaved = { ...unsaved, value: scrub(unsaved.value) ?? unsaved.value };
  if (typeof localStorage !== 'undefined') {
    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key === null || !key.startsWith(STORAGE_PREFIX)) continue;
        const next = scrub(localStorage.getItem(key) ?? '');
        if (next !== null) localStorage.setItem(key, next);
      }
    } catch {
      /* no-op : les tableaux montés, eux, sont prévenus juste après */
    }
  }
  announceAbandoned(setIds);
  listenToOtherTabs()?.postMessage(setIds);
}

/**
 * Les exos qu'un état de capture porte : ceux de sa disposition (ajoutés ou
 * remplaçants, absents du template), ceux qui ont du réalisé, et l'exo ouvert.
 */
function captureStateExerciseIds(state: CaptureState): string[] {
  return [
    ...(state.layout ?? []).map((edit) => edit.exerciseId),
    ...Object.keys(state.progress),
    ...(state.activeExerciseId ? [state.activeExerciseId] : []),
  ];
}

export function persist(state: CaptureState): void {
  if (typeof localStorage === 'undefined') return;
  // Exécution supprimée depuis le Journal : la Salle cachée qui la tenait encore
  // ne réécrit pas l'état effacé (written-elsewhere.ts), sinon son retour
  // reprendrait la séance supprimée.
  if (isExecutionRetired(state.executionId)) return;
  // `ownerId` : le compte reconnu sur l'appareil, pour ne jamais restaurer la
  // capture d'un compte sous un autre (cf. `loadPersisted`).
  const ownerId = loadLocalAccount()?.userId;
  const key = storageKey(state.sessionId, state.date);
  const value = JSON.stringify(ownerId ? { ...state, ownerId } : state);
  const write = (): boolean => {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  };
  // Quota plein : les copies de lecture NON ESSENTIELLES cèdent la place (cf.
  // cache-eviction : jamais celles du chemin d'ouverture de la Capture), puis
  // nouvel essai. Si rien n'y fait, la capture reste en mémoire et le refus est
  // signalé (bannière), au lieu de l'ancienne dégradation muette. Les exos de
  // CET état ne cèdent jamais leurs copies : c'est souvent l'ajout d'un exo qui
  // déclenche l'éviction, avant même que sa disposition soit sur l'appareil.
  const exerciseIds = captureStateExerciseIds(state);
  persistFailing = !writeMakingRoom(write, exerciseIds);
  // Refusé : l'état est retenu tel qu'il devait être écrit (cf. `unsaved`).
  unsaved = persistFailing
    ? { key, value, date: state.date, executionId: state.executionId, exerciseIds }
    : null;
}

export function clearPersisted(session: Session, date: string): void {
  // La séance est close ou abandonnée : ses exos n'ont plus à être protégés de
  // l'éviction (cf. cache-eviction).
  forgetEntrustedExercises();
  // Ni à être réécrits : l'état retenu en mémoire, s'il est le sien, est levé.
  if (unsaved?.key === storageKey(session.id, date)) forgetUnsaved();
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(storageKey(session.id, date));
  } catch {
    /* no-op */
  }
}

/**
 * Efface l'état de capture persisté qui porte CETTE exécution, quelle que soit sa
 * séance ou sa date. Sert à la suppression d'une exécution depuis le journal :
 * la Capture n'est alors pas montée pour nettoyer son propre état, et un état
 * restauré prime sur la base à la réhydratation (`mergeProgress`), donc la série
 * suivante recréerait l'exécution supprimée sous le même id. Même geste que la
 * Clôture et l'Annulation (`clearPersisted`), ciblé par id d'exécution.
 */
export function clearPersistedExecution(executionId: string): void {
  if (unsaved?.executionId === executionId) forgetUnsaved();
  if (typeof localStorage === 'undefined') return;
  try {
    // Collecte avant suppression : retirer en itérant décale les index.
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key === null || !key.startsWith(STORAGE_PREFIX)) continue;
      try {
        const parsed = JSON.parse(localStorage.getItem(key) ?? 'null') as Partial<CaptureState> | null;
        if (parsed?.executionId === executionId) keys.push(key);
      } catch {
        // État illisible : pas le nôtre à juger ici, `loadPersisted` l'ignore déjà.
      }
    }
    for (const key of keys) localStorage.removeItem(key);
  } catch {
    /* no-op */
  }
}

/**
 * Purge TOUT l'état de capture persisté (toutes sessions/jours confondus) en
 * supprimant chaque clé `croustylift:capture:*`. Sert à la déconnexion : sur un
 * appareil partagé, le réalisé loggé ne doit pas rester lisible en clair après
 * le départ de l'utilisateur. Ne touche QUE le préfixe capture (l'outbox et le
 * reste du storage sont purgés ailleurs).
 */
export function clearCaptureState(): void {
  forgetUnsaved();
  if (typeof localStorage === 'undefined') return;
  try {
    // Collecte avant suppression : retirer en itérant décale les index.
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key !== null && key.startsWith(STORAGE_PREFIX)) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
  } catch {
    /* no-op */
  }
}

/**
 * Purge l'état de capture du compte reconnu (et les états sans compte, d'un
 * ancien format), et eux seuls : la capture en cours d'un AUTRE compte, dont les
 * écritures attendent encore sur l'appareil, reste pour son retour. C'est la
 * purge de la Déconnexion ; `clearCaptureState` reste celle du forçage.
 */
export function clearOwnCaptureState(): void {
  // L'état retenu en mémoire est celui de la séance en cours du compte reconnu.
  forgetUnsaved();
  if (typeof localStorage === 'undefined') return;
  try {
    const owner = loadLocalAccount()?.userId;
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key === null || !key.startsWith(STORAGE_PREFIX)) continue;
      let ownerId: unknown;
      try {
        ownerId = (JSON.parse(localStorage.getItem(key) ?? 'null') as { ownerId?: unknown } | null)
          ?.ownerId;
      } catch {
        ownerId = undefined; // État illisible : à personne, il part.
      }
      if (typeof ownerId !== 'string' || ownerId === owner) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
  } catch {
    /* no-op */
  }
}

/**
 * Retire les états de capture devenus IRRÉCUPÉRABLES : ceux d'avant la veille de
 * `today`. La reprise ne regarde que le jour même et la veille
 * (`resolveCaptureDate`) ; au-delà, l'état d'une séance oubliée sans clôture
 * n'était plus jamais lu ni purgé, et restait en clair sur l'appareil. Ses
 * écritures ne sont pas concernées : elles vivent dans l'outbox. Seuls les états
 * du compte reconnu (ou sans compte) partent ; ceux d'un autre compte restent.
 * Appelée une fois par lancement de l'app, à l'arrivée en Capture.
 */
export function pruneStaleCaptureStates(today = todayIso()): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const oldestKept = previousDayIso(today);
    const owner = loadLocalAccount()?.userId;
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key === null || !key.startsWith(STORAGE_PREFIX)) continue;
      // Clé : `croustylift:capture:<séance>:<AAAA-MM-JJ>`.
      const date = key.slice(key.lastIndexOf(':') + 1);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date >= oldestKept) continue;
      let ownerId: unknown;
      try {
        ownerId = (JSON.parse(localStorage.getItem(key) ?? 'null') as { ownerId?: unknown } | null)
          ?.ownerId;
      } catch {
        ownerId = undefined;
      }
      if (typeof ownerId !== 'string' || ownerId === owner) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
  } catch {
    /* no-op */
  }
}
