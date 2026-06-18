// État de la capture : l'Exécution en cours d'une séance, + reducer + persistance.
// Pas de Supabase cette passe — l'état vit en mémoire et survit au background via localStorage.
import type { PerformedSet } from '../../domain/types';
import type { Session } from './fixtures';

/** Statut d'un exercice dans l'exécution courante (dérivable, mais pratique à porter). */
export type ExerciseStatus = 'todo' | 'in-progress' | 'done' | 'skipped';

/** Le réalisé d'un exercice : les séries loggées, dans l'ordre, + s'il a été passé. */
export interface ExerciseProgress {
  /** Séries réellement loggées (ordre = index + 1). */
  sets: PerformedSet[];
  /** Exo explicitement passé par l'utilisateur (un trou assumé, pas un oubli). */
  skipped: boolean;
}

export interface CaptureState {
  sessionId: string;
  /** Date ISO 'YYYY-MM-DD' de l'exécution. */
  date: string;
  /** Exo actuellement ouvert dans le panneau de capture, ou null = on est sur le sélecteur. */
  activeExerciseId: string | null;
  /** Réalisé par exerciseId. */
  progress: Record<string, ExerciseProgress>;
}

export type CaptureAction =
  | { type: 'open-exercise'; exerciseId: string }
  | { type: 'back-to-picker' }
  | { type: 'log-set'; exerciseId: string; set: Omit<PerformedSet, 'order'> }
  | { type: 'undo-last-set'; exerciseId: string }
  | { type: 'skip-exercise'; exerciseId: string }
  | { type: 'unskip-exercise'; exerciseId: string }
  | { type: 'reset' };

function emptyProgress(): ExerciseProgress {
  return { sets: [], skipped: false };
}

export function getProgress(state: CaptureState, exerciseId: string): ExerciseProgress {
  return state.progress[exerciseId] ?? emptyProgress();
}

export function statusOf(progress: ExerciseProgress, prescribedMin: number): ExerciseStatus {
  if (progress.skipped) return 'skipped';
  if (progress.sets.length === 0) return 'todo';
  if (progress.sets.length >= prescribedMin) return 'done';
  return 'in-progress';
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
    date,
    activeExerciseId: null,
    progress: {},
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
      const nextSet: PerformedSet = { ...action.set, order: prev.sets.length + 1 };
      return {
        ...state,
        progress: {
          ...state.progress,
          [action.exerciseId]: {
            sets: [...prev.sets, nextSet],
            skipped: false,
          },
        },
      };
    }

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

    case 'reset':
      return { ...state, activeExerciseId: null, progress: {} };

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
      date,
      activeExerciseId:
        typeof parsed.activeExerciseId === 'string' ? parsed.activeExerciseId : null,
      progress: parsed.progress && typeof parsed.progress === 'object' ? parsed.progress : {},
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
