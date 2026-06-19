// État de la capture : l'Exécution en cours d'une séance, + reducer + persistance.
// Pas de Supabase cette passe — l'état vit en mémoire et survit au background via localStorage.
import type { PerformedSet, Side } from '../../domain/types';
import { normalizeNoteBody } from '../../domain/notes';
import { defaultSide, nextOrderForSide } from '../../domain/unilateral';
import type { Session } from './fixtures';

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
  // `executionId` : nouvelle exécution (UUID client) pour la séance neuve.
  | { type: 'reset'; executionId: string }
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

/**
 * Décide la sauvegarde de la NOTE D'INSTRUCTIONS d'un exo éditée sur place en
 * Capture (issue #52). Compare les corps NORMALISÉS (espaces de bord, fins de
 * ligne \r\n) pour :
 *   - `changed` : ne déclencher l'écriture que si le contenu réel a bougé (resaver
 *     une note inchangée, ou n'avoir touché que des espaces, n'appelle pas le
 *     réseau) ; un corps vidé compte comme un changement (= suppression côté data) ;
 *   - `nextBody` : le corps NORMALISÉ à persister et à refléter à l'écran (vide =
 *     « rien à noter », que `saveExerciseNote` traduit en suppression de la ligne).
 * Pur : aucune écriture, miroir local de la sémantique de `saveExerciseNote`.
 */
export function resolveExerciseNoteSave(
  currentBody: string,
  draft: string,
): { changed: boolean; nextBody: string } {
  const nextBody = normalizeNoteBody(draft);
  return { changed: nextBody !== normalizeNoteBody(currentBody), nextBody };
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
  const fromToday = loadPersisted(session, today);
  if (fromToday) return { date: today, restored: fromToday };

  // Rien aujourd'hui : une séance d'hier non clôturée se reprend telle quelle.
  // `loadPersisted` a déjà écarté toute clôture (closedAt forcé à null) ET ne
  // renvoie un état que pour un cache d'une séance EN COURS — une veille clôturée
  // a vu son cache nettoyé à la clôture, donc `fromYesterday` y vaut null.
  const yesterday = previousDayIso(today);
  const fromYesterday = loadPersisted(session, yesterday);
  if (fromYesterday) return { date: yesterday, restored: fromYesterday };

  return { date: today, restored: null };
}

export function initialState(session: Session, date = todayIso()): CaptureState {
  return {
    sessionId: session.id,
    executionId: newId(),
    date,
    startedAt: Date.now(),
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
    startedAt: Date.now(),
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
 * encore synchronisée, survie au background). Pour chaque exo on garde le réalisé
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
    startedAt: b.startedAt,
    progress,
    datedNotes,
    closedAt: null,
  };
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

    case 'close':
      // Fige la clôture EN MÉMOIRE. Tout le reste (réalisé, ids) est conservé : le
      // récap de fin se lit dans la foulée immédiate. Au remontage, rien ne
      // revient (le cache a été nettoyé) — la clôture est transitoire (ADR 0009).
      return { ...state, closedAt: action.closedAt };

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
        closedAt: null,
      };

    default:
      return state;
  }
}

// --- Persistance « survit au background » -----------------------------------
// L'exécution en cours est sauvée en localStorage et restaurée au montage.

const STORAGE_PREFIX = 'croustylift:capture:';

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

/** Charge l'exécution persistée pour cette séance/jour, ou null si rien/invalide. */
export function loadPersisted(session: Session, date: string): CaptureState | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(storageKey(session.id, date));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CaptureState>;
    if (parsed.sessionId !== session.id || parsed.date !== date) return null;
    return {
      sessionId: session.id,
      // CONSERVE l'executionId persisté : un log offline et son upsert d'exécution
      // doivent garder le même id à la restauration. Cache pré-executionId (ancien
      // format) : on en forge un neuf pour ne pas casser la session restaurée.
      executionId: typeof parsed.executionId === 'string' ? parsed.executionId : newId(),
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

export function persist(state: CaptureState): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(storageKey(state.sessionId, state.date), JSON.stringify(state));
  } catch {
    // Quota plein / mode privé : on dégrade silencieusement, la capture reste en mémoire.
  }
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
