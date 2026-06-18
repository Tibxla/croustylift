// Orchestrateur picker ↔ panneau. État via useReducer, persisté en localStorage
// (« survit au background » : on peut fermer/rouvrir, l'état revient).
import { useCallback, useEffect, useReducer, useState } from 'react';
import { upperA } from './fixtures';
import {
  captureReducer,
  clearPersisted,
  getProgress,
  initialState,
  loadPersisted,
  persist,
  statusOf,
  todayIso,
} from './state';
import { ExercisePicker } from './ExercisePicker';
import { ExerciseCapture } from './ExerciseCapture';

const session = upperA;

export function CaptureScreen() {
  const [date] = useState(todayIso);

  // Restauration au montage : l'exécution persistée reprend là où on l'avait laissée.
  const [state, dispatch] = useReducer(
    captureReducer,
    null,
    () => loadPersisted(session, date) ?? initialState(session, date),
  );

  // Persiste à chaque changement d'état.
  useEffect(() => {
    persist(state);
  }, [state]);

  const activeExercise = state.activeExerciseId
    ? session.exercises.find((e) => e.exerciseId === state.activeExerciseId) ?? null
    : null;

  const handleReset = useCallback(() => {
    clearPersisted(session, date);
    dispatch({ type: 'reset' });
  }, [date]);

  return (
    <div className="min-h-[calc(100vh-3.5rem)]">
      {activeExercise ? (
        <CapturePanel
          key={activeExercise.exerciseId}
          exercise={activeExercise}
          progress={getProgress(state, activeExercise.exerciseId)}
          dispatch={dispatch}
        />
      ) : (
        <>
          <ExercisePicker
            session={session}
            state={state}
            onPick={(id) => dispatch({ type: 'open-exercise', exerciseId: id })}
          />
          <ResetBar state={state} onReset={handleReset} />
        </>
      )}
    </div>
  );
}

// --- Panneau + barre d'action fixe (zone basse du pouce) --------------------

import type { Dispatch } from 'react';
import type { SessionExercise } from './fixtures';
import type { CaptureAction, ExerciseProgress } from './state';

function CapturePanel({
  exercise,
  progress,
  dispatch,
}: {
  exercise: SessionExercise;
  progress: ExerciseProgress;
  dispatch: Dispatch<CaptureAction>;
}) {
  // Brouillon de la série courante remonté ici pour que la barre fixe puisse logger.
  const [draft, setDraft] = useState<{ weightKg: number; reps: number; rir: number } | null>(
    null,
  );

  const loggedCount = progress.sets.length;
  const reachedMax = loggedCount >= exercise.prescription.sets.max;

  // aria-live : annonce « série loggée » après chaque commit.
  const [announce, setAnnounce] = useState('');

  const logSet = useCallback(
    (set: { weightKg: number; reps: number; rir: number }) => {
      dispatch({ type: 'log-set', exerciseId: exercise.exerciseId, set });
      setAnnounce(
        `Série ${loggedCount + 1} loggée : ${set.weightKg} kilos, ${set.reps} répétitions, RIR ${set.rir}.`,
      );
    },
    [dispatch, exercise.exerciseId, loggedCount],
  );

  return (
    <>
      <ExerciseCapture
        exercise={exercise}
        progress={progress}
        onUndoLast={() => {
          dispatch({ type: 'undo-last-set', exerciseId: exercise.exerciseId });
          setAnnounce('Dernière série annulée.');
        }}
        onSkip={() => dispatch({ type: 'skip-exercise', exerciseId: exercise.exerciseId })}
        onBack={() => dispatch({ type: 'back-to-picker' })}
        onDraftChange={setDraft}
      />

      <p className="sr-only" role="status" aria-live="assertive">
        {announce}
      </p>

      {/* Barre d'action primaire fixe — pouce, accent violet, 1 tap. */}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-bg/95 px-4 pb-[calc(env(safe-area-inset-bottom,0)+0.75rem)] pt-3 backdrop-blur-sm">
        <div className="mx-auto w-full max-w-md">
          <button
            type="button"
            disabled={!draft}
            onClick={() => draft && logSet(draft)}
            className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-accent-strong text-lg font-semibold text-on-accent shadow-lg shadow-accent/20 transition active:scale-[0.98] active:bg-accent disabled:opacity-50 disabled:active:scale-100"
          >
            <svg
              viewBox="0 0 24 24"
              width="22"
              height="22"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            {reachedMax ? 'Logger une série de plus' : 'Logger la série'}
          </button>
        </div>
      </div>
    </>
  );
}

function ResetBar({
  state,
  onReset,
}: {
  state: ReturnType<typeof initialState>;
  onReset: () => void;
}) {
  const touched = session.exercises.some((ex) => {
    const p = getProgress(state, ex.exerciseId);
    return p.sets.length > 0 || p.skipped;
  });
  const allDone =
    touched &&
    session.exercises.every((ex) => {
      const p = getProgress(state, ex.exerciseId);
      return statusOf(p, ex.prescription.sets.min) === 'done' || p.skipped;
    });

  if (!touched) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-bg/95 px-4 pb-[calc(env(safe-area-inset-bottom,0)+0.75rem)] pt-3 backdrop-blur-sm">
      <div className="mx-auto flex w-full max-w-md items-center justify-between gap-3">
        <span className="text-sm text-ink-muted">
          {allDone ? 'Séance terminée.' : 'Exécution en cours, sauvegardée.'}
        </span>
        <button
          type="button"
          onClick={onReset}
          className="inline-flex h-11 items-center rounded-xl bg-surface px-4 text-sm font-medium text-ink-muted transition active:bg-surface-2 active:text-ink"
        >
          {allDone ? 'Nouvelle séance' : 'Réinitialiser'}
        </button>
      </div>
    </div>
  );
}
