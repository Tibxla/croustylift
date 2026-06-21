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
  type CSSProperties,
  type Dispatch,
} from 'react';
import {
  listExercises,
  loadCaptureSource,
  loadCatalogExercise,
  loadChosenSeance,
  loadPersonalRecord,
  loadPersonalRecordBySide,
  loadPreviousDatedNote,
  loadReference,
  loadSeanceForCapture,
  loadTodayExecution,
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
  datedNoteOutboxOp,
  exerciseNoteOutboxOp,
} from '../notes/data';
import {
  captureReducer,
  clearPersisted,
  getDatedNote,
  getProgress,
  hydratedState,
  isResumable,
  LAUNCH_EXPIRY_MS,
  loadPersisted,
  mergeProgress,
  newId,
  nextSetOrder,
  pendingSide,
  persist,
  previousDayIso,
  resolveCaptureDate,
  todayIso,
  type DatedNoteDraft,
  type HydratedProgress,
} from './state';
import {
  enqueue,
  flush,
  pendingCount,
  purgeByExecution,
} from './outbox';
// Le câblage outbox→Supabase est partagé avec l'édition d'une séance passée
// (sync.ts) : un seul objet `syncFns`, dédupliqué pour qu'un type d'op (ex. le
// `side` unilatéral, ADR 0005) ne diverge jamais entre les deux surfaces.
import { syncFns } from './sync';
import type { Side } from '../../domain/types';
import { pairSidesByOrder } from '../../domain/unilateral';
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

/**
 * Tout ce dont l'initialiseur du reducer de `CaptureBoard` a besoin, résolu au
 * chargement (avant le 1ᵉʳ render) pour que séries, notes et id d'exécution
 * désignent la MÊME exécution du jour ADOPTÉE :
 *   - `date` : la date adoptée (today, ou la veille si une séance entamée hier
 *     n'a pas été clôturée — frontière minuit, bug H1/F10). Résolue UNE fois ici,
 *     puis utilisée pour interroger Supabase ET comme clé de persistance ;
 *   - `executionId` : l'id RÉEL de l'exécution du jour en base si elle existe,
 *     sinon `newId()` (séance neuve). Sans quoi l'UI repartirait sous un id
 *     fantôme et créerait une 2ᵉ exécution orpheline (bug H1) ;
 *   - `progress` / `datedNotes` : le réalisé réhydraté (avec ses ids réels) ;
 *   - `restored` : le cache localStorage de la date adoptée (filet offline),
 *     fusionné par `mergeProgress` au montage.
 */
interface CaptureInit {
  date: string;
  executionId: string;
  /**
   * Lancement de la séance (epoch ms, ADR 0011) : à la REPRISE, le `started_at`
   * lu en base (chrono qui survit au reload) ; pour une séance NEUVE, l'instant du
   * « Démarrer » (≈ le tap dans le sélecteur). Le cache local (restored) prime à la
   * fusion (mergeProgress) : un lancement persisté offline gagne.
   */
  startedAt: number;
  progress: Record<string, HydratedProgress>;
  datedNotes: Record<string, DatedNoteDraft>;
  restored: CaptureState | null;
}

/**
 * Première séance de la routine qui a une capture REPRENABLE en cache local (ADR
 * 0011) : au moins une série loggée (séance en cours), ou un lancement de moins
 * d'1 h (démarrage récent). `null` si aucune — on montre alors l'écran de
 * lancement. `loadPersisted` ne lit que `session.id` pour la clé de cache, d'où la
 * séance minimale. On regarde aujourd'hui ET la veille (frontière minuit).
 */
function findResumableSeance(seances: SeanceChoice[]): SeanceChoice | null {
  const today = todayIso();
  const dates = [today, previousDayIso(today)];
  for (const seance of seances) {
    const minimalSession: Session = { id: seance.id, name: seance.name, exercises: [] };
    for (const date of dates) {
      const restored = loadPersisted(minimalSession, date);
      if (restored && isResumable(restored)) return seance;
    }
  }
  return null;
}

export function CaptureScreen() {
  const [load, setLoad] = useState<LoadState>({ phase: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  // L'init du reducer (date adoptée, id d'exécution réel, réalisé + notes du jour,
  // cache local), posée par l'effet de chargement et lue par CaptureBoard à son
  // 1ᵉʳ render. Une seule ref : séries, notes et id décrivent la même exécution.
  const initRef = useRef<CaptureInit | null>(null);

  // Charge une séance résolue (sa version courante) vers la phase « ready » :
  // template -> références par exo -> réhydratation du réalisé du jour. Le drapeau
  // `active` évite de poser l'état si le composant s'est démonté entre-temps
  // (changement d'onglet pendant le chargement). Partagé entre la séance unique
  // chargée direct et la séance choisie dans la routine courante.
  const loadSeance = useCallback(
    async ({ seance, seanceVersionId }: LoadedSeance, active: () => boolean) => {
      const base = await loadSeanceForCapture(seance, seanceVersionId);

      // Date ADOPTÉE résolue AVANT d'interroger Supabase (frontière minuit, bug
      // H1/F10) : on réhydrate le jour réellement repris, pas un `todayIso()` figé
      // qui basculerait après minuit. `resolveCaptureDate` ne dépend que de
      // l'id de séance (clé localStorage) — la séance est déjà connue ici.
      const { date, restored } = resolveCaptureDate(base);

      // Par exo : référence (dernière fois) ET note d'instructions (issue #26),
      // affichée comme référence en Capture. En parallèle : l'exécution du jour
      // ADOPTÉ (réalisé + notes + son id réel) pour la réhydratation au montage.
      const [withRefs, today] = await Promise.all([
        Promise.all(
          base.exercises.map(async (ex) => {
            // Référence (dernière fois), note d'instructions, records (issue #34),
            // records PAR CÔTÉ pour un unilatéral (ADR 0010) et la note datée
            // précédente (repère « tu notais »), tous dérivés de l'historique de
            // l'exo, chargés en parallèle. `date` (adoptée) borne la note antérieure.
            const [reference, perExerciseNote, personalRecord, personalRecordBySide, previousDatedNote] =
              await Promise.all([
                loadReference(ex.exerciseId),
                loadExerciseNote(ex.exerciseId),
                loadPersonalRecord(ex.exerciseId),
                ex.unilateral ? loadPersonalRecordBySide(ex.exerciseId) : Promise.resolve(null),
                loadPreviousDatedNote(ex.exerciseId, date),
              ]);
            return {
              ...ex,
              reference,
              perExerciseNote,
              personalRecord,
              personalRecordBySide,
              previousDatedNote,
            };
          }),
        ),
        loadTodayExecution(seanceVersionId, date),
      ]);

      if (!active()) return;
      const session: Session = { ...base, exercises: withRefs };
      // On transporte l'init vers le reducer via une ref, posée AVANT le passage
      // en « ready » pour être prête au 1ᵉʳ render de CaptureBoard. `today === null`
      // (aucune exécution en base ce jour-là) → séance neuve : id client neuf et
      // réalisé/notes vides. Sinon on ADOPTE l'id réel de l'exécution du jour.
      initRef.current = {
        date,
        executionId: today?.executionId ?? newId(),
        // Reprise d'une exécution en base → son lancement persisté (ADR 0011) ;
        // séance neuve → maintenant (≈ l'instant du « Démarrer »). Le cache local
        // (restored), s'il existe, prime à la fusion (mergeProgress).
        startedAt: today?.startedAt ?? Date.now(),
        progress: today?.progress ?? {},
        datedNotes: today?.datedNotes ?? {},
        restored,
      };
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
          // Reprise directe (ADR 0011) : une séance déjà EN COURS sur cet appareil
          // (cache local reprenable — au moins une série, ou lancement récent) se
          // rouvre sans repasser par l'écran de lancement. SINON on montre TOUJOURS
          // l'écran de lancement, même à une seule séance (« Démarrer » lance le
          // chrono) : fini la séance « déjà mise » qu'on n'a jamais démarrée. (Une
          // séance en cours seulement en base, sans cache local — multi-appareil —
          // repassera par le lancement ; la re-sélection adoptera son exécution.)
          const resumable = findResumableSeance(source.seances);
          if (resumable) {
            const chosen = await loadChosenSeance(resumable);
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
      const alive = true;
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
          className="btn btn-primary h-11 rounded-xl px-5 text-sm"
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
      // `initRef` est posé juste avant le passage en « ready » (jamais null ici).
      init={initRef.current!}
      // « Annuler la séance » / « Nouvelle séance » : on relance le chargement
      // (reloadKey) → l'écran de LANCEMENT réapparaît (le cache abandonné/nettoyé
      // n'est plus reprenable, l'exécution close est exclue), ADR 0011.
      onExitToLaunch={() => setReloadKey((k) => k + 1)}
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
  // La bannière de sync est aussi pertinente ici (on revient en salle) : on réutilise
  // le même hook que CaptureBoard, sans état nouveau.
  const { status, pending } = useSyncStatus();
  return (
    <div className="mx-auto flex w-full max-w-md flex-col px-4 pb-28 pt-2">
      <SyncBanner status={status} pending={pending} />

      <header className="mb-6 mt-5 px-1">
        <p className="readout mb-2 text-[12px] font-semibold uppercase tracking-[0.1em] text-accent-ink">
          Routine courante
        </p>
        <h2 className="text-[32px] font-semibold leading-[1.05] tracking-[-0.025em] text-ink">
          Ta séance
        </h2>
        <p className="mt-2 text-[15px] text-ink-muted">Quelle séance tu attaques&#8239;?</p>
      </header>

      <ul className="flex flex-col gap-[13px]">
        {seances.map((seance, i) => (
          <li key={seance.id} className="reveal" style={{ '--reveal-i': i } as CSSProperties}>
            <button
              type="button"
              onClick={() => onPick(seance)}
              className="surface-interactive flex w-full items-center gap-4 rounded-[20px] px-[18px] py-5 text-left"
            >
              {/* Badge lettre (position dans la routine), readout mono — signature instrument. */}
              <span className="readout flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-[13px] border border-hair bg-surface-2 text-[17px] font-semibold text-ink-muted">
                {String.fromCharCode(65 + (i % 26))}
              </span>
              <span className="min-w-0 flex-1 truncate text-lg font-semibold text-ink">
                {seance.name}
              </span>
              <svg
                viewBox="0 0 24 24"
                width="20"
                height="20"
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

      <p className="mt-6 rounded-2xl border border-dashed border-hair-strong px-4 py-4 text-center text-[13px] text-ink-faint">
        Pas la bonne routine&#8239;? Change-la dans Séances.
      </p>
    </div>
  );
}

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
  init,
  onExitToLaunch,
}: {
  session: Session;
  seanceVersionId: string;
  init: CaptureInit;
  /** Quitte la séance courante vers l'écran de lancement (annulation / après clôture). */
  onExitToLaunch: () => void;
}) {
  // Date de la séance ADOPTÉE au montage : aujourd'hui en temps normal, MAIS la
  // veille si une séance entamée hier n'a pas été clôturée (frontière minuit,
  // bug H1/F10 — sinon le réalisé en cours « disparaît » après minuit). Résolue
  // UNE fois AU CHARGEMENT (`loadSeance`), pour que l'exécution Supabase réhydratée
  // et la clé de persistance visent le MÊME jour. FIGÉE pour la vie du board : une
  // annulation / une nouvelle séance REMONTENT l'écran (onExitToLaunch) plutôt que
  // de muter la date en place, donc une const suffit (séance neuve = nouveau board).
  const initRef = useRef(init);
  const date = initRef.current.date;

  // La séance courante évolue à la volée : ajout / swap d'un exo hors template
  // (issue #36). Le TEMPLATE d'origine, figé au montage, reste la référence du
  // diff de déviations — il n'est JAMAIS modifié (le versionné en base non plus).
  const [session, setSession] = useState(initialSession);
  const templateIdsRef = useRef(templateExerciseIds(initialSession));

  // Restauration au montage : Supabase fait foi, localStorage est un filet
  // (survie au background / écriture offline non encore synchronisée). On fusionne
  // (mergeProgress) : pour chaque exo on garde la source la plus avancée, en
  // alignant les ids pour qu'aucune série affichée ne reste non annulable. On
  // ADOPTE l'id RÉEL de l'exécution du jour (init.executionId) quand elle existe
  // en base — sinon un id client neuf (séance neuve) — pour que les nouvelles ops
  // ne créent pas une exécution orpheline décorrélée des séries (bug H1).
  const [state, dispatch] = useReducer(captureReducer, null, () => {
    const { date: adoptedDate, executionId, startedAt, progress, datedNotes, restored } =
      initRef.current;
    const fromSupabase = hydratedState(
      initialSession,
      progress,
      datedNotes,
      adoptedDate,
      executionId,
      // Chrono : lancement repris de la base (reprise) ou « maintenant » (séance
      // neuve), ADR 0011. Le cache (restored) le surcharge à la fusion ci-dessous.
      startedAt,
    );
    if (!restored) return fromSupabase;
    return mergeProgress(fromSupabase, restored);
  });

  // Miroir SYNCHRONE du state pour dériver les ops d'outbox (bug M6). `state`
  // capturé par les handlers est figé entre deux renders : deux taps « Logger »
  // rapprochés liraient le MÊME state et calculeraient le MÊME set_order, alors
  // que le reducer en pose deux distincts → deux lignes au même order en base.
  // On tient donc une projection à jour : assignée à chaque render (suit undo /
  // reset / réhydratation) ET avancée localement par les handlers JUSTE après leur
  // dispatch, pour que le tap suivant parte de l'état projeté, pas du périmé. Ainsi
  // l'order (et l'id à annuler) de l'op et celui du reducer coïncident toujours.
  const stateRef = useRef(state);
  stateRef.current = state;

  // Persiste à chaque changement d'état (localStorage), SAUF une fois la séance
  // clôturée : la clôture est transitoire (ADR 0009). On nettoie alors le cache
  // pour qu'au remontage (onglet, reload, réouverture le même jour) `loadPersisted`
  // renvoie null → capture vierge, jamais l'écran « Séance terminée ». L'état reste
  // en mémoire pour le récap immédiat (phase 'finishing'). Une séance EN COURS
  // (non clôturée) continue d'être persistée : offline, on ne perd aucune série.
  useEffect(() => {
    if (state.closedAt !== null) clearPersisted(session, date);
    else persist(state);
  }, [state, session, date]);

  // --- Synchro via outbox ---------------------------------------------------
  const { status, pending } = useSyncStatus();

  // L'exécution est enfilée UNE fois par session, AVANT son premier set (la FK
  // séries→exécution impose l'ordre, garanti aussi par le FIFO de l'outbox).
  const executionEnqueuedRef = useRef(false);
  const enqueueExecutionOnce = useCallback(() => {
    if (executionEnqueuedRef.current) return;
    executionEnqueuedRef.current = true;
    // On lit la PROJECTION (stateRef) : l'id ET le `startedAt` (réancré si le
    // lancement a expiré, cf. handleLog) sont alors à jour. `started_at` matérialise
    // le LANCEMENT en base (ADR 0011), recopié de la valeur mémorisée au démarrage.
    enqueueAndFlush({
      type: 'upsertExecution',
      id: stateRef.current.executionId,
      seanceVersionId,
      performedOn: date,
      startedAt: new Date(stateRef.current.startedAt).toISOString(),
    });
  }, [seanceVersionId, date]);

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
      // On part de l'état PROJETÉ (stateRef), pas du `state` capturé : deux taps
      // rapprochés voient ainsi la 1ʳᵉ série déjà posée (bug M6).
      const current = stateRef.current;
      // Expiration du lancement (ADR 0011) : si le PREMIER set de l'exécution arrive
      // plus d'1 h après le lancement, ce dernier a expiré (chrono qui aurait tourné
      // dans le vide) → on réancre le chrono sur CE set. Sinon `startedAt` reste
      // l'instant du lancement. On avance la projection pour qu'enqueueExecutionOnce
      // (plus bas) écrive la bonne valeur en base.
      if (!executionEnqueuedRef.current && Date.now() - current.startedAt > LAUNCH_EXPIRY_MS) {
        const reanchor = { type: 'set-started-at', startedAt: Date.now() } as const;
        dispatch(reanchor);
        stateRef.current = captureReducer(stateRef.current, reanchor);
      }
      const projected = stateRef.current;
      const progress = getProgress(projected, exerciseId);
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
      // 1. UI immédiate : on dispatch ET on avance la projection synchroniquement
      //    (même reducer) pour que le tap suivant parte de cet état, pas du périmé.
      const action = { type: 'log-set', exerciseId, setId, set: loggedSet } as const;
      dispatch(action);
      stateRef.current = captureReducer(stateRef.current, action);
      // 2. Durabilité : exécution (1×, avec son started_at) puis la série, dans
      //    l'ordre. L'order dérivé de la projection coïncide toujours avec le reducer.
      enqueueExecutionOnce();
      enqueueAndFlush({
        type: 'insertSet',
        id: setId,
        executionId: projected.executionId,
        exerciseId,
        setOrder: order,
        weightKg: set.weightKg,
        reps: set.reps,
        rir: set.rir,
        side,
      });
    },
    [enqueueExecutionOnce],
  );

  const handleUndo = useCallback(
    (exerciseId: string) => {
      // Id de la dernière série encore loggée localement : c'est elle qu'on annule.
      // On lit la projection (stateRef) pour viser la BONNE dernière série même
      // après des logs synchrones non encore re-rendus (cohérent avec handleLog).
      const current = stateRef.current;
      const prev = getProgress(current, exerciseId);
      const lastId = prev.setIds[prev.setIds.length - 1] ?? null;
      const action = { type: 'undo-last-set', exerciseId } as const;
      dispatch(action);
      stateRef.current = captureReducer(current, action);
      // Une série réhydratée porte DÉSORMAIS son id réel (bug H2/F1) → on enfile un
      // `deleteSet` qui retire la ligne en base. `null` ne subsiste que pour un
      // cache d'ANCIEN format (série sans id) : rien à enfiler (le delete par id ne
      // saurait quoi viser), on annule en local seulement (rare, assumé).
      if (lastId) {
        enqueueAndFlush({ type: 'deleteSet', id: lastId });
      }
    },
    [],
  );

  // Enregistre la NOTE DATÉE d'un exo (issue #26). L'id de ligne est stable :
  // réutilisé s'il existe déjà (édition en place), sinon généré une fois. On
  // enfile l'exécution AVANT la note (dépendance FK note->exécution, garantie
  // aussi par le FIFO) puis l'op note (upsert si corps réel, delete si vidé,
  // tranché par datedNoteOutboxOp). UI immédiate via le reducer ; sync en fond.
  const handleSaveDatedNote = useCallback(
    (exerciseId: string, body: string) => {
      // Projection synchrone (stateRef), PAS le `state` capturé : deux sauvegardes
      // rapprochées de la note d'un même exo voient ainsi le noteId déjà posé par la
      // première → upsert idempotent par id, pas de 2ᵉ ligne dated_notes (bug M6,
      // aligné sur handleLog/handleUndo). On avance la projection après le dispatch.
      const current = stateRef.current;
      const existing = getDatedNote(current, exerciseId);
      const noteId = existing?.id ?? newId();
      const action = { type: 'set-dated-note', exerciseId, noteId, body } as const;
      dispatch(action);
      stateRef.current = captureReducer(current, action);
      enqueueExecutionOnce();
      enqueueAndFlush(
        datedNoteOutboxOp({ id: noteId, executionId: current.executionId, exerciseId, body }),
      );
    },
    [enqueueExecutionOnce],
  );

  // Enregistre la NOTE D'INSTRUCTIONS d'un exo, éditée sur place (issue #52).
  // Persistance via l'OUTBOX (blind F3) : cette note vit sur la définition de
  // l'exo (table `exercise_notes`), persistante, mais l'éditer hors-ligne en
  // salle doit survivre comme le reste — l'ancien chemin direct la PERDAIT au
  // reload (le catch ne faisait qu'un console.error, rien en file). `exerciseNote
  // OutboxOp` tranche upsert (corps réel) vs delete (corps vidé) ; l'op est
  // idempotente par exerciseId (singleton par user+exo). NE dépend PAS de
  // l'exécution → on n'enfile PAS d'upsertExecution. MAJ optimiste : on reflète
  // le nouveau corps dans la séance en mémoire AVANT le réseau, l'affichage est
  // immédiat ; la durabilité est portée par l'outbox.
  const handleSaveExerciseNote = useCallback((exerciseId: string, body: string) => {
    setSession((s) => ({
      ...s,
      exercises: s.exercises.map((ex) =>
        ex.exerciseId === exerciseId ? { ...ex, perExerciseNote: body } : ex,
      ),
    }));
    enqueueAndFlush(exerciseNoteOutboxOp({ exerciseId, body }));
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

  // Phase locale de fin de séance + durée chronométrée. Déclarés AVANT les callbacks
  // qui les utilisent (handleReset/handleNewSession/openFinish) : sinon `setPhase` est
  // référencé avant sa déclaration, ce qui empêche la mémoïsation d'openFinish d'être
  // préservée (React Compiler). `phase` : capture (sélecteur + panneaux) -> finishing
  // (clôture, BPM optionnel). `durationMin` null = cas dégénéré (startedAt absent).
  const [phase, setPhase] = useState<'capture' | 'finishing'>('capture');
  const [durationMin, setDurationMin] = useState<number | null>(null);

  // « Annuler la séance » (geste unique) : ABANDONNE l'exécution courante puis
  // REVIENT à l'écran de lancement (onExitToLaunch), ADR 0011. On ne reconstruit
  // PAS une capture en place (l'ancien « Réinitialiser ») : on quitte la séance.
  const handleCancelSession = useCallback(() => {
    clearPersisted(session, date);
    // Purge de la file UNIQUEMENT les ops de l'exécution abandonnée (pas toute la
    // file : d'autres exécutions/corrections offline doivent survivre). Les
    // deleteSet/deleteDatedNote restent (idempotents par id, inoffensifs).
    purgeByExecution(state.executionId);
    // L'exécution a pu être PARTIELLEMENT synchronisée (upsert + séries déjà
    // flushés) : purgeByExecution ne défait rien en base. On enfile un
    // deleteExecution (idempotent, cascade DB) pour ne pas laisser d'orpheline que
    // loadTodayExecution réhydraterait. La séance « annulée » ne revient jamais.
    enqueueAndFlush({ type: 'deleteExecution', id: state.executionId });
    executionEnqueuedRef.current = false;
    // Retour à l'écran de lancement : le cache vient d'être nettoyé et l'exécution
    // supprimée, donc rien de reprenable → on retombe sur le choix/« Démarrer ».
    onExitToLaunch();
  }, [session, date, state.executionId, onExitToLaunch]);

  // Après clôture, « Nouvelle séance » : la séance close est rangée (closed_at en
  // base, ADR 0009) et son cache déjà nettoyé. On NE vide PAS la file (ses ops
  // doivent encore se synchroniser). On revient simplement à l'écran de lancement
  // pour démarrer la prochaine séance — un nouveau lancement créera son exécution.
  const handleNewSession = useCallback(() => {
    clearPersisted(session, date);
    onExitToLaunch();
  }, [session, date, onExitToLaunch]);

  // --- Flux de fin de séance ------------------------------------------------
  // `phase`/`durationMin` sont déclarés plus haut (avant handleReset/openFinish).
  // La confirmation « Séance terminée » est gérée à l'intérieur de SessionEnd. La
  // durée est figée à l'ouverture du flux de fin (lancement -> clôture).
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
      // Clôture via l'outbox : on pose les métriques de fin (durée du chrono
      // lancement → clôture, pas une saisie ; BPM optionnel). Tout remonte seul au
      // retour du réseau.
      //
      // On NE (ré)affirme PLUS l'exécution ici (suppression de `enqueueExecutionOnce`,
      // fix orphelines) : une exécution n'existe QUE par ses séries (CONTEXT.md
      // « Exécution »), et elle est déjà créée au PREMIER log (`enqueueExecutionOnce`
      // dans `handleLog`, durable même offline). Si AUCUNE série n'a été loggée dans
      // CETTE exécution — cas où des séries fantômes restaurées du cache rendent
      // `loggedAny` vrai sans qu'aucun log ne soit parti — la ligne n'existe pas en
      // base : l'`updateExecution` ci-dessous ne touche AUCUNE ligne (no-op) au lieu
      // de fabriquer une orpheline durée-sans-séries qui polluerait le graphe Cardio.
      // Un seul instant de clôture : en base (ISO) ET en mémoire (epoch ms).
      const closedAtMs = Date.now();
      enqueueAndFlush({
        type: 'updateExecution',
        id: state.executionId,
        bpmAvg: values.bpmAvg,
        durationMin: durationMin ?? undefined,
        // Matérialise la clôture EN BASE (ADR 0009) : `loadTodayExecution` filtre
        // sur `closed_at`, donc cette séance « rangée » n'est PLUS réhydratée — on
        // repart vraiment vierge même après un reload (le cache local, lui, est
        // nettoyé par le câblage de persistance, cf. l'effet plus bas).
        closedAt: new Date(closedAtMs).toISOString(),
      });
      // Pose la CLÔTURE en mémoire : SessionEnd montre le récap dans la foulée
      // (son état `saved`) ; le câblage de persistance nettoie alors le cache.
      dispatch({ type: 'close', closedAt: closedAtMs });
    },
    [state.executionId, durationMin],
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

  // Plus de réaffichage de l'écran de fin au remontage : la clôture est un geste
  // transitoire (ADR 0009). Le récap juste après clôture reste assuré par la phase
  // locale 'finishing' (état `saved` de SessionEnd) ; au remontage le cache est
  // nettoyé et l'état restauré est forcément « en cours » (closedAt null), donc on
  // retombe directement sur le picker / la capture vierge ci-dessous.

  return (
    <div className="min-h-[calc(100vh-3.5rem)]">
      <SyncBanner status={status} pending={pending} />
      {activeExercise ? (
        <CapturePanel
          key={activeExercise.exerciseId}
          exercise={activeExercise}
          position={
            session.exercises.findIndex(
              (e) => e.exerciseId === activeExercise.exerciseId,
            ) + 1
          }
          total={session.exercises.length}
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
            onCancelSession={handleCancelSession}
          />
          <FinishBar canFinish={loggedAny} onFinish={openFinish} />
        </>
      )}
    </div>
  );
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
      dot: 'bg-good shadow-[0_0_8px_var(--color-good)]',
      text: 'text-ink-muted',
      label: 'Synchronisé. Tout est en base.',
    },
    pending: {
      dot: 'bg-accent shadow-[0_0_8px_var(--color-accent)]',
      text: 'text-ink-muted',
      label: `Synchronisation… ${pending} en attente.`,
    },
    offline: {
      dot: 'bg-warn shadow-[0_0_8px_var(--color-warn)]',
      text: 'text-warn',
      label: `Hors ligne. ${pending} en attente, gardé sur l’appareil.`,
    },
  };
  const v = variants[status];

  return (
    <div
      className={`mx-auto flex w-full max-w-md items-center gap-2.5 px-4 pt-3 text-[12.5px] ${v.text}`}
      role="status"
      aria-live="polite"
    >
      <span className={`h-[7px] w-[7px] shrink-0 rounded-full ${v.dot}`} aria-hidden="true" />
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
  position,
  total,
  progress,
  datedNote,
  dispatch,
  onLog,
  onUndo,
  onSaveDatedNote,
  onSaveExerciseNote,
}: {
  exercise: SessionExercise;
  /** Position de l'exo dans la séance (1-indexé) + total, pour le repère « EXO N / M ». */
  position?: number;
  total?: number;
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
  // donc on compte les ORDERS dont les DEUX côtés sont présents (blind F4 : compter
  // les saisies droites restait à 0 si l'utilisateur loggeait deux fois le même
  // côté). Bilatéral = une saisie/série. Sert au numéro annoncé en aria-live.
  const completedSets = unilateral
    ? pairSidesByOrder(progress.sets).filter((p) => p.left !== null && p.right !== null).length
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
        position={position}
        total={total}
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

      {/* Barre d'action primaire fixe — pouce, accent violet, 1 tap. Fond en dégradé
          transparent→bg : le bouton « flotte » au-dessus du contenu qui défile. */}
      <div className="fixed inset-x-0 bottom-[var(--nav-offset)] z-10 bg-[linear-gradient(180deg,transparent,var(--color-bg)_30%)] px-4 pb-3 pt-6">
        <div className="mx-auto w-full max-w-md">
          <button
            type="button"
            disabled={!draft}
            onClick={() => draft && logSet(draft)}
            className="btn btn-primary h-[58px] w-full rounded-[18px] text-lg"
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

/**
 * Barre d'action fixe du bas du sélecteur : UNIQUEMENT « Terminer la séance », dès
 * qu'au moins une série est loggée (`canFinish`). L'annulation a quitté cette barre
 * pour l'en-tête du sélecteur (« Annuler la séance », toujours visible, même séance
 * vide). Collée à la nav (`pb-3`, sans `env(safe-area)` redondant). Cachée tant
 * qu'aucune série n'est loggée (rien à terminer).
 */
function FinishBar({ canFinish, onFinish }: { canFinish: boolean; onFinish: () => void }) {
  if (!canFinish) return null;
  return (
    <div className="fixed inset-x-0 bottom-[var(--nav-offset)] z-10 border-t border-hair bg-bg/95 px-4 pb-3 pt-3 backdrop-blur-sm">
      <div className="mx-auto w-full max-w-md">
        <button
          type="button"
          onClick={onFinish}
          className="btn btn-primary h-12 w-full rounded-2xl text-base"
        >
          Terminer la séance
        </button>
      </div>
    </div>
  );
}
