// Orchestrateur picker ↔ panneau. La séance vient de Supabase (vraies données,
// scopées à l'user par RLS). L'UI reste pilotée par un reducer local ; la
// DURABILITÉ passe par l'OUTBOX : chaque mutation écrit l'état local (UI
// immédiate) ET enfile une op (outbox.ts), synchronisée en fond. Une écriture
// qui échoue (wifi de salle coupé) reste en file et remonte SEULE au retour du
// réseau. localStorage survit au background ; l'outbox survit au reload.
import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type Dispatch,
} from 'react';
import {
  deleteSetById,
  ensureStarterSeance,
  loadReference,
  loadSeanceForCapture,
  loadTodayProgress,
  updateExecution,
  upsertExecution,
  upsertSet,
  type Session,
} from './data';
import {
  captureReducer,
  clearPersisted,
  getProgress,
  hydratedState,
  loadPersisted,
  newId,
  persist,
  statusOf,
  todayIso,
} from './state';
import {
  enqueue,
  flush,
  pendingCount,
  clearQueue,
  type SyncFns,
} from './outbox';
import type { PerformedSet } from '../../domain/types';
import { ExercisePicker } from './ExercisePicker';
import { ExerciseCapture } from './ExerciseCapture';
import { SessionEnd, type SessionEndValues } from './SessionEnd';
import { buildSummary, elapsedMinutesSince } from './summary';

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

// --- Couche de synchronisation (outbox) -------------------------------------

/**
 * Les fonctions de sync réelles consommées par `flush` : une par type d'op,
 * toutes idempotentes par id (cf. data.ts). C'est le seul point de couplage
 * entre l'outbox (logique pure) et Supabase.
 */
const syncFns: SyncFns = {
  upsertExecution: (op) =>
    upsertExecution({
      id: op.id,
      seanceVersionId: op.seanceVersionId,
      performedOn: op.performedOn,
    }),
  insertSet: (op) =>
    upsertSet({
      id: op.id,
      executionId: op.executionId,
      exerciseId: op.exerciseId,
      setOrder: op.setOrder,
      weightKg: op.weightKg,
      reps: op.reps,
      rir: op.rir,
    }),
  deleteSet: (op) => deleteSetById(op.id),
  updateExecution: (op) =>
    updateExecution({ id: op.id, bpmAvg: op.bpmAvg, durationMin: op.durationMin }),
};

// --- Indicateur de sync réactif --------------------------------------------
// La bannière est pilotée par la LONGUEUR de l'outbox + l'état réseau. On
// expose la longueur via un petit store maison rafraîchi à chaque mutation /
// flush / changement de connectivité, lu par useSyncExternalStore.

const syncListeners = new Set<() => void>();

/** À appeler après tout changement de file (enqueue / flush) pour rafraîchir l'UI. */
function notifySync() {
  for (const l of syncListeners) l();
}

function subscribeSync(cb: () => void): () => void {
  syncListeners.add(cb);
  const onOnlineOffline = () => cb();
  window.addEventListener('online', onOnlineOffline);
  window.addEventListener('offline', onOnlineOffline);
  return () => {
    syncListeners.delete(cb);
    window.removeEventListener('online', onOnlineOffline);
    window.removeEventListener('offline', onOnlineOffline);
  };
}

/** Tente un flush puis notifie l'UI (longueur de file potentiellement changée). */
async function attemptFlush(): Promise<void> {
  try {
    await flush(syncFns);
  } finally {
    notifySync();
  }
}

/** Enfile une op, notifie l'UI, et tente un flush immédiat (sync en fond). */
function enqueueAndFlush(...ops: Parameters<typeof enqueue>): void {
  for (const op of ops) enqueue(op);
  notifySync();
  void attemptFlush();
}

export type SyncStatus = 'synced' | 'pending' | 'offline';

/** Statut de synchro dérivé : file vide = synchronisé ; sinon hors-ligne / en attente. */
function useSyncStatus(): { status: SyncStatus; pending: number } {
  const pending = useSyncExternalStore(
    subscribeSync,
    () => pendingCount(),
    () => 0,
  );
  const online =
    useSyncExternalStore(
      subscribeSync,
      () => (typeof navigator === 'undefined' ? true : navigator.onLine),
      () => true,
    ) ?? true;

  if (pending === 0) return { status: 'synced', pending };
  return { status: online ? 'pending' : 'offline', pending };
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

  // --- Synchro via outbox ---------------------------------------------------
  const { status, pending } = useSyncStatus();

  // L'exécution est enfilée UNE fois par session, AVANT son premier set (la FK
  // séries→exécution impose l'ordre, garanti aussi par le FIFO de l'outbox).
  const executionEnqueuedRef = useRef(false);
  const enqueueExecutionOnce = useCallback(() => {
    if (executionEnqueuedRef.current) return;
    executionEnqueuedRef.current = true;
    enqueueAndFlush({
      type: 'upsertExecution',
      id: state.executionId,
      seanceVersionId,
      performedOn: date,
    });
  }, [state.executionId, seanceVersionId, date]);

  // Déclencheurs de flush : au MONTAGE (reprise après reload offline) et à
  // l'événement réseau 'online' (le wifi de salle revient). Le 3ᵉ déclencheur
  // — après chaque enqueue — est porté par enqueueAndFlush.
  useEffect(() => {
    void attemptFlush();
    const onOnline = () => void attemptFlush();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, []);

  const activeExercise = state.activeExerciseId
    ? session.exercises.find((e) => e.exerciseId === state.activeExerciseId) ?? null
    : null;

  const handleLog = useCallback(
    (exerciseId: string, set: { weightKg: number; reps: number; rir: number }) => {
      const order = getProgress(state, exerciseId).sets.length + 1;
      const setId = newId();
      // 1. UI immédiate. 2. Durabilité : exécution (1×) puis la série, dans l'ordre.
      dispatch({ type: 'log-set', exerciseId, setId, set });
      enqueueExecutionOnce();
      enqueueAndFlush({
        type: 'insertSet',
        id: setId,
        executionId: state.executionId,
        exerciseId,
        setOrder: order,
        weightKg: set.weightKg,
        reps: set.reps,
        rir: set.rir,
      });
    },
    [state, enqueueExecutionOnce],
  );

  const handleUndo = useCallback(
    (exerciseId: string) => {
      // Id de la dernière série encore loggée localement : c'est elle qu'on annule.
      const prev = getProgress(state, exerciseId);
      const lastId = prev.setIds[prev.setIds.length - 1] ?? null;
      dispatch({ type: 'undo-last-set', exerciseId });
      // `null` = série réhydratée de la base (pas d'id client connu) : rien à
      // enfiler (le delete par id ne saurait pas quoi viser). Cas marginal :
      // on annule en local sans op ; la base garde la ligne (rare, assumé).
      if (lastId) {
        enqueueAndFlush({ type: 'deleteSet', id: lastId });
      }
    },
    [state],
  );

  const handleReset = useCallback(() => {
    clearPersisted(session, date);
    // Nouvelle exécution = id client neuf (la précédente reste en base). La file
    // est vidée : ses ops visaient l'ancienne exécution, déjà close.
    clearQueue();
    notifySync();
    executionEnqueuedRef.current = false;
    dispatch({ type: 'reset', executionId: newId() });
    setPhase('capture');
  }, [session, date]);

  // Après clôture : repartir sur une séance fraîche. On NE vide PAS la file —
  // les ops de la séance close doivent encore se synchroniser (contrairement à
  // « Réinitialiser » qui abandonne). Nouvelle exécution, progrès + chrono à zéro.
  const handleNewSession = useCallback(() => {
    clearPersisted(session, date);
    executionEnqueuedRef.current = false;
    dispatch({ type: 'reset', executionId: newId() });
    setPhase('capture');
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
      // Clôture via l'outbox : on enfile l'exécution (au cas où aucune série
      // n'aurait encore créé l'op, p. ex. clôture juste après un log offline)
      // PUIS la pose des métriques. La durée vient du chrono (lancement →
      // clôture), pas d'une saisie. Tout remonte seul au retour du réseau.
      enqueueExecutionOnce();
      enqueueAndFlush({
        type: 'updateExecution',
        id: state.executionId,
        bpmAvg: values.bpmAvg,
        durationMin: durationMin ?? undefined,
      });
    },
    [enqueueExecutionOnce, state.executionId, durationMin],
  );

  if (phase === 'finishing') {
    return (
      <div className="min-h-[calc(100vh-3.5rem)]">
        <SyncBanner status={status} pending={pending} />
        <SessionEnd
          summary={summary}
          durationMin={durationMin}
          onSave={handleFinish}
          onBack={() => setPhase('capture')}
          onNewSession={handleNewSession}
        />
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-3.5rem)]">
      <SyncBanner status={status} pending={pending} />
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
 * Fusionne deux états : pour chaque exo, on garde le réalisé le plus avancé.
 * `b` = état restauré du localStorage : son `startedAt` (le lancement réel,
 * persisté) prime sur celui fraîchement re-créé par l'hydratation Supabase, pour
 * que la durée chronométrée survive au passage en arrière-plan. Son `executionId`
 * prime aussi : c'est l'exécution EN COURS, celle que visent les ops déjà en
 * outbox (sinon le rejeu créerait une exécution orpheline).
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
  return { ...a, executionId: b.executionId, startedAt: b.startedAt, progress };
}

/**
 * Indicateur de synchronisation, piloté par la LONGUEUR de l'outbox :
 *   - vide      → « Synchronisé » (vert, discret) ;
 *   - en ligne  → « N en attente » (info, sync en cours) ;
 *   - hors ligne→ « Hors ligne » (warn).
 * Couleur ET texte portent toujours l'info (jamais la couleur seule). « Synchronisé »
 * reste rendu pour stabiliser la mise en page et confirmer la reprise après coup.
 */
export function SyncBanner({ status, pending }: { status: SyncStatus; pending: number }) {
  const variants: Record<
    SyncStatus,
    { dot: string; text: string; label: string }
  > = {
    synced: {
      dot: 'bg-good',
      text: 'text-ink-muted',
      label: 'Synchronisé. Tout est en base.',
    },
    pending: {
      dot: 'bg-accent',
      text: 'text-ink-muted',
      label: `Synchronisation… ${pending} en attente.`,
    },
    offline: {
      dot: 'bg-warn',
      text: 'text-warn',
      label: `Hors ligne. ${pending} en attente, gardé sur l’appareil.`,
    },
  };
  const v = variants[status];

  return (
    <div
      className={`mx-auto flex w-full max-w-md items-center gap-2 px-4 pt-3 text-xs ${v.text}`}
      role="status"
      aria-live="polite"
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${v.dot}`} aria-hidden="true" />
      {v.label}
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
