// Orchestrateur picker ↔ panneau. La séance vient de Supabase (vraies données,
// scopées à l'user par RLS). L'UI reste pilotée par un reducer local ; la
// DURABILITÉ passe par l'OUTBOX : chaque mutation écrit l'état local (UI
// immédiate) ET enfile une op (outbox.ts), synchronisée en fond. Une écriture
// qui échoue (wifi de salle coupé) reste en file et remonte SEULE au retour du
// réseau. localStorage survit au background ; l'outbox survit au reload.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type Dispatch,
} from 'react';
import {
  catalogExerciseToSession,
  listExercisesForCapture,
  listSeanceVersionIds,
  loadCaptureSource,
  loadCatalogExercise,
  deriveExerciseHistory,
  loadExerciseRows,
  loadChosenSeance,
  loadExerciseNoteCached,
  loadLastSeanceExecution,
  loadPreviousDatedNotes,
  loadSeanceForCapture,
  loadTodayExecutionWithin,
  onExerciseRowsWritten,
  peekExerciseHistory,
  pruneCaptureCopies,
  sameExerciseHistory,
  TODAY_READ_BUDGET_MS,
  type LoadedSeance,
  type SeanceChoice,
  type SeanceHistoryContext,
  type Session,
  type TodayExecution,
} from './data';
import type { PreviousDatedNote } from './fixtures';
import {
  layoutEditOf,
  replayLayout,
  templateExerciseIds,
} from './session-edit';
import {
  datedNoteOutboxOp,
  exerciseNoteOutboxOp,
} from '../notes/data';
import { datedNoteId } from '../notes/dated-note-id';
import {
  adoptedVersionId,
  captureReducer,
  clearPersisted,
  getDatedNote,
  getProgress,
  hydratedState,
  canAdoptLateExecution,
  isExecutionStarted,
  isResumable,
  loadPersisted,
  newId,
  nextSetOrder,
  pendingSide,
  persist,
  retryPersistCaptureState,
  persistedVersionIds,
  pruneStaleCaptureStates,
  previousDayIso,
  openingState,
  resolveCaptureDate,
  onSetsAbandoned,
  shouldReanchorLaunch,
  todayIso,
  type DatedNoteDraft,
  type HydratedProgress,
} from './state';
import {
  enqueue,
  enqueueAll,
  OUTBOX_CHANGED_EVENT,
  purgeByExecution,
  readOwnQueue,
  readQueue,
  readStamp,
  writesSince,
  type OutboxOp,
  type ReadStamp,
} from './outbox';
// Le câblage outbox→Supabase est partagé avec l'édition d'une séance passée
// (sync.ts) : un seul objet `syncFns`, dédupliqué pour qu'un type d'op (ex. le
// `side` unilatéral, ADR 0005) ne diverge jamais entre les deux surfaces. On
// passe par `flushOutbox`, qui relit aussi les copies d'historique acquittées.
import { flushOutbox } from './sync';
import { boundSetValues } from './stepper-utils';
import { createLateMailbox, type LateMailbox } from './late-reality';
import type { Side } from '../../domain/types';
import { pairSidesByOrder, targetSlotForSide } from '../../domain/unilateral';
import { ExercisePicker } from './ExercisePicker';
import { ExerciseCapture } from './ExerciseCapture';
import type { IndexItem } from './ExerciseIndex';
import { exoCounts, exoState, logicalSetsDone, nextExerciseId, resumeWord } from './salle-progress';
import { formatWeight } from './format';
import { EmptyState, List, PrimaryButton, Row, ScreenHeader, SecondaryButton, SyncBanner, TextLink } from '../../ui';
import { useGoToSurface } from '../../shell/navigation';
import { syncLine } from '../../shell/sync-line';
import { useSyncState } from '../../shell/useSyncState';
import { refusedAction, useOpenRefusedWrites } from '../../shell/refused-context';
import { SessionEnd, type SessionEndValues } from './SessionEnd';
import { elapsedMinutesSince } from './summary';
import { sommaireDetail } from './sommaire-detail';
import { isDoubleTap, type LogStamp } from './log-guard';
import { onQueueChanged } from './queue-changes';
import { mergePendingExecutions, peekSeancesMeta, readAckedExecutions, seanceMetaLine } from './seance-meta';
import { buildSessionRecap, performedToday } from './session-recap';
import { loadWeekMuscles, type WeekMusclesInput } from './week-muscles';
import { formatRelativeDay } from './format';
import { errorMessage } from '../../lib/error-message';
import { correctSet, deleteSet, type SetEntry, type SetGesture } from './set-gestures';
import { replaceExercise, restoreSkippedExercise } from './exercise-gestures';
import { enteredElsewhere, leaveSession, nothingEntered } from './session-gestures';

type LoadState =
  | { phase: 'loading' }
  | { phase: 'choosing'; seances: SeanceChoice[] }
  | { phase: 'error'; message: string }
  | { phase: 'empty' }
  | {
      phase: 'ready';
      template: Session;
      /** Exos du journal de disposition, dans l'ordre des gestes. */
      extras: (SessionExercise | null)[];
      /**
       * L'id d'exécution posé par ce chargement. Il entre dans la clé du tableau
       * de capture : un chargement qui adopte une AUTRE exécution (réponse
       * tardive de la base) doit remonter le tableau, dont l'état est initialisé
       * une seule fois. Passer par la phase « loading » ne suffit pas : quand
       * tout se lit sur les copies locales, React regroupe les deux mises à jour
       * et le tableau resterait monté sur l'id provisoire.
       */
      executionId: string;
      /** Génération du chargement qui a produit cet état (cf. `loadGenRef`). */
      generation: number;
      seanceVersionId: string;
      /** Contexte d'historique de la séance (scope Référence + repère notes), partagé avec les exos ajoutés à la volée. */
      historyCtx: SeanceHistoryContext;
    };

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
   * `executionId` est-il celui d'une exécution LUE EN BASE (reprise), et non un
   * id client neuf ? L'un des signes qu'elle existe déjà : son chrono ne doit
   * alors plus jamais être réancré (cf. `isExecutionStarted`).
   */
  executionInBase: boolean;
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
  /**
   * L'estampille de la lecture de la base (`TodayExecution.stamp`) quand elle a
   * RÉPONDU pour l'exécution adoptée : `progress` et `datedNotes` sont alors
   * cette lecture, et le tableau y applique les écritures locales qu'elle ne
   * contient pas (execution-reality.ts). `null` : la base n'a pas répondu, ou
   * rien n'existe encore ; l'état local, s'il y en a un, tient lieu de lecture.
   */
  readStamp: ReadStamp | null;
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

/** L'éviction des copies périmées n'a lieu qu'une fois par lancement de l'app. */
let copiesPruned = false;

export function CaptureScreen() {
  const [load, setLoad] = useState<LoadState>({ phase: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  // L'init du reducer (date adoptée, id d'exécution réel, réalisé + notes du jour,
  // cache local), posée par l'effet de chargement et lue par CaptureBoard à son
  // 1ᵉʳ render. Une seule ref : séries, notes et id décrivent la même exécution.
  const initRef = useRef<CaptureInit | null>(null);

  // Boîte par laquelle une réponse TARDIVE de la base atteint le tableau monté.
  // Elle GARDE la réponse arrivée avant le montage du tableau (le chargement
  // continue après la borne de 3 s), étiquetée par génération de chargement et
  // par exécution, jusqu'à ce que ce tableau-là vienne la prendre.
  const [lateBox] = useState(() => createLateMailbox<TodayExecution>());
  // L'état courant du tableau monté, lu à la demande (adoption tardive, cf.
  // `canAdoptLateExecution`). Posé par le tableau à son montage, retiré au
  // démontage.
  const boardStateRef = useRef<(() => CaptureState) | null>(null);

  // Numéro du chargement en cours : incrémenté à chaque ouverture demandée
  // (montage, choix d'une séance, retour au lancement). Une réponse tardive ne
  // s'applique qu'au chargement qui l'a demandée.
  const loadGenRef = useRef(0);

  // Charge une séance résolue vers la phase « ready » : identité et version de
  // l'exécution adoptée -> template de CETTE version -> références par exo ->
  // réhydratation du réalisé du jour. Le drapeau `active` évite de poser l'état si
  // le composant s'est démonté entre-temps (changement d'onglet pendant le
  // chargement). Partagé entre la reprise directe et la séance choisie.
  //
  // CHEMIN D'OUVERTURE ET RÉSEAU (ADR 0012). Tout se lit sur les copies locales,
  // sauf UNE lecture : l'exécution du jour, qui n'a pas de copie (une copie
  // d'avant la Clôture ressusciterait une séance rangée). Elle est attendue en
  // premier, parce qu'elle dit quelle exécution et quelle version adopter, mais
  // BORNÉE à 3 s (`loadTodayExecutionWithin`) : au-delà la séance s'ouvre sur
  // l'état local. Le repère « tu notais » est borné de même dans sa couche.
  //
  // `adopt` : réponse TARDIVE de cette lecture, appliquée après coup (cf. plus
  // bas). Elle remplace alors la lecture, et l'état local provisoire est ignoré.
  const loadSeance = useCallback(
    async (
      loaded: LoadedSeance,
      active: () => boolean,
      adopt?: { today: TodayExecution; date: string },
    ) => {
      const { seance, seanceVersionId: currentVersionId } = loaded;
      // `resolveCaptureDate` et la persistance ne lisent que l'id de la séance.
      const shell: Session = { id: seance.id, name: seance.name, exercises: [] };

      // Date ADOPTÉE résolue AVANT d'interroger Supabase (frontière minuit, bug
      // H1/F10) : on réhydrate le jour réellement repris, pas un `todayIso()` figé
      // qui basculerait après minuit.
      const { date, restored } = adopt
        ? { date: adopt.date, restored: null }
        : resolveCaptureDate(shell);

      // Le scope de la Référence (cf. GLOSSARY.md) : TOUTES les versions de la
      // séance, l'historique de l'exo traverse les retouches du template. Et les
      // notes datées de la DERNIÈRE exécution passée (repère « tu notais », une
      // requête pour tous les exos, bornée par la date adoptée). Lancées tout de
      // suite, attendues plus bas.
      const versionIdsRead = listSeanceVersionIds(seance.id);
      void versionIdsRead.catch(() => {});
      // Les deux lectures du repère s'enchaînent, chacune bornée dans sa couche :
      // ensemble elles tiennent sous le MÊME budget que l'exécution du jour, pour
      // qu'un jour nouveau sur un réseau qui pend n'allonge pas l'ouverture.
      const notesRead = Promise.race([
        loadLastSeanceExecution(seance.id, date).then((last) =>
          loadPreviousDatedNotes(seance.id, last),
        ),
        new Promise<Record<string, PreviousDatedNote>>((resolve) =>
          setTimeout(() => resolve({}), TODAY_READ_BUDGET_MS),
        ),
      ]);

      // L'exécution du jour ADOPTÉ. Celle que l'appareil tient déjà se relit par
      // son id ; sinon c'est l'exécution ouverte du jour de la SÉANCE, quelle que
      // soit sa version (plan retouché entre-temps, autre appareil).
      const { today, late } = adopt
        ? { today: adopt.today, late: null }
        : await loadTodayExecutionWithin(seance.id, date, restored?.executionId ?? null);

      // La VERSION suit l'exécution adoptée (ADR 0021) : une séance retouchée en
      // plein entraînement n'emmène pas l'exécution entamée sous son nouveau
      // plan, donc l'écran recharge le template sous lequel elle est née.
      const versionId = adoptedVersionId({
        restored,
        pendingOps: readQueue(),
        today,
        currentVersionId,
      });
      let seanceVersionId = versionId;
      let base: Session;
      try {
        base = await loadSeanceForCapture(seance, versionId);
      } catch (err) {
        // Template d'une version antérieure illisible (ni copie ni réseau) : on
        // retombe sur celui de la version courante plutôt que de fermer la séance.
        if (versionId === currentVersionId) throw err;
        seanceVersionId = currentVersionId;
        base = await loadSeanceForCapture(seance, currentVersionId);
      }

      // Par exo : dérivées d'historique (Référence scopée séance, repli de
      // préremplissage, records all-time : UNE lecture par exo) et note
      // d'instructions (issue #26). Tout sur copies locales.
      const withHistory = async (ex: SessionExercise) => {
        const [rows, perExerciseNote] = await Promise.all([
          loadExerciseRows(ex.exerciseId),
          loadExerciseNoteCached(ex.exerciseId),
        ]);
        return { ...ex, rows, perExerciseNote };
      };
      // DISPOSITION (exos ajoutés ou remplacés pendant la séance) : celle que
      // porte l'état local, donc celle de SON exécution, jamais reconstruite depuis
      // les séries en base. Chaque exo du journal se relit comme un exo du plan ;
      // ses copies existent (l'ajout les a semées sur ce téléphone). Si une
      // lecture échoue malgré tout, la séance s'ouvre sans lui à ce montage,
      // plutôt que de ne pas s'ouvrir, et jamais avec une note vide éditable.
      const layout = restored?.layout ?? [];
      const [withRows, extras, versionIds, previousDatedNotes] = await Promise.all([
        Promise.all(base.exercises.map(withHistory)),
        Promise.all(
          layout.map((edit) => withHistory(catalogExerciseToSession({
            id: edit.exerciseId,
            name: edit.name,
            unilateral: edit.unilateral,
            primary_muscles: edit.primaryMuscles,
          })).catch(() => null)),
        ),
        versionIdsRead,
        notesRead,
      ]);

      if (!active()) return;

      // L'exécution du jour ADOPTÉE, écartée du repère « dernière fois » (ADR
      // 0014). Ordre de priorité identique à celui du reducer : le cache local
      // (`restored`) prime sur la base (cf. mergeProgress), qui prime sur
      // « aucune exécution ».
      const currentExecutionId = restored?.executionId ?? today?.executionId ?? null;

      const derived = ({ rows, ...ex }: Awaited<ReturnType<typeof withHistory>>): SessionExercise => ({
        ...ex,
        ...deriveExerciseHistory(
          rows,
          ex.exerciseId,
          versionIds,
          ex.unilateral ?? false,
          currentExecutionId,
        ),
        previousDatedNote: previousDatedNotes[ex.exerciseId] ?? null,
      });
      // On transporte l'init vers le reducer via une ref, posée AVANT le passage
      // en « ready » pour être prête au 1ᵉʳ render de CaptureBoard. `today === null`
      // (aucune exécution en base ce jour-là) → séance neuve : id client neuf et
      // réalisé/notes vides. Sinon on ADOPTE l'id réel de l'exécution du jour.
      const init: CaptureInit = {
        date,
        executionId: today?.executionId ?? newId(),
        executionInBase: today !== null,
        // Reprise d'une exécution en base → son lancement persisté (ADR 0011) ;
        // séance neuve → maintenant (≈ l'instant du « Démarrer »). Le cache local
        // (restored), s'il existe, prime à la fusion (mergeProgress).
        startedAt: today?.startedAt ?? Date.now(),
        progress: today?.progress ?? {},
        datedNotes: today?.datedNotes ?? {},
        restored,
        // La base a répondu pour l'exécution adoptée : sa lecture fait foi. Si
        // l'état local tient une AUTRE exécution, c'est lui qui prime (cf. le
        // réducteur) et cette lecture ne le concerne pas.
        readStamp: today && (!restored || today.executionId === restored.executionId) ? today.stamp : null,
      };
      initRef.current = init;
      setLoad({
        phase: 'ready',
        template: { ...base, exercises: withRows.map(derived) },
        extras: extras.map((extra) => extra && derived(extra)),
        generation: loadGenRef.current,
        executionId: init.executionId,
        seanceVersionId,
        historyCtx: {
          seanceVersionIds: versionIds,
          previousDatedNotes,
          // L'id ADOPTÉ par le reducer : `init` pose `newId()` quand rien
          // n'existe, et c'est bien lui que porteront les séries du jour.
          currentExecutionId: currentExecutionId ?? init.executionId,
        },
      });

      // DÉLAI DÉPASSÉ, sans état local : la séance vient de s'ouvrir sous un id
      // PROVISOIRE, alors que la base tient peut-être une exécution ouverte
      // (séance entamée sur un autre appareil). Un délai n'est pas une absence :
      // quand la réponse arrive, si elle rend une exécution et que RIEN n'a encore
      // été saisi sous l'id provisoire, on l'adopte en rechargeant la séance avec
      // elle (la lecture n'est pas relancée). Si une saisie est déjà partie sous
      // l'id provisoire, ou si l'utilisateur a déjà agi sur le tableau (exo
      // ouvert, ajouté, remplacé, passé), il est trop tard : la séance garde son
      // exécution provisoire, comme hors ligne.
      if (late && restored === null) {
        const gen = loadGenRef.current;
        void late.then((lateToday) => {
          if (!lateToday || !active() || loadGenRef.current !== gen) return;
          // L'utilisateur a déjà agi sur le tableau provisoire (exo ouvert, donc
          // brouillon peut-être réglé ; exo ajouté, remplacé ou passé) : on
          // n'adopte PAS, pour ne rien lui retirer des mains. Transférer ces
          // gestes vers l'exécution adoptée demanderait de fusionner deux états ;
          // le choix sûr est de ne remonter le tableau que s'il est intact.
          // On juge l'état COURANT du tableau monté, pas sa copie enregistrée :
          // stockage plein, la copie n'a pas pu suivre et paraissait intacte.
          // Tableau pas encore monté : la copie (s'il y en a une) fait foi.
          const current = boardStateRef.current?.() ?? loadPersisted(shell, date);
          if (!canAdoptLateExecution(current, init.executionId, readQueue())) return;
          // L'état provisoire primerait à la fusion : il est retiré, et l'écran
          // repasse par le chargement (aucune saisie possible pendant l'adoption).
          clearPersisted(shell, date);
          setLoad({ phase: 'loading' });
          loadSeance(loaded, active, { today: lateToday, date }).catch((err: unknown) => {
            if (!active() || loadGenRef.current !== gen) return;
            setLoad({
              phase: 'error',
              message: errorMessage(err),
            });
          });
        });
      }

      // DÉLAI DÉPASSÉ, AVEC un état local : son exécution prime, pas d'adoption.
      // Mais la réponse tardive qui la concerne porte peut-être des séries
      // écrites ailleurs (autre appareil, journal) : ignorée, le rang suivant
      // doublait un rang déjà pris. Elle est donc remise au tableau monté, qui
      // établit son réalisé sur elle sans se remonter (ni l'exo ouvert ni le
      // brouillon ne bougent). Elle porte l'estampille de son départ : ce que
      // l'utilisateur a saisi, corrigé ou annulé pendant le trajet est au
      // registre et lui est appliqué par-dessus (execution-reality.ts).
      if (late && restored !== null) {
        const gen = loadGenRef.current;
        void late.then((lateToday) => {
          if (!lateToday || !active() || loadGenRef.current !== gen) return;
          if (lateToday.executionId !== restored.executionId) return;
          // Remise par la boîte : le tableau n'est peut-être pas encore monté.
          // Il relève les écritures locales au moment d'appliquer la réponse.
          lateBox.post(gen, restored.executionId, lateToday);
        });
      }
    },
    [lateBox],
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
    loadGenRef.current += 1;
    setLoad({ phase: 'loading' });

    // Flush de l'outbox dès l'ARRIVÉE sur l'écran, quelle que soit la phase
    // (incident 2026-07-30) : les autres déclencheurs (montage de CaptureBoard,
    // retour réseau, enqueue) supposent une séance OUVERTE. Séance clôturée →
    // l'app s'ouvre sur le sélecteur, où la bannière affichait « N en attente »
    // sans que RIEN ne retente jamais — la file dormait jusqu'à la prochaine
    // séance. Ici, ouvrir l'app suffit à la vider. Idempotent (flush sérialisé).
    void attemptFlush();

    // Ménage des copies de lecture qui ne seront plus lues (une fois par lancement).
    if (!copiesPruned) {
      copiesPruned = true;
      // Les séances en cours gardent le template de leur version de naissance.
      pruneCaptureCopies(persistedVersionIds());
      // Et des états de capture d'avant la veille, que plus rien ne reprend.
      pruneStaleCaptureStates();
    }

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
          message: errorMessage(err),
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
      loadGenRef.current += 1;
      setLoad({ phase: 'loading' });
      void (async () => {
        try {
          const chosen = await loadChosenSeance(seance);
          await loadSeance(chosen, active);
        } catch (err) {
          if (!alive) return;
          setLoad({
            phase: 'error',
            message: errorMessage(err),
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
    // Une ligne, sans animation : le chargement est court et revient souvent.
    return (
      <p role="status" className="px-5 pt-6 text-[16px] text-muted">
        Chargement de la séance…
      </p>
    );
  }

  if (load.phase === 'empty') {
    return <NothingToLog />;
  }

  if (load.phase === 'error') {
    return (
      <EmptyState
        title="Impossible de charger ta séance."
        body={<span className="break-words">{load.message}</span>}
        action={<SecondaryButton onClick={() => setReloadKey((k) => k + 1)}>Réessayer</SecondaryButton>}
      />
    );
  }

  return (
    <CaptureBoard
      key={`${load.template.id}:${load.executionId}`}
      template={load.template}
      extras={load.extras}
      lateBox={lateBox}
      boardStateRef={boardStateRef}
      generation={load.generation}
      seanceVersionId={load.seanceVersionId}
      historyCtx={load.historyCtx}
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
 * « Quelle séance ? » à l'arrivée en Salle, parmi les séances de la routine
 * courante. Une ligne par séance, dans l'ordre de la routine : son nom, et
 * dessous quand elle a été faite pour la dernière fois et combien d'exos elle
 * compte (seance-meta.ts), pour ne pas lancer la mauvaise d'une routine A/B. La
 * liste s'affiche sans attendre cette méta : sa ligne est réservée.
 */
function SeancePicker({
  seances,
  onPick,
}: {
  seances: SeanceChoice[];
  onPick: (seance: SeanceChoice) => void;
}) {
  const go = useGoToSurface();
  const idsKey = seances.map((s) => s.id).join(',');
  const [stored, setStored] = useState(peekSeancesMeta);
  const [queue, setQueue] = useState(readOwnQueue);
  useEffect(() => {
    // La lecture réseau est chargée à la demande (seance-meta-load.ts) : sans
    // elle, la copie locale reste ce qui s'affiche.
    let watch: { stop: () => void; revalidate: () => void } | null = null;
    let alive = true;
    // La file a pu changer (flush ici ou ailleurs, geste, retour du réseau) :
    // on relit la file ET la méta, tant que le sélecteur est monté. Une
    // exécution acquittée quitte la file : sa date doit venir de la base.
    const offQueue = onQueueChanged(() => {
      setQueue(readOwnQueue());
      watch?.revalidate();
    });
    void import('./seance-meta-load').then(
      (m) => {
        if (alive) watch = m.watchSeancesMeta(idsKey ? idsKey.split(',') : [], setStored);
      },
      () => {},
    );
    return () => {
      alive = false;
      offQueue();
      watch?.stop();
    };
  }, [idsKey]);
  // La file, plus les exécutions acquittées qu'aucune relecture n'a encore
  // apportées (seance-meta.ts) : relues à chaque changement de la file ou de la
  // méta.
  const meta = useMemo(() => mergePendingExecutions(stored, [...queue, ...readAckedExecutions()]), [stored, queue]);
  const today = todayIso();
  return (
    <div className="flex flex-1 flex-col">
      <SalleSync />
      <ScreenHeader title="Quelle séance ?" meta="Parmi celles de ta routine courante." />
      <List label="Séances de la routine courante">
        {seances.map((seance) => (
          <Row
            key={seance.id}
            title={seance.name}
            // Espace insécable tant que rien n'est connu : la hauteur est tenue.
            meta={seanceMetaLine(meta[seance.id] ?? null, today) ?? '\u00a0'}
            onClick={() => onPick(seance)}
          />
        ))}
      </List>
      {/* La question, puis le chemin sur sa propre ligne : la même mise en
          page à 360 et à 390 px, cible de 44 px. */}
      <div className="px-5 pt-4">
        <p className="text-[15px] leading-[1.45] text-muted">Pas la bonne routine ?</p>
        <TextLink tone="muted" onClick={() => go('seances')}>
          Change-la dans Séances
        </TextLink>
      </div>
    </div>
  );
}

/** Aucune séance dans la routine courante : le chemin vers Séances est donné. */
function NothingToLog() {
  const go = useGoToSurface();
  return (
    <EmptyState
      title="Rien à logger pour l’instant."
      body="Choisis ta routine courante dans Séances et ajoute-lui une séance."
      action={<TextLink onClick={() => go('seances')}>Aller dans Séances</TextLink>}
    />
  );
}

// --- Fraîcheur de la ligne de synchro ---------------------------------------

/** À appeler après tout changement de file (enqueue / flush) : la ligne de
 *  synchro et le bouton Sommaire (src/shell/useSyncState.ts) relisent la file
 *  tout de suite au lieu d'attendre leur relecture périodique. */
function notifySync() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(OUTBOX_CHANGED_EVENT));
}

/** Tente un flush puis notifie l'UI (longueur de file potentiellement changée). */
async function attemptFlush(): Promise<void> {
  try {
    await flushOutbox();
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

/** Enfile les ops d'UN geste comme une unité (`enqueueAll`, outbox.ts : tout sur
 *  l'appareil ou tout en mémoire), notifie l'UI et tente un flush. */
function enqueueGestureAndFlush(ops: readonly OutboxOp[]): void {
  if (ops.length === 0) return;
  enqueueAll(ops);
  notifySync();
  void attemptFlush();
}

// --- Le tableau de capture (séance chargée) ---------------------------------

function CaptureBoard({
  template: initialTemplate,
  extras: initialExtras,
  lateBox,
  boardStateRef,
  generation,
  seanceVersionId,
  historyCtx,
  init,
  onExitToLaunch,
}: {
  template: Session;
  extras: (SessionExercise | null)[];
  /** Boîte des réponses tardives de la base (cf. `loadSeance`, late-reality.ts). */
  lateBox: LateMailbox<TodayExecution>;
  /** Où le tableau dépose de quoi lire son état courant (cf. CaptureScreen). */
  boardStateRef: { current: (() => CaptureState) | null };
  /** Génération du chargement dont ce tableau est issu : il ne prend que ses réponses. */
  generation: number;
  seanceVersionId: string;
  /** Contexte d'historique de la séance (scope Référence + repère notes) pour les exos ajoutés à la volée. */
  historyCtx: SeanceHistoryContext;
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
  // de muter la date en place, donc un état sans setter suffit (séance neuve =
  // nouveau board).
  const [date] = useState(() => init.date);

  // Garder aussi les exos masqués : une série du Journal peut les faire
  // revenir avec leur prescription, leur historique et leur note.
  const [sources, setSources] = useState({ template: initialTemplate, extras: initialExtras });

  // RÉFÉRENCE SUIVIE EN DIRECT (ADR 0020). La séance s'ouvre sur les copies
  // locales, que leur revalidation de fond rattrape juste APRÈS : une série
  // écrite depuis un autre appareil, ou une relecture restée en vol quand l'app
  // a été tuée, n'atteignait l'écran qu'à son remontage suivant. Dès que la copie
  // d'historique d'un exo change, sa dérivation est donc rejouée ici (sans
  // réseau : copie + file, cf. `peekExerciseHistory`) et l'exo n'est remplacé
  // que si le résultat DIFFÈRE (chaque série acquittée réécrit sa copie). Seul
  // l'historique change : référence, repli de préremplissage, records. Le
  // brouillon de la série en cours, lui, ne bouge plus dès qu'il a été touché
  // (cf. ExerciseCapture, `shouldReseedDraft`). Une copie absente ne change rien.
  // La dérivation est aussi rejouée une fois à l'abonnement : la revalidation a
  // pu répondre entre la lecture des lignes et ce montage.
  useEffect(() => {
    let subscribed = true;
    const refresh = (onlyExerciseId?: string) => {
      if (!subscribed) return;
      setSources((current) => {
        let changed = false;
        const refreshExercise = (ex: SessionExercise) => {
          if (onlyExerciseId !== undefined && ex.exerciseId !== onlyExerciseId) return ex;
          const history = peekExerciseHistory(
            ex.exerciseId,
            historyCtx.seanceVersionIds,
            ex.unilateral ?? false,
            historyCtx.currentExecutionId,
          );
          if (history === null || sameExerciseHistory(ex, history)) return ex;
          changed = true;
          return { ...ex, ...history };
        };
        const exercises = current.template.exercises.map(refreshExercise);
        const extras = current.extras.map((ex) => ex && refreshExercise(ex));
        return changed ? { template: { ...current.template, exercises }, extras } : current;
      });
    };
    const unsubscribe = onExerciseRowsWritten(refresh);
    void Promise.resolve().then(() => refresh());
    return () => {
      subscribed = false;
      unsubscribe();
    };
  }, [historyCtx]);

  // Restauration au montage : Supabase fait foi, localStorage est un filet
  // (survie au background / écriture offline non encore synchronisée). On fusionne
  // (mergeProgress) : pour chaque exo on garde la source la plus avancée, en
  // alignant les ids pour qu'aucune série affichée ne reste non annulable. On
  // ADOPTE l'id RÉEL de l'exécution du jour (init.executionId) quand elle existe
  // en base — sinon un id client neuf (séance neuve) — pour que les nouvelles ops
  // ne créent pas une exécution orpheline décorrélée des séries (bug H1).
  const [state, dispatch] = useReducer(captureReducer, null, () => {
    // `init` : la prop du PREMIER rendu. Cet initialiseur ne tourne qu'au
    // montage, il la lit donc telle qu'à l'ouverture, sans passer par une ref
    // (lue pendant le rendu, elle valait un warning `react-hooks/refs`).
    const { date: adoptedDate, executionId, startedAt, progress, datedNotes, restored } = init;
    const fromSupabase = hydratedState(
      initialTemplate,
      progress,
      datedNotes,
      adoptedDate,
      executionId,
      // Chrono : lancement repris de la base (reprise) ou « maintenant » (séance
      // neuve), ADR 0011. Le cache (restored) le surcharge à la fusion ci-dessous.
      startedAt,
    );
    // L'exécution porte la version de séance adoptée au chargement ; un état
    // local qui a déjà la sienne la garde à la fusion (cf. mergeProgress).
    const versioned = { ...fromSupabase, seanceVersionId };
    // LE RÉALISÉ : la réponse de la base quand elle a répondu pour cette
    // exécution, sinon ce que l'appareil a gardé, plus les écritures locales
    // que cette lecture ne contient pas (`openingState`, state.ts).
    return openingState({
      hydrated: versioned,
      restored,
      read: init.readStamp !== null ? { progress, datedNotes, stamp: init.readStamp } : null,
      writesSince,
      asOf: readStamp(),
    });
  });

  const session = useMemo(
    () => replayLayout(sources.template, state.layout ?? [], (_edit, i) => sources.extras[i] ?? null),
    [sources, state.layout],
  );

  // Miroir SYNCHRONE du state pour dériver les ops d'outbox (bug M6). `state`
  // capturé par les handlers est figé entre deux renders : deux taps « Logger »
  // rapprochés liraient le MÊME state et calculeraient le MÊME set_order, alors
  // que le reducer en pose deux distincts → deux lignes au même order en base.
  // On tient donc une projection à jour : recalée sur l'état à chaque rendu
  // commité (suit undo / reset / réhydratation) ET avancée localement par les
  // handlers JUSTE après leur dispatch, pour que le tap suivant parte de l'état
  // projeté, pas du périmé. Ainsi l'order (et l'id à annuler) de l'op et celui
  // du reducer coïncident toujours.
  //
  // Recalée dans un effet de MISE EN PAGE : il passe au commit, avant tout
  // effet passif et avant que le navigateur ne rende la main, donc avant tout
  // geste et toute réponse réseau, seuls lecteurs de la projection. L'écrire pendant le rendu valait un warning `react-hooks/refs`,
  // et aurait posé l'état d'un rendu abandonné.
  const stateRef = useRef(state);
  useLayoutEffect(() => {
    stateRef.current = state;
  });

  // Réponse tardive de la base pour CETTE exécution : réconciliée dans l'état,
  // et la projection avancée du même pas (un log suivant part du bon rang). Le
  // compteur dit au panneau de saisie que le réalisé a changé sans geste de
  // l'utilisateur : son brouillon touché ne doit pas être réamorcé.
  const [realityEpoch, setRealityEpoch] = useState(0);
  // Le tableau s'annonce à la boîte à son montage : il y prend la réponse
  // arrivée AVANT lui, puis reçoit celles d'après. Seules celles de sa
  // génération de chargement et de son exécution lui sont remises.
  const [mountedExecutionId] = useState(() => state.executionId);
  useEffect(
    () =>
      lateBox.register(generation, mountedExecutionId, (lateToday) => {
        // Les écritures locales que la réponse ne contient pas, relevées
        // MAINTENANT : la boîte a pu la garder le temps du montage.
        const asOf = readStamp();
        const action: ReconcileAction = {
          type: 'reconcile-progress',
          base: lateToday.progress,
          writes: writesSince(lateToday.stamp),
          asOf,
          datedNotes: lateToday.datedNotes,
        };
        dispatch(action);
        stateRef.current = captureReducer(stateRef.current, action);
        setRealityEpoch((n) => n + 1);
      }),
    [lateBox, generation, mountedExecutionId],
  );
  // Séries abandonnées dans la feuille des saisies refusées : elles quittent le
  // tableau tout de suite, sans attendre une réponse de la base (hors ligne,
  // elle ne vient pas), que l'abandon vienne de cet onglet ou d'un autre. Même
  // pas que pour une réponse tardive.
  useEffect(
    () =>
      onSetsAbandoned((setIds) => {
        const action = { type: 'forget-sets', setIds } as const;
        dispatch(action);
        stateRef.current = captureReducer(stateRef.current, action);
        setRealityEpoch((n) => n + 1);
      }),
    [],
  );
  // L'état courant, pour qui doit juger le tableau tel qu'il est (adoption
  // tardive) et non tel qu'il a pu être enregistré.
  useEffect(() => {
    const read = () => stateRef.current;
    boardStateRef.current = read;
    return () => {
      if (boardStateRef.current === read) boardStateRef.current = null;
    };
  }, [boardStateRef]);

  // Persiste à chaque changement d'état (localStorage), SAUF une fois la séance
  // clôturée : la clôture est transitoire (ADR 0009). On nettoie alors le cache
  // pour qu'au remontage (onglet, reload, réouverture le même jour) `loadPersisted`
  // renvoie null → capture vierge, jamais l'écran « Séance terminée ». L'état reste
  // en mémoire pour le récap immédiat (phase 'finishing'). Une séance EN COURS
  // (non clôturée) continue d'être persistée : offline, on ne perd aucune série.
  useEffect(() => {
    if (state.closedAt !== null) clearPersisted(session, date);
    else persist(state);
    // La bannière relit l'état du stockage (plein ou non) après chaque sauvegarde.
    notifySync();
  }, [state, session, date]);

  // --- Synchro via outbox ---------------------------------------------------

  // En quittant la Capture (changement d'onglet), un dernier essai d'écrire
  // l'état que le stockage a refusé : l'utilisateur a pu libérer de la place, et
  // démonté, le tableau ne le tient plus (cf. `retryPersistCaptureState`).
  useEffect(() => () => void retryPersistCaptureState(), []);

  // L'exécution est enfilée UNE fois par MONTAGE, AVANT son premier set (la FK
  // séries→exécution impose l'ordre, garanti aussi par le FIFO de l'outbox).
  // Cette ref repart à false à chaque remontage (changement d'onglet, reload) :
  // elle dit « déjà ré-affirmée depuis ce montage », RIEN sur l'existence de
  // l'exécution.
  const executionEnqueuedRef = useRef(false);
  // L'exécution existe-t-elle DÉJÀ (en base ou enfilée) ? Tranché une fois au
  // montage depuis l'état restauré, la réhydratation et l'outbox, puis vrai dès
  // qu'on l'enfile ici. C'est ELLE qui garde le chrono (ADR 0011) : une exécution
  // née n'est jamais réancrée, et sa ré-affirmation ne modifie pas la ligne en base
  // (insertion seule, cf. upsertExecution) : started_at reste celui du lancement.
  const [startedAtMount] = useState(() =>
    isExecutionStarted(state, init.executionInBase ? init.executionId : null, readQueue()),
  );
  const executionStartedRef = useRef(startedAtMount);
  const enqueueExecutionOnce = useCallback(() => {
    if (executionEnqueuedRef.current) return;
    executionEnqueuedRef.current = true;
    executionStartedRef.current = true;
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
      rawSet: { weightKg: number; reps: number; rir: number; side?: Side },
    ) => {
      // Bornes de la base (cf. stepper-utils) : une valeur hors bornes serait
      // refusée (22003) et la série finirait en quarantaine.
      const set = boundSetValues(rawSet);
      // On part de l'état PROJETÉ (stateRef), pas du `state` capturé : deux taps
      // rapprochés voient ainsi la 1ʳᵉ série déjà posée (bug M6).
      const current = stateRef.current;
      // Expiration du lancement (ADR 0011) : si le PREMIER set de l'exécution arrive
      // plus d'1 h après le lancement, ce dernier a expiré (chrono qui aurait tourné
      // dans le vide) → on réancre le chrono sur CE set. Sinon `startedAt` reste
      // l'instant du lancement. « Premier set de l'exécution » se lit sur
      // l'existence de l'exécution (`executionStartedRef`), pas sur le montage :
      // une séance entamée puis remontée n'est jamais réancrée. On avance la
      // projection pour qu'enqueueExecutionOnce (plus bas) écrive la bonne valeur.
      if (shouldReanchorLaunch(current, executionStartedRef.current)) {
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
        // L'exo est connu ici : l'op le porte pour la relecture de sa copie locale.
        enqueueAndFlush({ type: 'deleteSet', id: lastId, exerciseIds: [exerciseId] });
      }
    },
    [],
  );

  // Corriger ou supprimer une série quelconque de l'exo affiché (set-gestures.ts).
  // Même enchaînement qu'un log : le geste se calcule sur la PROJECTION, l'action
  // est dispatchée et la projection avancée du même pas, puis les écritures sont
  // enfilées une à une, dans l'ordre rendu (suppressions d'abord, puis les
  // renumérotations), EN UNE FOIS (`enqueueAll`). Une écriture de série exige l'exécution en base :
  // elle y est dès qu'une série existe, ré-affirmée ici une fois par montage
  // (insertion seule, le lancement ne bouge pas).
  const applySetGesture = useCallback(
    (gesture: SetGesture | null) => {
      if (gesture === null) return;
      dispatch(gesture.action);
      stateRef.current = captureReducer(stateRef.current, gesture.action);
      if (gesture.ops.some((op) => op.type === 'insertSet' || op.type === 'patchSet')) enqueueExecutionOnce();
      enqueueGestureAndFlush(gesture.ops);
    },
    [enqueueExecutionOnce],
  );
  const handleCorrectSet = useCallback(
    (exerciseId: string, setId: string, values: Partial<SetEntry>) =>
      applySetGesture(correctSet(stateRef.current, exerciseId, setId, values)),
    [applySetGesture],
  );
  const handleDeleteSet = useCallback(
    (exerciseId: string, setId: string) => applySetGesture(deleteSet(stateRef.current, exerciseId, setId)),
    [applySetGesture],
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
      // Id DÉTERMINISTE par couple (exécution, exo) : deux appareils qui notent le
      // même exo de la même exécution écrivent la même ligne (cf. dated-note-id).
      // Une note déjà connue (réhydratée, ou née sous un id aléatoire) garde le sien.
      // Une note que l'état local ignore encore (écrite ailleurs, réponse de la
      // base pas arrivée) n'est pas doublée pour autant : l'écriture relit le
      // couple et vise sa ligne (cf. `upsertDatedNote`, notes/data).
      const noteId = existing?.id ?? datedNoteId(current.executionId, exerciseId);
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
    const update = (ex: SessionExercise) =>
      ex.exerciseId === exerciseId ? { ...ex, perExerciseNote: body } : ex;
    setSources(({ template, extras }) => ({
      template: { ...template, exercises: template.exercises.map(update) },
      extras: extras.map((ex) => ex && update(ex)),
    }));
    enqueueAndFlush(exerciseNoteOutboxOp({ exerciseId, body }));
  }, []);

  // --- Ajout / swap d'un exo à la volée (issue #36) -------------------------
  // L'exo (catalogue base/perso) entre dans la SÉANCE COURANTE en mémoire ; le
  // template versionné en base reste intact. Pas d'écriture dédiée : la déviation
  // est dérivée par diff (ADR 0002). Le réalisé loggé dessus remontera comme
  // n'importe quelle série (l'outbox upsert par exerciseId), donc l'exo ajouté
  // apparaît dans le log brut et le récap.
  //
  // Chaque geste est aussi JOURNALISÉ dans l'état de capture (`layout`), donc
  // persisté avec lui : au changement d'onglet ou au rechargement, la séance est
  // reconstruite du template plus ce journal (`replayLayout`). Sans cela l'exo
  // ajouté disparaissait du sélecteur et ses séries sortaient du récap.
  const handleAddExercise = useCallback((exercise: SessionExercise) => {
    setSources((s) => ({ ...s, extras: [...s.extras, exercise] }));
    dispatch({ type: 'edit-layout', edit: layoutEditOf(exercise) });
  }, []);

  // Remplacer (`replaceExercise`, exercise-gestures.ts) : en place si l'exo n'a
  // aucune série, sinon l'exo commencé garde ses séries et le remplaçant
  // s'insère juste après lui. Le geste est journalisé (`edit-layout`) ; il
  // n'écrit rien en base. Depuis le Sommaire, aucun exo n'est affiché dans
  // l'instrument : `openExerciseId` y vaut toujours null, il est suivi quand même.
  const handleSwapExercise = useCallback(
    (targetExerciseId: string, replacement: SessionExercise) => {
      const gesture = replaceExercise(stateRef.current, session, targetExerciseId, replacement);
      if (gesture === null) return;
      // La séance affichée se reconstruit du template, des exos du journal
      // (`sources.extras`, alignés sur `layout`) et du journal lui-même : le
      // remplaçant entre aux sources, le geste au journal (il dit s'il s'insère
      // après l'exo commencé ou prend sa place, `keepsReplaced`).
      setSources((s) => ({ ...s, extras: [...s.extras, replacement] }));
      dispatch(gesture.action);
      stateRef.current = captureReducer(stateRef.current, gesture.action);
      if (gesture.openExerciseId !== null) {
        const open = { type: 'open-exercise', exerciseId: gesture.openExerciseId } as const;
        dispatch(open);
        stateRef.current = captureReducer(stateRef.current, open);
      }
    },
    [session],
  );

  // Remettre un exo passé (`restoreSkippedExercise`) : une marque de l'appareil,
  // rien en base.
  const handleRestoreExercise = useCallback((exerciseId: string) => {
    const gesture = restoreSkippedExercise(stateRef.current, exerciseId);
    if (gesture === null) return;
    dispatch(gesture.action);
    stateRef.current = captureReducer(stateRef.current, gesture.action);
  }, []);

  // Phase locale de fin de séance + durée chronométrée. Déclarés AVANT les callbacks
  // qui les utilisent (handleNewSession/openFinish) : sinon `setPhase` est
  // référencé avant sa déclaration, ce qui empêche la mémoïsation d'openFinish d'être
  // préservée (React Compiler). `phase` : capture (sélecteur + panneaux) -> finishing
  // (clôture, BPM optionnel). `durationMin` null = cas dégénéré (startedAt absent).
  const [phase, setPhase] = useState<'capture' | 'finishing'>('capture');
  const [durationMin, setDurationMin] = useState<number | null>(null);

  // Quitter la séance sans la ranger (`leaveSession`, session-gestures.ts) :
  // « Changer de séance » quand rien n'est saisi (ici ni dans la file d'un autre
  // onglet), « Annuler la séance », confirmée, sinon. Le plan est recalculé au
  // geste, sur la projection et la file du moment : s'il demande une
  // confirmation que le geste n'a pas reçue (saisie arrivée d'un autre onglet
  // entre le rendu et le toucher), rien n'est fait et l'appelant la demande
  // (rend `false`). Sinon, ADR 0011 :
  //   1. le cache local de la séance quitte l'appareil ;
  //   2. SI le plan le dit (« annuler » seulement), la file perd les écritures
  //      de CETTE exécution, et elle seule ;
  //   3. la suppression de l'exécution est enfilée : sans condition pour
  //      « annuler », conditionnelle (ouverte et vide, tranché par la base) pour
  //      « changer », qui ne peut rien effacer d'un autre onglet ;
  //   4. retour à l'écran de lancement.
  const handleLeaveSession = useCallback(
    (confirmed: boolean): boolean => {
      const plan = leaveSession(stateRef.current, {
        executionStarted: executionStartedRef.current,
        pendingOps: readQueue(),
      });
      if (plan.needsConfirmation && !confirmed) return false;
      clearPersisted(session, date);
      if (plan.purge) purgeByExecution(plan.executionId);
      enqueueGestureAndFlush(plan.ops);
      executionEnqueuedRef.current = false;
      executionStartedRef.current = false;
      onExitToLaunch();
      return true;
    },
    [session, date, onExitToLaunch],
  );

  // Après clôture, « Nouvelle séance » : la séance close est rangée (closed_at en
  // base, ADR 0009) et son cache déjà nettoyé. On NE vide PAS la file (ses ops
  // doivent encore se synchroniser). On revient simplement à l'écran de lancement
  // pour démarrer la prochaine séance — un nouveau lancement créera son exécution.
  const handleNewSession = useCallback(() => {
    clearPersisted(session, date);
    onExitToLaunch();
  }, [session, date, onExitToLaunch]);

  // --- Flux de fin de séance ------------------------------------------------
  // `phase`/`durationMin` sont déclarés plus haut (avant handleNewSession/openFinish).
  // La confirmation « Séance terminée » est gérée à l'intérieur de SessionEnd. La
  // durée est figée à l'ouverture du flux de fin (lancement -> clôture).
  // La semaine (séries par muscle contre le prévu) se lit à l'ouverture de la
  // fin, sans bloquer « Ranger la séance » : `null` tant qu'elle court.
  const [week, setWeek] = useState<WeekMusclesInput | null>(null);
  const openFinish = useCallback(() => {
    setDurationMin(elapsedMinutesSince(state.startedAt));
    setPhase('finishing');
    setWeek(null);
    void loadWeekMuscles({
      seanceId: session.id,
      dateIso: date,
      currentExecutionId: state.executionId,
      currentStartedAt: state.startedAt,
    }).then(setWeek);
  }, [state.startedAt, state.executionId, session.id, date]);

  // « Au moins une série loggée » : condition d'accès au flux de fin (cf. produit).
  const loggedAny = session.exercises.some(
    (ex) => getProgress(state, ex.exerciseId).sets.length > 0,
  );

  const recap = buildSessionRecap(session, state);
  const today = performedToday(session, state);

  // La séance reprise est-elle celle d'un jour PASSÉ (restée ouverte) ? `date` est
  // figée au montage ; « hier » ou plus (cf. `formatRelativeDay`).
  const staleSince = date < todayIso() ? formatRelativeDay(date, todayIso()) : null;

  const handleFinish = useCallback(
    async (values: SessionEndValues) => {
      // Clôture via l'outbox : on pose les métriques de fin (durée du chrono
      // lancement → clôture, pas une saisie ; BPM optionnel). Tout remonte seul au
      // retour du réseau.
      //
      // On NE (ré)affirme PLUS l'exécution ici (suppression de `enqueueExecutionOnce`,
      // fix orphelines) : une exécution n'existe QUE par ses séries (GLOSSARY.md
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
        // La durée retenue à la fin (chrono, ou corrigée par crans de 5 min).
        durationMin: values.durationMin,
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
    [state.executionId],
  );

  // L'index du haut et le bouton Sommaire : l'état de chaque exo de la séance.
  const indexItems: IndexItem[] = session.exercises.map((ex) => {
    const p = getProgress(state, ex.exerciseId);
    return {
      exerciseId: ex.exerciseId,
      name: ex.name,
      state: exoState(p, ex.prescription.sets.min),
      fill: Math.min(1, logicalSetsDone(p) / Math.max(1, ex.prescription.sets.min)),
    };
  });
  // Exos faits, et passés à part : un exo passé n'est pas « fait ».
  const counts = exoCounts(session, state);
  const nextId = nextExerciseId(session, state, state.activeExerciseId);
  const nextEx = nextId ? (session.exercises.find((e) => e.exerciseId === nextId) ?? null) : null;

  if (phase === 'finishing') {
    return (
      <div className="flex min-h-surface flex-col">
        <SalleSync />
        <SessionEnd
          recap={recap}
          today={today}
          week={week}
          dateIso={date}
          startedAt={state.startedAt}
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
  // retombe directement sur le Sommaire ou l'instrument ci-dessous.

  return (
    <div className="flex min-h-surface flex-col">
      {activeExercise ? (
        <CapturePanel
          key={activeExercise.exerciseId}
          exercise={activeExercise}
          progress={getProgress(state, activeExercise.exerciseId)}
          index={indexItems}
          next={nextEx ? { exerciseId: nextEx.exerciseId, name: nextEx.name, resume: resumeWord(getProgress(state, nextEx.exerciseId), nextEx.unilateral ?? false) } : null}
          done={counts.done}
          total={session.exercises.length}
          canFinish={loggedAny}
          datedNote={getDatedNote(state, activeExercise.exerciseId)?.body ?? ''}
          historyEpoch={realityEpoch}
          dispatch={dispatch}
          onLog={(set) => handleLog(activeExercise.exerciseId, set)}
          onUndo={() => handleUndo(activeExercise.exerciseId)}
          onFinish={openFinish}
          onSaveDatedNote={(body) => handleSaveDatedNote(activeExercise.exerciseId, body)}
          onSaveExerciseNote={(body) => handleSaveExerciseNote(activeExercise.exerciseId, body)}
          onCorrectSet={(setId, values) => handleCorrectSet(activeExercise.exerciseId, setId, values)}
          onDeleteSet={(setId) => handleDeleteSet(activeExercise.exerciseId, setId)}
        />
      ) : (
        <>
          <SalleSync />
          <ExercisePicker
            session={session}
            templateExerciseIds={templateExerciseIds(initialTemplate)}
            state={state}
            done={counts.done}
            skipped={counts.skipped}
            staleSince={staleSince}
            canFinish={loggedAny}
            onPick={(id) => dispatch({ type: 'open-exercise', exerciseId: id })}
            onSkip={(id) => dispatch({ type: 'skip-exercise', exerciseId: id })}
            onFinish={openFinish}
            loadCatalog={listExercisesForCapture}
            loadCatalogExercise={(row) => loadCatalogExercise(row, historyCtx)}
            onAddExercise={handleAddExercise}
            onSwapExercise={handleSwapExercise}
            onRestore={handleRestoreExercise}
            leaveKind={nothingEntered(state) && !enteredElsewhere(state, readQueue()) ? 'change' : 'cancel'}
            onLeaveSession={handleLeaveSession}
          />
        </>
      )}
    </div>
  );
}

// --- Panneau + barre d'action fixe (zone basse du pouce) --------------------

import type { SessionExercise } from './data';
import type { CaptureAction, CaptureState, ExerciseProgress } from './state';

/** L'action de réconciliation qu'une réponse tardive de la base remet au tableau. */
type ReconcileAction = Extract<CaptureAction, { type: 'reconcile-progress' }>;

/** Ligne de synchro de la Salle, hors instrument : rien quand tout est envoyé
 *  (même ligne que le shell, src/shell/sync-line.ts). Sur l'instrument, pas de
 *  ligne (elle pousserait la rangée RIR sous la barre du pouce) : seules les
 *  alarmes s'y disent, le bouton Sommaire garde la progression. */
function SalleSync() {
  const sync = useSyncState();
  const openRefused = useOpenRefusedWrites();
  return <SyncBanner line={syncLine(sync)} action={refusedAction(sync.refused, openRefused)} />;
}

/** Libellé de « Logger » : le côté en unilatéral, le rang sinon, « une de plus »
 *  au-delà du plan. L'info tient au TEXTE, jamais à la couleur seule. */
function logLabel(side: Side | null, rank: number, plannedMax: number): string {
  if (side) return `Logger ${side === 'left' ? 'gauche' : 'droite'} · série ${rank}`;
  return rank > plannedMax ? 'Logger une de plus' : `Logger la série ${rank}`;
}

/** Bouton de la rangée du haut de la barre : deux lignes, même gabarit pour
 *  Sommaire et Exo suivant (même hauteur, même ligne de base, marges égales).
 *  Sous 340 px (320) : marges de 8 px et titre à 15 px, sinon « Sommai… » et
 *  « Exo sui… » (cf. la colonne du milieu, `BAR_GRID`). */
const BAR_BTN =
  'ui-press flex h-12 min-w-0 flex-col items-start justify-center rounded-block border-[1.5px] border-ink bg-raise px-2.5 text-left active:bg-line [@media(max-width:339px)]:px-2';
/** Titre d'un bouton de la rangée du haut : une ligne, jamais deux (360 px). */
const BAR_TITLE =
  'w-full truncate whitespace-nowrap text-[16px] font-medium leading-tight text-ink [@media(max-width:339px)]:text-[15px]';
/** Rangée du haut : colonne du milieu (Annuler) à largeur bornée, Sommaire et
 *  Exo suivant gardent la même largeur, qu'Annuler soit là ou non ; resserrée
 *  sous 340 px pour laisser leurs titres entiers. */
const BAR_GRID =
  'mb-1.5 grid grid-cols-[1fr_minmax(56px,76px)_1fr] gap-2 [@media(max-width:339px)]:grid-cols-[1fr_minmax(48px,60px)_1fr]';

function CapturePanel({
  exercise,
  progress,
  index,
  next,
  done,
  total,
  canFinish,
  datedNote,
  historyEpoch,
  dispatch,
  onLog,
  onUndo,
  onFinish,
  onSaveDatedNote,
  onSaveExerciseNote,
  onCorrectSet,
  onDeleteSet,
}: {
  exercise: SessionExercise;
  progress: ExerciseProgress;
  index: IndexItem[];
  /** L'exo que propose « Exo suivant » et où il reprend, ou null. */
  next: { exerciseId: string; name: string; resume: string | null } | null;
  /** Exos faits (pas les passés), et leur total (bouton Sommaire). */
  done: number;
  total: number;
  /** Au moins une série loggée dans la séance : Terminer est possible. */
  canFinish: boolean;
  /** Corps de la note datée du jour pour cet exo (issue #26), '' si aucune. */
  datedNote: string;
  /** Incrémenté quand le réalisé change sans geste de l'utilisateur (réponse tardive). */
  historyEpoch: number;
  dispatch: Dispatch<CaptureAction>;
  onLog: (set: { weightKg: number; reps: number; rir: number; side?: Side }) => void;
  onUndo: () => void;
  onFinish: () => void;
  /** Enregistre la note datée du jour (corps vidé = note effacée). */
  onSaveDatedNote: (body: string) => void;
  /** Enregistre la note d'instructions de l'exo, éditée sur place (issue #52). */
  onSaveExerciseNote: (body: string) => void;
  onCorrectSet: (setId: string, values: Partial<SetEntry>) => void;
  onDeleteSet: (setId: string) => void;
}) {
  // Brouillon de la série courante remonté ici pour que la barre du bas puisse
  // logger. Pour un exo unilatéral, il porte aussi le côté CHOISI (issue #63) :
  // c'est ce côté que la barre écrit, jamais un côté dérivé.
  const [draft, setDraft] = useState<{
    weightKg: number;
    reps: number;
    rir: number;
    side?: Side;
  } | null>(null);
  const sync = useSyncState();

  const unilateral = exercise.unilateral ?? false;
  // Côté que la barre va logger : le côté CHOISI remonté dans le brouillon ; tant
  // qu'il n'a pas remonté (1er rendu), le côté manquant de la série en cours.
  const currentSide: Side | null = unilateral
    ? draft?.side ?? pendingSide(progress) ?? 'left'
    : null;
  // SÉRIES complètes : en unilatéral, une série = gauche + droite au même order
  // (blind F4) ; bilatéral = une saisie par série.
  const completedSets = unilateral
    ? pairSidesByOrder(progress.sets).filter((p) => p.left !== null && p.right !== null).length
    : progress.sets.length;
  // Le rang que dit « Logger » : en unilatéral, la série que vise le côté
  // choisi (la case en cours de la bande, `targetSlotForSide`).
  const rank = currentSide ? targetSlotForSide(progress.sets, currentSide) + 1 : completedSets + 1;
  const lastSet = progress.sets[progress.sets.length - 1] ?? null;

  // aria-live : annonce « série loggée » après chaque commit.
  const [announce, setAnnounce] = useState('');
  const sideLabel = (side: Side): string => (side === 'left' ? 'gauche' : 'droite');

  // Garde contre le rebond de doigt (log-guard.ts) : un second Logger du même
  // exo sous 600 ms (250 ms si le côté a basculé) n'écrit rien et n'annonce rien.
  const lastLogRef = useRef<LogStamp | null>(null);
  const logSet = useCallback(
    (set: { weightKg: number; reps: number; rir: number; side?: Side }) => {
      const stamp: LogStamp = { exerciseId: exercise.exerciseId, side: set.side, at: performance.now() };
      if (isDoubleTap(lastLogRef.current, stamp)) return;
      lastLogRef.current = stamp;
      onLog(set);
      const where = currentSide ? ` côté ${sideLabel(currentSide)}` : '';
      setAnnounce(
        `Série ${rank}${where} loggée : ${set.weightKg} kilos, ${set.reps} répétitions, RIR ${set.rir}.`,
      );
    },
    [onLog, rank, currentSide, exercise.exerciseId],
  );

  const label = logLabel(currentSide, rank, exercise.prescription.sets.max);
  const values = draft ? `${formatWeight(draft.weightKg)} × ${draft.reps} · RIR ${draft.rir}` : '';
  // Annuler retire la DERNIÈRE ligne loggée : un côté en unilatéral (décision 2b).
  const undoWhat = lastSet
    ? lastSet.side
      ? { aria: `Annuler le côté ${sideLabel(lastSet.side)} de la série ${lastSet.order}`, sub: sideLabel(lastSet.side) }
      : { aria: `Annuler la série ${lastSet.order}`, sub: `série ${lastSet.order}` }
    : null;

  // Sur l'instrument, l'envoi en attente tient dans le bouton Sommaire ; mais un
  // stockage plein (fermer l'app perdrait des saisies) ou des saisies refusées
  // par le serveur se disent en clair, en tête.
  const alarm = sync.unsaved || sync.full || sync.outdated || sync.refused > 0 ? syncLine(sync) : null;
  const detail = sommaireDetail(sync, done, total);
  const openRefused = useOpenRefusedWrites();

  return (
    <>
      <SyncBanner line={alarm} action={refusedAction(sync.refused, openRefused)} />
      <ExerciseCapture
        exercise={exercise}
        progress={progress}
        index={index}
        next={next}
        datedNote={datedNote}
        historyEpoch={historyEpoch}
        onPick={(id) => dispatch({ type: 'open-exercise', exerciseId: id })}
        onNext={() => next && dispatch({ type: 'open-exercise', exerciseId: next.exerciseId })}
        onSommaire={() => dispatch({ type: 'back-to-picker' })}
        onDraftChange={setDraft}
        onSaveDatedNote={onSaveDatedNote}
        onSaveExerciseNote={onSaveExerciseNote}
        onCorrectSet={(setId, values) => {
          onCorrectSet(setId, values);
          setAnnounce(`Série corrigée : ${values.weightKg} kilos, ${values.reps} répétitions, RIR ${values.rir}.`);
        }}
        onDeleteSet={(setId) => {
          onDeleteSet(setId);
          setAnnounce('Série supprimée.');
        }}
      />

      <p className="sr-only" role="status" aria-live="assertive">
        {announce}
      </p>

      {/* Zone du pouce, collée en bas (`sticky`, fond plein, encoche comprise ;
          jamais `position: fixed`). Rangée du haut : Sommaire, Annuler, Exo
          suivant, chacun à sa place, même gabarit. Rangée du bas : Logger, le
          geste répété, toujours au même endroit, sans enfoncement. Rien ne change
          de place quand le minimum du plan est atteint (décision du 23/11). */}
      <div className="sticky bottom-0 z-10 mt-auto bg-bg px-5 pb-[calc(0.75rem+var(--safe-bottom))] pt-1 [@media(max-height:700px)]:pb-[calc(0.5rem+var(--safe-bottom))]">
        <div className={BAR_GRID}>
          <button
            type="button"
            onClick={() => dispatch({ type: 'back-to-picker' })}
            aria-label={`Sommaire de la séance, ${done} exo${done > 1 ? 's' : ''} fait${done > 1 ? 's' : ''} sur ${total}${
              detail.alarm ? `, ${detail.text}` : ''
            }`}
            className={BAR_BTN}
          >
            <span className={BAR_TITLE}>Sommaire</span>
            {/* La progression, toujours (sommaire-detail.ts) ; une alarme (stockage
                plein, refus) prend sa place, en blanc cassé demi-gras. */}
            <span className={`tnum w-full truncate text-[13px] leading-tight ${detail.alarm ? 'font-semibold text-ink' : 'text-muted'}`}>
              {detail.text}
            </span>
          </button>
          {undoWhat ? (
            <button
              type="button"
              onClick={() => {
                onUndo();
                setAnnounce(`${undoWhat.aria.replace('Annuler', 'Annulé :')}.`);
              }}
              aria-label={undoWhat.aria}
              className="flex h-12 min-w-0 flex-col items-center justify-center px-1 text-center active:opacity-70"
            >
              <span className="text-[16px] leading-tight text-ink underline decoration-1 underline-offset-4 [@media(max-width:339px)]:text-[15px]">Annuler</span>
              <span className="tnum truncate text-[13px] leading-tight text-muted">{undoWhat.sub}</span>
            </button>
          ) : (
            <span aria-hidden />
          )}
          {next ? (
            <button
              type="button"
              onClick={() => dispatch({ type: 'open-exercise', exerciseId: next.exerciseId })}
              aria-label={`Exo suivant, ${next.name}${next.resume ? `, reprise ${next.resume}` : ''}`}
              className={BAR_BTN}
            >
              <span className={BAR_TITLE}>Exo suivant</span>
              <span className="w-full truncate text-[13px] leading-tight text-muted">{next.name}</span>
            </button>
          ) : canFinish ? (
            <button type="button" onClick={onFinish} aria-label="Terminer la séance" className={BAR_BTN}>
              <span className={BAR_TITLE}>Terminer</span>
              <span className="truncate text-[13px] leading-tight text-muted">la séance</span>
            </button>
          ) : (
            <span aria-hidden />
          )}
        </div>
        <PrimaryButton
          over={label}
          ariaLabel={`${label}, ${values}`}
          press={false}
          disabled={!draft}
          onClick={() => draft && logSet(draft)}
          className="w-full [@media(max-height:800px)]:h-12"
        >
          <span className="tnum">{values}</span>
        </PrimaryButton>
      </div>
    </>
  );
}
