// Orchestrateur picker ↔ panneau. La séance vient de Supabase (vraies données,
// scopées à l'user par RLS). L'UI reste pilotée par un reducer local ; Supabase
// est persisté EN PARALLÈLE de chaque log/annulation. localStorage survit au
// background. Écriture qui échoue -> on garde l'état local + badge « non synchronisé ».
import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  type Dispatch,
} from 'react';
import {
  ensureStarterSeance,
  finishExecution,
  findOrCreateTodayExecution,
  loadReference,
  loadSeanceForCapture,
  loadTodayProgress,
  persistSet,
  removeLastSet,
  type Session,
} from './data';
import {
  captureReducer,
  clearPersisted,
  getProgress,
  hydratedState,
  loadPersisted,
  persist,
  statusOf,
  todayIso,
} from './state';
import type { PerformedSet } from '../../domain/types';
import { ExercisePicker } from './ExercisePicker';
import { ExerciseCapture } from './ExerciseCapture';
import { SessionEnd, type SessionEndValues, type SessionSummary } from './SessionEnd';

type LoadState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; session: Session; seanceVersionId: string };

export function CaptureScreen() {
  const [load, setLoad] = useState<LoadState>({ phase: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  // Le réalisé Supabase du jour, posé par l'effet de chargement, lu par CaptureBoard.
  const hydrationRef = useRef<Record<string, PerformedSet[]>>({});

  useEffect(() => {
    let active = true;
    setLoad({ phase: 'loading' });

    void (async () => {
      try {
        // 1. Garantit une séance de démarrage (idempotent), 2. charge son template,
        // 3. enrichit chaque exo de sa référence, 4. réhydrate le réalisé du jour.
        const { seance, seanceVersionId } = await ensureStarterSeance();
        const base = await loadSeanceForCapture(seance, seanceVersionId);

        const [withRefs, todayProgress] = await Promise.all([
          Promise.all(
            base.exercises.map(async (ex) => ({
              ...ex,
              reference: await loadReference(ex.exerciseId),
            })),
          ),
          loadTodayProgress(seanceVersionId),
        ]);

        if (!active) return;
        const session: Session = { ...base, exercises: withRefs };
        // On transporte le réalisé chargé vers le reducer via un ref, posé AVANT
        // le passage en « ready » pour qu'il soit prêt au 1ᵉʳ render de CaptureBoard.
        hydrationRef.current = todayProgress;
        setLoad({ phase: 'ready', session, seanceVersionId });
      } catch (err) {
        if (!active) return;
        setLoad({
          phase: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    })();

    return () => {
      active = false;
    };
  }, [reloadKey]);

  if (load.phase === 'loading') {
    return (
      <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center">
        <div
          className="h-6 w-6 animate-spin rounded-full border-2 border-line border-t-accent"
          role="status"
          aria-label="Chargement de la séance"
        />
      </div>
    );
  }

  if (load.phase === 'error') {
    return (
      <div className="mx-auto flex min-h-[calc(100vh-3.5rem)] w-full max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-sm text-ink-muted">
          Impossible de charger ta séance.
        </p>
        <p className="readout max-w-full break-words text-xs text-warn">{load.message}</p>
        <button
          type="button"
          onClick={() => setReloadKey((k) => k + 1)}
          className="inline-flex h-11 items-center rounded-xl bg-accent-strong px-5 text-sm font-semibold text-on-accent transition active:scale-[0.98] active:bg-accent"
        >
          Réessayer
        </button>
      </div>
    );
  }

  return (
    <CaptureBoard
      key={load.session.id}
      session={load.session}
      seanceVersionId={load.seanceVersionId}
      initialProgress={hydrationRef.current}
    />
  );
}

// --- Le tableau de capture (séance chargée) ---------------------------------

function CaptureBoard({
  session,
  seanceVersionId,
  initialProgress,
}: {
  session: Session;
  seanceVersionId: string;
  initialProgress: Record<string, PerformedSet[]>;
}) {
  const [date] = useState(todayIso);

  // Restauration au montage : Supabase fait foi, localStorage est un filet
  // (survie au background / écriture offline non encore synchronisée). Pour
  // chaque exo on garde la source ayant le plus de séries.
  const [state, dispatch] = useReducer(captureReducer, null, () => {
    const fromSupabase = hydratedState(session, initialProgress, date);
    const fromLocal = loadPersisted(session, date);
    if (!fromLocal) return fromSupabase;
    return mergeProgress(fromSupabase, fromLocal);
  });

  // Persiste à chaque changement d'état (localStorage).
  useEffect(() => {
    persist(state);
  }, [state]);

  // --- Synchro Supabase en parallèle ----------------------------------------
  const [unsynced, setUnsynced] = useState(false);
  // Id de l'exécution du jour, créé paresseusement au 1ᵉʳ log.
  const executionIdRef = useRef<string | null>(null);

  const ensureExecution = useCallback(async (): Promise<string> => {
    if (executionIdRef.current) return executionIdRef.current;
    const id = await findOrCreateTodayExecution(seanceVersionId);
    executionIdRef.current = id;
    return id;
  }, [seanceVersionId]);

  const syncLog = useCallback(
    async (exerciseId: string, set: PerformedSet) => {
      try {
        const executionId = await ensureExecution();
        await persistSet(executionId, exerciseId, set, set.order);
      } catch {
        setUnsynced(true);
      }
    },
    [ensureExecution],
  );

  const syncUndo = useCallback(
    async (exerciseId: string) => {
      try {
        const executionId = await ensureExecution();
        await removeLastSet(executionId, exerciseId);
      } catch {
        setUnsynced(true);
      }
    },
    [ensureExecution],
  );

  const activeExercise = state.activeExerciseId
    ? session.exercises.find((e) => e.exerciseId === state.activeExerciseId) ?? null
    : null;

  const handleLog = useCallback(
    (exerciseId: string, set: { weightKg: number; reps: number; rir: number }) => {
      const order = getProgress(state, exerciseId).sets.length + 1;
      dispatch({ type: 'log-set', exerciseId, set });
      void syncLog(exerciseId, { ...set, order });
    },
    [state, syncLog],
  );

  const handleUndo = useCallback(
    (exerciseId: string) => {
      dispatch({ type: 'undo-last-set', exerciseId });
      void syncUndo(exerciseId);
    },
    [syncUndo],
  );

  const handleReset = useCallback(() => {
    clearPersisted(session, date);
    dispatch({ type: 'reset' });
    setPhase('capture');
    // On repart sur une exécution neuve au prochain log (la précédente reste en base).
    executionIdRef.current = null;
  }, [session, date]);

  // --- Flux de fin de séance ------------------------------------------------
  // Phase locale : capture (sélecteur + panneaux) -> fin (clôture, BPM optionnel).
  // La confirmation « Séance terminée » est gérée à l'intérieur de SessionEnd.
  const [phase, setPhase] = useState<'capture' | 'finishing'>('capture');
  // Durée CHRONOMÉTRÉE, figée à l'ouverture du flux de fin (lancement -> clôture).
  // `null` = cas dégénéré (startedAt absent) : pas de durée envoyée ni affichée.
  const [durationMin, setDurationMin] = useState<number | null>(null);

  const openFinish = useCallback(() => {
    setDurationMin(elapsedMinutesSince(state.startedAt));
    setPhase('finishing');
  }, [state.startedAt]);

  // « Au moins une série loggée » : condition d'accès au flux de fin (cf. produit).
  const loggedAny = session.exercises.some(
    (ex) => getProgress(state, ex.exerciseId).sets.length > 0,
  );

  const summary = buildSummary(session, state);

  const handleFinish = useCallback(
    async (values: SessionEndValues) => {
      // Garantit l'exécution même si une synchro de série a échoué plus tôt
      // (l'utilisateur a pu logger offline) : sans id, rien à clôturer.
      const executionId = await ensureExecution();
      // La durée vient du chrono (lancement -> clôture), pas d'une saisie.
      await finishExecution(executionId, {
        bpmAvg: values.bpmAvg,
        durationMin: durationMin ?? undefined,
      });
    },
    [ensureExecution, durationMin],
  );

  if (phase === 'finishing') {
    return (
      <div className="min-h-[calc(100vh-3.5rem)]">
        {unsynced && <UnsyncedBanner />}
        <SessionEnd
          summary={summary}
          durationMin={durationMin}
          onSave={handleFinish}
          onBack={() => setPhase('capture')}
        />
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-3.5rem)]">
      {unsynced && <UnsyncedBanner />}
      {activeExercise ? (
        <CapturePanel
          key={activeExercise.exerciseId}
          exercise={activeExercise}
          progress={getProgress(state, activeExercise.exerciseId)}
          dispatch={dispatch}
          onLog={(set) => handleLog(activeExercise.exerciseId, set)}
          onUndo={() => handleUndo(activeExercise.exerciseId)}
        />
      ) : (
        <>
          <ExercisePicker
            session={session}
            state={state}
            onPick={(id) => dispatch({ type: 'open-exercise', exerciseId: id })}
          />
          <ResetBar
            session={session}
            state={state}
            canFinish={loggedAny}
            onReset={handleReset}
            onFinish={openFinish}
          />
        </>
      )}
    </div>
  );
}

/**
 * Durée écoulée en minutes (arrondi) depuis le lancement de la séance, ou `null`
 * si `startedAt` est absent/invalide (cas dégénéré : on n'envoie ni n'affiche
 * de durée plutôt qu'une valeur trompeuse).
 */
function elapsedMinutesSince(startedAt: number | undefined): number | null {
  if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) return null;
  return Math.round((Date.now() - startedAt) / 60000);
}

/** Construit le récap sobre de l'exécution courante (exos faits / total, séries). */
function buildSummary(session: Session, state: CaptureState): SessionSummary {
  const exercisesDone = session.exercises.filter((ex) => {
    const p = getProgress(state, ex.exerciseId);
    return p.skipped || p.sets.length >= ex.prescription.sets.min;
  }).length;
  const totalSets = session.exercises.reduce(
    (sum, ex) => sum + getProgress(state, ex.exerciseId).sets.length,
    0,
  );
  return {
    sessionName: session.name,
    exercisesDone,
    exercisesTotal: session.exercises.length,
    totalSets,
  };
}

/**
 * Fusionne deux états : pour chaque exo, on garde le réalisé le plus avancé.
 * `b` = état restauré du localStorage : son `startedAt` (le lancement réel,
 * persisté) prime sur celui fraîchement re-créé par l'hydratation Supabase, pour
 * que la durée chronométrée survive au passage en arrière-plan.
 */
function mergeProgress(a: CaptureState, b: CaptureState): CaptureState {
  const ids = new Set([...Object.keys(a.progress), ...Object.keys(b.progress)]);
  const progress: CaptureState['progress'] = {};
  for (const id of ids) {
    const pa = a.progress[id];
    const pb = b.progress[id];
    if (!pa) progress[id] = pb;
    else if (!pb) progress[id] = pa;
    else progress[id] = pa.sets.length >= pb.sets.length ? pa : pb;
  }
  return { ...a, startedAt: b.startedAt, progress };
}

function UnsyncedBanner() {
  return (
    <div
      className="mx-auto flex w-full max-w-md items-center gap-2 px-4 pt-3 text-xs text-warn"
      role="status"
      aria-live="polite"
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warn" aria-hidden="true" />
      Non synchronisé. Tes séries sont gardées sur l&apos;appareil.
    </div>
  );
}

// --- Panneau + barre d'action fixe (zone basse du pouce) --------------------

import type { SessionExercise } from './data';
import type { CaptureAction, CaptureState, ExerciseProgress } from './state';

function CapturePanel({
  exercise,
  progress,
  dispatch,
  onLog,
  onUndo,
}: {
  exercise: SessionExercise;
  progress: ExerciseProgress;
  dispatch: Dispatch<CaptureAction>;
  onLog: (set: { weightKg: number; reps: number; rir: number }) => void;
  onUndo: () => void;
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
      onLog(set);
      setAnnounce(
        `Série ${loggedCount + 1} loggée : ${set.weightKg} kilos, ${set.reps} répétitions, RIR ${set.rir}.`,
      );
    },
    [onLog, loggedCount],
  );

  return (
    <>
      <ExerciseCapture
        exercise={exercise}
        progress={progress}
        onUndoLast={() => {
          onUndo();
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
      <div className="fixed inset-x-0 bottom-[var(--nav-offset)] z-10 border-t border-line bg-bg/95 px-4 pb-[calc(env(safe-area-inset-bottom,0)+0.75rem)] pt-3 backdrop-blur-sm">
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
  session,
  state,
  canFinish,
  onReset,
  onFinish,
}: {
  session: Session;
  state: CaptureState;
  /** « Au moins une série loggée » : le flux de fin de séance est disponible. */
  canFinish: boolean;
  onReset: () => void;
  onFinish: () => void;
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
    <div className="fixed inset-x-0 bottom-[var(--nav-offset)] z-10 border-t border-line bg-bg/95 px-4 pb-[calc(env(safe-area-inset-bottom,0)+0.75rem)] pt-3 backdrop-blur-sm">
      <div className="mx-auto flex w-full max-w-md flex-col gap-2.5">
        {/* « Terminer la séance » dès qu'une série est loggée. Caché sinon
            (un exo seulement passé n'ouvre pas le flux de fin). */}
        {canFinish && (
          <button
            type="button"
            onClick={onFinish}
            className="flex h-12 w-full items-center justify-center rounded-2xl bg-accent-strong text-base font-semibold text-on-accent shadow-lg shadow-accent/20 transition active:scale-[0.98] active:bg-accent"
          >
            Terminer la séance
          </button>
        )}
        <div className="flex items-center justify-between gap-3">
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
    </div>
  );
}
