// État de la capture : l'Exécution en cours d'une séance, + reducer + persistance.
// Pas de Supabase cette passe — l'état vit en mémoire et survit au background via localStorage.
import type { PerformedSet, Side } from '../../domain/types';
import { defaultSide, nextOrderForSide } from '../../domain/unilateral';
import type { Session } from './fixtures';
import { loadLocalAccount } from '../../lib/local-account';
import { clearReadCache } from '../../lib/read-cache';

/** Statut d'un exercice dans l'exécution courante (dérivable, mais pratique à porter). */
export type ExerciseStatus = 'todo' | 'in-progress' | 'done' | 'skipped';

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
}

export type CaptureAction =
  | { type: 'open-exercise'; exerciseId: string }
  | { type: 'back-to-picker' }
  // `setId` est l'UUID client de la série (cf. ADR 0003) : fourni par le caller
  // pour que l'état local et l'op d'outbox partagent EXACTEMENT le même id.
  | { type: 'log-set'; exerciseId: string; setId: string; set: Omit<PerformedSet, 'order'> }
  | { type: 'undo-last-set'; exerciseId: string }
  // Note datée d'un exo (issue #26). `noteId` = UUID client de la ligne
  // `dated_notes`, fourni par le caller pour que l'état et l'op d'outbox visent
  // la même ligne. Un `body` vide est conservé tel quel dans l'état ; c'est la
  // couche data (datedNoteOutboxOp) qui traduit « vide » en suppression.
  | { type: 'set-dated-note'; exerciseId: string; noteId: string; body: string }
  | { type: 'skip-exercise'; exerciseId: string }
  | { type: 'unskip-exercise'; exerciseId: string }
  // Réponse TARDIVE de la base pour l'exécution en cours (ouverture bornée à
  // 3 s) : le réalisé est réconcilié par identifiant (cf. `reconcileProgress`).
  // Rien d'autre ne bouge : exo ouvert, disposition, notes, chrono.
  | {
      type: 'reconcile-progress';
      base: Record<string, HydratedProgress>;
      pendingSetIds: string[];
      knownAtDeparture: string[];
    }
  // Geste d'édition de la séance (exo ajouté ou remplacé), ajouté au journal.
  | { type: 'edit-layout'; edit: LayoutEdit }
  // `executionId` : nouvelle exécution (UUID client) pour la séance neuve.
  | { type: 'reset'; executionId: string }
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

export function statusOf(progress: ExerciseProgress, prescribedMin: number): ExerciseStatus {
  if (progress.skipped) return 'skipped';
  if (progress.sets.length === 0) return 'todo';
  if (progress.sets.length >= prescribedMin) return 'done';
  return 'in-progress';
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
 * Fusionne deux états « en cours » au montage : `a` = hydraté de Supabase (fait
 * foi au reload), `b` = restauré du localStorage (filet offline : écriture pas
 * encore synchronisée, survie au background). Pour le RÉALISÉ, cette fusion par
 * longueur n'est que le repli sans réponse de la base : quand elle a répondu
 * pour la même exécution, l'appelant remplace le réalisé fusionné par
 * `reconcileProgress` (la base fait foi, plus les écritures en attente).
 * Pour chaque exo on garde le réalisé
 * le plus avancé, ET on aligne les `setIds` index par index pour qu'AUCUNE série
 * affichée ne reste sans id annulable (bug H2/F1) :
 *   - longueurs différentes → on garde la source la plus longue (le réalisé le
 *     plus avancé), mais on COMPLÈTE chaque id manquant par celui de l'autre
 *     source au même index (la base porte l'id réel, le local l'id client) ;
 *   - chaque série affichée porte ainsi un id (réel OU client) → `handleUndo` peut
 *     toujours enfiler un `deleteSet`.
 * `b` prime pour `executionId` et `startedAt` : c'est l'exécution EN COURS, celle
 * que visent les ops déjà en outbox (sinon le rejeu créerait une exécution
 * orpheline), et son `startedAt` est le lancement réel persisté (la durée
 * chronométrée survit au background). Pur (aucun React/localStorage) → testable.
 */
export function mergeProgress(a: CaptureState, b: CaptureState): CaptureState {
  const ids = new Set([...Object.keys(a.progress), ...Object.keys(b.progress)]);
  const progress: CaptureState['progress'] = {};
  for (const id of ids) {
    const pa = a.progress[id];
    const pb = b.progress[id];
    // `id` vient de l'union des clés des deux états : au moins une source existe.
    // On préserve l'ordre exact (a seul, b seul, ou fusion) ; le cas « ni l'un ni
    // l'autre » est inatteignable et n'écrit simplement rien.
    if (pa && pb) progress[id] = mergeExerciseProgress(pa, pb);
    else if (pa) progress[id] = pa;
    else if (pb) progress[id] = pb;
  }
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
    progress,
    datedNotes,
    closedAt: null,
  };
}

/**
 * RÉCONCILIE le réalisé local avec celui que la base vient de rendre pour la
 * MÊME exécution : la base fait foi pour les séries, et les écritures locales
 * encore en attente s'appliquent par-dessus, PAR IDENTIFIANT. C'est la règle de
 * toute reprise où la base a répondu ; `mergeProgress` (« la liste la plus
 * longue gagne ») ne reste que le repli quand elle n'a pas répondu (hors ligne).
 *
 * Avec la seule fusion par longueur, une série supprimée depuis le Journal
 * (suppression acquittée) revenait en Capture, le cache local étant plus long
 * que la base ; et une série écrite ailleurs n'entrait que si la base devenait
 * la plus longue.
 *
 * Par exo, le résultat est :
 *   - les séries de la BASE (déjà purgées des suppressions en attente, cf.
 *     `withoutPendingDeletions` côté data) ;
 *   - plus les séries LOCALES inconnues de la base dont l'insertion attend
 *     encore (`pendingSetIds` : la file lue avant et après la lecture réseau).
 *     Une série locale que la base n'a pas et que rien n'attend a été supprimée
 *     ailleurs : elle sort ;
 *   - une série locale sans id (cache d'ancien format) reste si la base n'a
 *     rien au même rang et au même côté.
 * `skipped` vient du local (la base ne le connaît pas).
 *
 * RÉPONSE TARDIVE (`knownAtDeparture`) : appliquée à un tableau déjà monté,
 * elle décrit la base au DÉPART de la lecture, alors que l'utilisateur a pu
 * saisir depuis. `knownAtDeparture` liste les séries que l'état local portait à
 * ce départ : une série locale qui n'y est pas a été loggée pendant le trajet,
 * elle est gardée quoi que dise la réponse ; une série de la réponse qui y était
 * mais que l'état local n'a plus a été annulée pendant le trajet, elle ne
 * revient pas. Pur.
 */
export function reconcileProgress(
  local: Record<string, ExerciseProgress>,
  base: Record<string, HydratedProgress>,
  options: { pendingSetIds: readonly string[]; knownAtDeparture?: readonly string[] | null },
): Record<string, ExerciseProgress> {
  const pending = new Set(options.pendingSetIds);
  const known = options.knownAtDeparture ? new Set(options.knownAtDeparture) : null;
  const localIds = new Set<string>();
  for (const p of Object.values(local)) {
    for (const id of p.setIds) if (id !== null) localIds.add(id);
  }

  const out: Record<string, ExerciseProgress> = {};
  for (const exerciseId of new Set([...Object.keys(local), ...Object.keys(base)])) {
    const mine = local[exerciseId];
    const theirs = base[exerciseId];
    const sets: PerformedSet[] = [];
    const setIds: (string | null)[] = [];
    const baseIds = new Set<string>();

    theirs?.sets.forEach((set, i) => {
      const id = theirs.setIds[i];
      if (id === undefined) return;
      baseIds.add(id);
      // Annulée ici pendant le trajet de la lecture : elle ne revient pas.
      if (known?.has(id) && !localIds.has(id)) return;
      sets.push(set);
      setIds.push(id);
    });

    mine?.sets.forEach((set, i) => {
      const id = mine.setIds[i] ?? null;
      if (id === null) {
        // Ancien format : gardée seulement si la base n'a rien à cette place.
        if (sets.some((s) => s.order === set.order && s.side === set.side)) return;
      } else {
        if (baseIds.has(id)) return;
        const loggedSinceDeparture = known !== null && !known.has(id);
        if (!pending.has(id) && !loggedSinceDeparture) return;
      }
      sets.push(set);
      setIds.push(id);
    });

    const skipped = mine?.skipped ?? false;
    if (sets.length === 0 && !skipped) continue;
    out[exerciseId] = { sets, setIds, skipped };
  }
  return out;
}

/**
 * Fusionne le réalisé d'UN exo présent dans les deux sources. On retient la source
 * la plus avancée (plus de séries) pour les `sets`, mais on aligne les `setIds`
 * index par index : un id manquant (`null`, série venue d'un cache d'ancien format)
 * est complété par l'id de l'autre source au même index. Objectif : toute série
 * affichée porte un id annulable (cf. mergeProgress).
 */
function mergeExerciseProgress(
  pa: ExerciseProgress,
  pb: ExerciseProgress,
): ExerciseProgress {
  // Source de base = la plus avancée (à égalité, la base `a` : Supabase fait foi).
  const base = pa.sets.length >= pb.sets.length ? pa : pb;
  const other = base === pa ? pb : pa;
  // Complète un id manquant en cherchant dans `other` la série de MÊME (order, side)
  // — PAS au même index. Un exo unilatéral peut être ordonné différemment entre la
  // base (triée par order, gauche avant droite) et le cache local (ordre de saisie,
  // la droite pouvant être loggée en 1er, issue #63) : l'alignement par index brut
  // apparierait alors les côtés croisés → un undo viserait la mauvaise ligne en base.
  // (order, side) est unique par exo (G/D par order, ou 1 série/order en bilatéral).
  const setIds = base.sets.map((set, i) => {
    const own = base.setIds[i];
    if (own) return own;
    const match = other.sets.findIndex((s) => s.order === set.order && s.side === set.side);
    return match >= 0 ? other.setIds[match] ?? null : null;
  });
  return { ...base, setIds };
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

    case 'reconcile-progress':
      return {
        ...state,
        progress: reconcileProgress(state.progress, action.base, {
          pendingSetIds: action.pendingSetIds,
          knownAtDeparture: action.knownAtDeparture,
        }),
      };

    case 'edit-layout':
      return { ...state, layout: [...(state.layout ?? []), action.edit] };

    case 'close':
      // Fige la clôture EN MÉMOIRE. Tout le reste (réalisé, ids) est conservé : le
      // récap de fin se lit dans la foulée immédiate. Au remontage, rien ne
      // revient (le cache a été nettoyé) — la clôture est transitoire (ADR 0009).
      return { ...state, closedAt: action.closedAt };

    case 'set-started-at':
      // Réancre le chrono (ADR 0011, expiration d'un lancement) : on ne touche QUE
      // `startedAt`, le réalisé et l'exécution restent intacts.
      return { ...state, startedAt: action.startedAt };

    case 'reset':
      // Nouvelle séance = nouveau chrono ET nouvelle exécution (id client neuf,
      // fourni par le caller). L'exécution précédente reste en base. On lève la
      // clôture : la séance neuve repart « en cours ».
      return {
        ...state,
        executionId: action.executionId,
        startedAt: Date.now(),
        activeExerciseId: null,
        progress: {},
        datedNotes: {},
        // La disposition appartient à l'exécution abandonnée.
        layout: undefined,
        closedAt: null,
      };

    default:
      return state;
  }
}

// --- Persistance « survit au background » -----------------------------------
// L'exécution en cours est sauvée en localStorage et restaurée au montage.

/** Préfixe des clés d'état de capture : `croustylift:capture:<séance>:<date>`. */
export const STORAGE_PREFIX = 'croustylift:capture:';

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
    });
  }
  return layout.length > 0 ? { layout } : {};
}

/** Charge l'exécution persistée pour cette séance/jour, ou null si rien/invalide. */
export function loadPersisted(session: Session, date: string): CaptureState | null {
  if (typeof localStorage === 'undefined') return null;
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

export function persist(state: CaptureState): void {
  if (typeof localStorage === 'undefined') return;
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
  if (write()) {
    persistFailing = false;
    return;
  }
  // Quota plein : les copies de lecture cèdent la place (elles se relisent sur
  // le réseau, pas une séance en cours), puis nouvel essai. Si rien n'y fait,
  // la capture reste en mémoire et le refus est signalé (bannière), au lieu de
  // l'ancienne dégradation muette.
  clearReadCache();
  persistFailing = !write();
}

export function clearPersisted(session: Session, date: string): void {
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
