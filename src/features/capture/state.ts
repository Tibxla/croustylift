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
   * Id CLIENT de chaque série (UUID, cf. ADR 0003), aligné par index avec `sets`.
   * Généré au log, persisté avec l'état : c'est lui qui rend l'écriture Supabase
   * idempotente (upsert/delete par id) et permet à l'outbox de viser exactement
   * la bonne ligne au rejeu. Tableau parallèle car `PerformedSet` (domaine) ne
   * porte pas d'id. Une série réhydratée depuis la base n'a pas d'id client :
   * son entrée vaut `null` (pas de mutation outbox dessus, déjà en base).
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
   * Horodatage de CLÔTURE (epoch ms) si la séance a été clôturée, sinon `null`.
   * Persisté : au remontage (changement d'onglet, reload), une séance clôturée
   * réaffiche l'écran « Séance terminée » au lieu de repasser « en cours ».
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
  // garder le reducer testable). Persisté → la clôture survit au remontage.
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
 * État construit à partir du réalisé persisté en base (Supabase fait foi au
 * reload). `progressByExercise` = séries déjà loggées par exerciseId ;
 * `datedNotesByExercise` = notes datées déjà en base (issue #26), par exerciseId,
 * avec leur id réel pour que l'édition vise la bonne ligne.
 */
export function hydratedState(
  session: Session,
  progressByExercise: Record<string, PerformedSet[]>,
  datedNotesByExercise: Record<string, DatedNoteDraft> = {},
  date = todayIso(),
  executionId = newId(),
): CaptureState {
  const progress: Record<string, ExerciseProgress> = {};
  for (const [exerciseId, sets] of Object.entries(progressByExercise)) {
    // Séries venues de la base : déjà persistées, pas d'id client (null) → elles
    // ne génèrent aucune op d'outbox. L'outbox ne porte que le réalisé LOCAL.
    if (sets.length > 0) {
      progress[exerciseId] = { sets, setIds: sets.map(() => null), skipped: false };
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
      // Fige la clôture. Tout le reste (réalisé, ids) est conservé : la séance
      // close reste consultable et la confirmation se réaffiche au remontage.
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
      // CONSERVE la clôture : une séance clôturée puis quittée (changement
      // d'onglet) doit rester close au retour, pas repasser « en cours ».
      closedAt:
        typeof parsed.closedAt === 'number' && Number.isFinite(parsed.closedAt)
          ? parsed.closedAt
          : null,
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
