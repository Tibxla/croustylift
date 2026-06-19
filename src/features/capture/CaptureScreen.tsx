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
  listExercises,
  loadCaptureSource,
  loadCatalogExercise,
  loadChosenSeance,
  loadPersonalRecord,
  loadReference,
  loadSeanceForCapture,
  loadTodayDatedNotes,
  loadTodayProgress,
  updateExecution,
  upsertExecution,
  upsertSet,
  type LoadedSeance,
  type SeanceChoice,
  type Session,
} from './data';
import {
  addExercise,
  swapExercise,
  templateExerciseIds,
} from './session-edit';
import {
  loadExerciseNote,
  saveExerciseNote,
  upsertDatedNote as upsertDatedNoteRow,
  deleteDatedNoteById,
  datedNoteOutboxOp,
} from '../notes/data';
import {
  captureReducer,
  clearPersisted,
  getDatedNote,
  getProgress,
  hydratedState,
  loadPersisted,
  newId,
  nextSetOrder,
  pendingSide,
  persist,
  statusOf,
  todayIso,
  type DatedNoteDraft,
} from './state';
import {
  enqueue,
  flush,
  pendingCount,
  clearQueue,
  type SyncFns,
} from './outbox';
import type { PerformedSet, Side } from '../../domain/types';
import { ExercisePicker } from './ExercisePicker';
import { ExerciseCapture } from './ExerciseCapture';
import { SessionEnd, type SessionEndValues } from './SessionEnd';
import { buildSummary, elapsedMinutesSince } from './summary';

type LoadState =
  | { phase: 'loading' }
  | { phase: 'choosing'; seances: SeanceChoice[] }
  | { phase: 'error'; message: string }
  | { phase: 'empty' }
  | { phase: 'ready'; session: Session; seanceVersionId: string };

export function CaptureScreen() {
  const [load, setLoad] = useState<LoadState>({ phase: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  // Le réalisé Supabase du jour, posé par l'effet de chargement, lu par CaptureBoard.
  const hydrationRef = useRef<Record<string, PerformedSet[]>>({});
  // Les notes datées Supabase du jour (issue #26), posées au chargement, lues par CaptureBoard.
  const datedNotesRef = useRef<Record<string, DatedNoteDraft>>({});

  // Charge une séance résolue (sa version courante) vers la phase « ready » :
  // template -> références par exo -> réhydratation du réalisé du jour. Le drapeau
  // `active` évite de poser l'état si le composant s'est démonté entre-temps
  // (changement d'onglet pendant le chargement). Partagé entre la séance unique
  // chargée direct et la séance choisie dans la routine courante.
  const loadSeance = useCallback(
    async ({ seance, seanceVersionId }: LoadedSeance, active: () => boolean) => {
      const base = await loadSeanceForCapture(seance, seanceVersionId);

      // Par exo : référence (dernière fois) ET note d'instructions (issue #26),
      // affichée comme référence en Capture. En parallèle : le réalisé du jour et
      // les notes datées du jour (réhydratation au montage, Supabase fait foi).
      const [withRefs, todayProgress, todayDatedNotes] = await Promise.all([
        Promise.all(
          base.exercises.map(async (ex) => {
            // Référence (dernière fois), note d'instructions ET records (issue #34),
            // tous dérivés de l'historique de l'exo, chargés en parallèle.
            const [reference, perExerciseNote, personalRecord] = await Promise.all([
              loadReference(ex.exerciseId),
              loadExerciseNote(ex.exerciseId),
              loadPersonalRecord(ex.exerciseId),
            ]);
            return { ...ex, reference, perExerciseNote, personalRecord };
          }),
        ),
        loadTodayProgress(seanceVersionId),
        loadTodayDatedNotes(seanceVersionId),
      ]);

      if (!active()) return;
      const session: Session = { ...base, exercises: withRefs };
      // On transporte le réalisé et les notes datées chargés vers le reducer via
      // des refs, posés AVANT le passage en « ready » pour être prêts au 1ᵉʳ
      // render de CaptureBoard.
      hydrationRef.current = todayProgress;
      datedNotesRef.current = todayDatedNotes;
      setLoad({ phase: 'ready', session, seanceVersionId });
    },
    [],
  );

  // Au montage (et à chaque retour sur l'onglet Capture, qui REMONTE l'écran),
  // on lit la routine courante : si elle a des séances, on en propose le choix.
  // Sinon (aucune routine courante, ou routine courante sans séance), on ne crée
  // PLUS rien en silence (l'ancien fallback ensureStarterSeance est supprimé) :
  // on affiche un état vide. Un user totalement neuf ne passe pas par ici, App
  // l'envoie d'abord sur l'écran de premier lancement (issue #3).
  useEffect(() => {
    let alive = true;
    const active = () => alive;
    setLoad({ phase: 'loading' });

    void (async () => {
      try {
        const source = await loadCaptureSource();
        if (!alive) return;

        if (source.kind === 'choose') {
          // Choix d'une seule séance : inutile de demander, on la charge direct.
          if (source.seances.length === 1) {
            const chosen = await loadChosenSeance(source.seances[0]);
            await loadSeance(chosen, active);
            return;
          }
          setLoad({ phase: 'choosing', seances: source.seances });
          return;
        }

        // Rien d'exploitable dans la routine courante : état vide, sans création.
        setLoad({ phase: 'empty' });
      } catch (err) {
        if (!alive) return;
        setLoad({
          phase: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    })();

    return () => {
      alive = false;
    };
  }, [reloadKey, loadSeance]);

  // Clic sur une séance proposée : on la résout (version courante) et on charge.
  const chooseSeance = useCallback(
    (seance: SeanceChoice) => {
      let alive = true;
      const active = () => alive;
      setLoad({ phase: 'loading' });
      void (async () => {
        try {
          const chosen = await loadChosenSeance(seance);
          await loadSeance(chosen, active);
        } catch (err) {
          if (!alive) return;
          setLoad({
            phase: 'error',
            message: err instanceof Error ? err.message : String(err),
          });
        }
      })();
    },
    [loadSeance],
  );

  if (load.phase === 'choosing') {
    return <SeancePicker seances={load.seances} onPick={chooseSeance} />;
  }

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

  if (load.phase === 'empty') {
    return (
      <div className="mx-auto flex min-h-[calc(100vh-3.5rem)] w-full max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm text-ink-muted">
          Rien à logger pour l'instant. Va dans l'onglet Séances pour choisir ta
          routine courante et lui ajouter une séance.
        </p>
      </div>
    );
  }

  if (load.phase === 'error') {
    return (
      <div className="mx-auto flex min-h-[calc(100vh-3.5rem)] w-full max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-sm text-ink-muted">
          Impossible de charger ta séance.
        </p>
        <p className="max-w-full break-words text-xs text-warn">{load.message}</p>
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
      initialDatedNotes={datedNotesRef.current}
    />
  );
}

// --- Choix de la séance (routine courante) ----------------------------------

/**
 * Sélecteur de séance à l'arrivée en Capture : « quelle séance de ta routine
 * courante tu attaques ? ». N'apparaît que si la routine courante a au moins
 * deux séances (une seule est chargée direct ; aucune affiche l'état vide).
 * Calqué sur ExercisePicker pour l'unité visuelle (même conteneur, surfaces,
 * chevron). Pas d'accent décoratif : le violet reste pour l'action et l'état.
 */
function SeancePicker({
  seances,
  onPick,
}: {
  seances: SeanceChoice[];
  onPick: (seance: SeanceChoice) => void;
}) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col px-4 pb-28 pt-5">
      <header className="mb-5">
        <h2 className="text-2xl font-semibold tracking-tight text-ink">Ta séance</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Quelle séance tu attaques aujourd&apos;hui ?
        </p>
      </header>

      <ul className="flex flex-col gap-2.5">
        {seances.map((seance) => (
          <li key={seance.id}>
            <button
              type="button"
              onClick={() => onPick(seance)}
              className="group flex w-full items-center gap-3 rounded-2xl bg-surface px-4 py-4 text-left transition active:scale-[0.99] active:bg-surface-2"
            >
              <span className="min-w-0 flex-1 truncate text-base font-semibold text-ink">
                {seance.name}
              </span>
              <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="shrink-0 text-ink-muted"
                aria-hidden="true"
              >
                <path d="M9 6l6 6-6 6" />
              </svg>
            </button>
          </li>
        ))}
      </ul>
    </div>
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
      side: op.side,
    }),
  deleteSet: (op) => deleteSetById(op.id),
  updateExecution: (op) =>
    updateExecution({ id: op.id, bpmAvg: op.bpmAvg, durationMin: op.durationMin }),
  upsertDatedNote: (op) =>
    upsertDatedNoteRow({
      id: op.id,
      executionId: op.executionId,
      exerciseId: op.exerciseId,
      body: op.body,
    }),
  deleteDatedNote: (op) => deleteDatedNoteById(op.id),
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
  session: initialSession,
  seanceVersionId,
  initialProgress,
  initialDatedNotes,
}: {
  session: Session;
  seanceVersionId: string;
  initialProgress: Record<string, PerformedSet[]>;
  initialDatedNotes: Record<string, DatedNoteDraft>;
}) {
  const [date] = useState(todayIso);

  // La séance courante évolue à la volée : ajout / swap d'un exo hors template
  // (issue #36). Le TEMPLATE d'origine, figé au montage, reste la référence du
  // diff de déviations — il n'est JAMAIS modifié (le versionné en base non plus).
  const [session, setSession] = useState(initialSession);
  const templateIdsRef = useRef(templateExerciseIds(initialSession));

  // Restauration au montage : Supabase fait foi, localStorage est un filet
  // (survie au background / écriture offline non encore synchronisée). Pour
  // chaque exo on garde la source ayant le plus de séries.
  const [state, dispatch] = useReducer(captureReducer, null, () => {
    const fromSupabase = hydratedState(initialSession, initialProgress, initialDatedNotes, date);
    const fromLocal = loadPersisted(initialSession, date);
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
    (
      exerciseId: string,
      set: { weightKg: number; reps: number; rir: number; side?: Side },
    ) => {
      const progress = getProgress(state, exerciseId);
      // Côté de cette saisie : pour un exo unilatéral, c'est le côté CHOISI par
      // l'utilisateur via le sélecteur (issue #63), remonté dans le brouillon ;
      // bilatéral = pas de côté. On ne dérive plus « gauche d'abord ».
      const side: Side | undefined = set.side;
      // Order DÉRIVÉ comme dans le reducer (même fonction pure, agnostique de
      // l'ordre de saisie) : les deux côtés d'une série unilatérale partagent un
      // order ; simple incrément pour le bilatéral.
      const order = nextSetOrder(progress, side);
      const setId = newId();
      const loggedSet = { weightKg: set.weightKg, reps: set.reps, rir: set.rir, side };
      // 1. UI immédiate. 2. Durabilité : exécution (1×) puis la série, dans l'ordre.
      dispatch({ type: 'log-set', exerciseId, setId, set: loggedSet });
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
        side,
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

  // Enregistre la NOTE DATÉE d'un exo (issue #26). L'id de ligne est stable :
  // réutilisé s'il existe déjà (édition en place), sinon généré une fois. On
  // enfile l'exécution AVANT la note (dépendance FK note->exécution, garantie
  // aussi par le FIFO) puis l'op note (upsert si corps réel, delete si vidé,
  // tranché par datedNoteOutboxOp). UI immédiate via le reducer ; sync en fond.
  const handleSaveDatedNote = useCallback(
    (exerciseId: string, body: string) => {
      const existing = getDatedNote(state, exerciseId);
      const noteId = existing?.id ?? newId();
      dispatch({ type: 'set-dated-note', exerciseId, noteId, body });
      enqueueExecutionOnce();
      enqueueAndFlush(
        datedNoteOutboxOp({ id: noteId, executionId: state.executionId, exerciseId, body }),
      );
    },
    [state, enqueueExecutionOnce],
  );

  // Enregistre la NOTE D'INSTRUCTIONS d'un exo, éditée sur place (issue #52).
  // Persistance DIRECTE via `saveExerciseNote` (upsert si corps réel, delete si
  // vidé) — PAS l'outbox : cette note vit sur la définition de l'exo (table
  // `exercise_notes`), pas sur l'exécution du jour. MAJ optimiste : on reflète le
  // nouveau corps dans la séance en mémoire AVANT le réseau, l'affichage est
  // immédiat. Hors-ligne / erreur : on garde l'optimiste (ne pas effacer ce que
  // l'utilisateur vient de taper en salle) et on trace ; la note ressera au
  // prochain chargement si l'écriture a finalement échoué.
  const handleSaveExerciseNote = useCallback((exerciseId: string, body: string) => {
    setSession((s) => ({
      ...s,
      exercises: s.exercises.map((ex) =>
        ex.exerciseId === exerciseId ? { ...ex, perExerciseNote: body } : ex,
      ),
    }));
    void saveExerciseNote(exerciseId, body).catch((err) => {
      console.error('Échec de l’enregistrement de la note d’exercice', err);
    });
  }, []);

  // --- Ajout / swap d'un exo à la volée (issue #36) -------------------------
  // L'exo (catalogue base/perso) entre dans la SÉANCE COURANTE en mémoire ; le
  // template versionné en base reste intact. Pas d'écriture dédiée : la déviation
  // est dérivée par diff (ADR 0002). Le réalisé loggé dessus remontera comme
  // n'importe quelle série (l'outbox upsert par exerciseId), donc l'exo ajouté
  // apparaît dans le log brut et le récap.
  const handleAddExercise = useCallback((exercise: SessionExercise) => {
    setSession((s) => addExercise(s, exercise));
  }, []);

  const handleSwapExercise = useCallback(
    (targetExerciseId: string, replacement: SessionExercise) => {
      setSession((s) => swapExercise(s, targetExerciseId, replacement));
    },
    [],
  );

  const handleReset = useCallback(() => {
    clearPersisted(session, date);
    // Nouvelle exécution = id client neuf (la précédente reste en base). La file
    // est vidée : ses ops visaient l'ancienne exécution, déjà close.
    clearQueue();
    notifySync();
    executionEnqueuedRef.current = false;
    // La séance repart du template d'origine : les ajouts/swaps de l'exécution
    // close ne se reportent pas sur la suivante (un swap se redécide chaque jour).
    setSession(initialSession);
    dispatch({ type: 'reset', executionId: newId() });
    setPhase('capture');
  }, [session, date, initialSession]);

  // Après clôture : repartir sur une séance fraîche. On NE vide PAS la file —
  // les ops de la séance close doivent encore se synchroniser (contrairement à
  // « Réinitialiser » qui abandonne). Nouvelle exécution, progrès + chrono à zéro.
  const handleNewSession = useCallback(() => {
    clearPersisted(session, date);
    executionEnqueuedRef.current = false;
    setSession(initialSession);
    dispatch({ type: 'reset', executionId: newId() });
    setPhase('capture');
  }, [session, date, initialSession]);

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
      // Persiste la CLÔTURE : au remontage (changement d'onglet/reload), la séance
      // réaffiche « Séance terminée » au lieu de repasser « en cours ».
      dispatch({ type: 'close', closedAt: Date.now() });
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

  // Séance restaurée CLÔTURÉE (revenue via changement d'onglet / reload) : on
  // réaffiche la confirmation « Séance terminée » plutôt que de la repasser « en
  // cours ». La durée vient de l'écart lancement -> clôture persisté.
  if (state.closedAt !== null) {
    const closedDurationMin =
      state.closedAt > state.startedAt
        ? Math.round((state.closedAt - state.startedAt) / 60000)
        : null;
    return (
      <div className="min-h-[calc(100vh-3.5rem)]">
        <SyncBanner status={status} pending={pending} />
        <SessionEnd
          summary={summary}
          durationMin={closedDurationMin}
          onSave={() => {}}
          onBack={handleNewSession}
          onNewSession={handleNewSession}
          alreadyClosed
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
          datedNote={getDatedNote(state, activeExercise.exerciseId)?.body ?? ''}
          dispatch={dispatch}
          onLog={(set) => handleLog(activeExercise.exerciseId, set)}
          onUndo={() => handleUndo(activeExercise.exerciseId)}
          onSaveDatedNote={(body) => handleSaveDatedNote(activeExercise.exerciseId, body)}
          onSaveExerciseNote={(body) =>
            handleSaveExerciseNote(activeExercise.exerciseId, body)
          }
        />
      ) : (
        <>
          <ExercisePicker
            session={session}
            templateExerciseIds={templateIdsRef.current}
            state={state}
            onPick={(id) => dispatch({ type: 'open-exercise', exerciseId: id })}
            loadCatalog={listExercises}
            loadCatalogExercise={loadCatalogExercise}
            onAddExercise={handleAddExercise}
            onSwapExercise={handleSwapExercise}
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
  // Notes datées : le LOCAL (b) prime par exo (une saisie offline pas encore
  // synchronisée ne doit pas être écrasée par la base), mais on garde la note de
  // la base (a) pour un exo que le local ne porte pas. Les ids alignés sur
  // b.executionId restent cohérents avec les ops déjà en outbox.
  const datedNotes: CaptureState['datedNotes'] = { ...a.datedNotes, ...b.datedNotes };
  // `closedAt` vient du LOCAL (b) : la clôture est une notion locale, la base
  // n'en sait rien (a.closedAt est toujours null). Sinon une séance clôturée
  // puis quittée repasserait « en cours » au remontage.
  return {
    ...a,
    executionId: b.executionId,
    startedAt: b.startedAt,
    progress,
    datedNotes,
    closedAt: b.closedAt,
  };
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

/**
 * Libellé du bouton de log (issue #46) : explicite le côté pour un exo
 * unilatéral (« Logger le côté gauche/droite »), reste « Logger la série » pour
 * un bilatéral. L'info tient au TEXTE, jamais à la couleur seule (DESIGN.md).
 */
function logButtonLabel(side: Side | null, reachedMax: boolean): string {
  if (side === 'left') return 'Logger le côté gauche';
  if (side === 'right') return 'Logger le côté droit';
  return reachedMax ? 'Logger une série de plus' : 'Logger la série';
}

function CapturePanel({
  exercise,
  progress,
  datedNote,
  dispatch,
  onLog,
  onUndo,
  onSaveDatedNote,
  onSaveExerciseNote,
}: {
  exercise: SessionExercise;
  progress: ExerciseProgress;
  /** Corps de la note datée du jour pour cet exo (issue #26), '' si aucune. */
  datedNote: string;
  dispatch: Dispatch<CaptureAction>;
  onLog: (set: { weightKg: number; reps: number; rir: number; side?: Side }) => void;
  onUndo: () => void;
  /** Enregistre la note datée du jour (corps vidé = note effacée). */
  onSaveDatedNote: (body: string) => void;
  /** Enregistre la note d'instructions de l'exo, éditée sur place (issue #52). */
  onSaveExerciseNote: (body: string) => void;
}) {
  // Brouillon de la série courante remonté ici pour que la barre fixe puisse
  // logger. Pour un exo unilatéral, il porte aussi le côté CHOISI au sélecteur
  // (issue #63) : c'est ce côté que la barre commit, jamais un côté dérivé.
  const [draft, setDraft] = useState<{
    weightKg: number;
    reps: number;
    rir: number;
    side?: Side;
  } | null>(null);

  const unilateral = exercise.unilateral ?? false;
  // Côté que la barre va logger : pour un exo unilatéral, le côté CHOISI remonté
  // dans le brouillon (issue #63). Tant que le brouillon n'a pas encore remonté
  // de côté (1er rendu), on retombe sur le côté manquant de la série en cours
  // (`pendingSide`/`defaultSide`). Null = bilatéral.
  const currentSide: Side | null = unilateral
    ? draft?.side ?? pendingSide(progress) ?? 'left'
    : null;
  // Nombre de SÉRIES complètes : pour l'unilatéral, une série = gauche + droite,
  // donc on compte les saisies droites déjà loggées. Bilatéral = une saisie/série.
  const completedSets = unilateral
    ? progress.sets.filter((s) => s.side === 'right').length
    : progress.sets.length;
  const reachedMax = completedSets >= exercise.prescription.sets.max;

  // aria-live : annonce « série loggée » après chaque commit.
  const [announce, setAnnounce] = useState('');

  const sideLabel = (side: Side): string => (side === 'left' ? 'gauche' : 'droite');

  const logSet = useCallback(
    (set: { weightKg: number; reps: number; rir: number }) => {
      onLog(set);
      const where = currentSide ? ` côté ${sideLabel(currentSide)}` : '';
      setAnnounce(
        `Série ${completedSets + 1}${where} loggée : ${set.weightKg} kilos, ${set.reps} répétitions, RIR ${set.rir}.`,
      );
    },
    [onLog, completedSets, currentSide],
  );

  return (
    <>
      <ExerciseCapture
        exercise={exercise}
        progress={progress}
        datedNote={datedNote}
        onUndoLast={() => {
          onUndo();
          setAnnounce('Dernière série annulée.');
        }}
        onSkip={() => dispatch({ type: 'skip-exercise', exerciseId: exercise.exerciseId })}
        onBack={() => dispatch({ type: 'back-to-picker' })}
        onDraftChange={setDraft}
        onSaveDatedNote={onSaveDatedNote}
        onSaveExerciseNote={onSaveExerciseNote}
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
            className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-accent-strong text-lg font-semibold text-on-accent shadow-lg shadow-accent/20 transition active:scale-[0.98] active:bg-accent disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100"
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
            {logButtonLabel(currentSide, reachedMax)}
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
