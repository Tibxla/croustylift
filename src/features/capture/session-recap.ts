// Fin de séance enrichie : CALCULS PURS, sans React ni réseau. L'écran de fin
// (récap avant la Clôture, puis après) n'a qu'à afficher ce que ces fonctions
// rendent ; rien ici n'est stocké, tout se redérive de l'état de capture.
//
// API pour l'écran :
//   - `buildSessionRecap(session, state)` : la séance exo par exo (état, séries
//     faites contre le prévu, séries battues et égalées, records, kg soulevés,
//     côté resté seul en unilatéral, provenance), et les totaux : séries
//     loggées, battues, nouveaux records, kg soulevés, exos par état ;
//   - `performedToday(session, state)` : les séries du jour de chaque exo, avec
//     son mouvement et ses muscles, pour le décompte par muscle ;
//   - `exerciseStatus(exo, réalisé)` : 'fait', 'en-cours', 'passe', 'pas-fait'.
//     Un seul mot pour un exo commencé, partout : « en cours » ;
//   - `setsByMuscle({ done, planned })` : séries de la séance par muscle contre
//     son PROPRE prévu (`plannedToday` : les prescriptions de ses exos, ajoutés
//     et remplacés compris). Aucune règle de semaine (décision du 27/11 : une
//     routine faite deux fois dans la semaine se lisait « au-dessus du prévu ») ;
//   - `nudgeDuration(minutes, sens)` : la durée corrigée d'un cran de 5 min.
//
// Les décomptes par muscle sont ceux du domaine (`countPerformedSets`,
// `countPlannedSets`, ADR 0006 : pondérés par les reps).
//
// Battues, égalées, records : les mêmes badges que dans l'instrument
// (`computeSetBadges`, ADR 0010), donc recalculés quand une série est corrigée
// ou supprimée. Un seul badge par série, Record > battue > égalée : une série
// qui bat le record n'est pas AUSSI comptée « battue ».
//
// Records rendus (`RecapRecord`, dans `ExerciseRecap.newRecords` et
// `SessionRecap.records`, la liste de séance étant la concaténation des listes
// d'exos dans l'ordre de la séance). Chaque record est typé :
//   - `axis` : 'e1rm' (le record d'e1RM, lu en reps effectives à 0 kg) ou
//     'charge' (le record de charge, poids puis reps) ;
//   - `unit` et `value` : 'kg' (e1RM en kg sur l'axe e1rm, poids en kg sur
//     l'axe charge) ou 'reps'. À 0 kg (ADR 0013, amendement du 2026-11-23),
//     l'axe e1rm rend les REPS EFFECTIVES (reps + RIR) et l'axe charge les reps
//     faites (c'est ce qu'il compare à poids égal) : jamais « 0 kg » ni e1RM nul ;
//   - `side` : 'left' ou 'right' en unilatéral (chaque côté a son record, ADR
//     0010), `null` en bilatéral ;
//   - `set` : la série qui le porte (poids, reps, RIR), pour l'afficher.
// Au plus un record par axe et par côté : la meilleure série du jour parmi
// celles qui portent le badge de cet axe (`comparePerformance` pour l'e1RM,
// `heavier` pour la charge). Une série qui bat les deux records (badge 'both')
// ne figure qu'une fois, sur l'axe e1rm : le record de charge ne s'ajoute que
// s'il est tenu par une AUTRE série que celle du record d'e1RM du même côté.
// Ordre : gauche puis droite, e1rm puis charge.

import { effectiveReps, estimateE1rm, isZeroLoad } from '../../domain/e1rm';
import { liftedKg } from '../../domain/lifted';
import {
  countLogicalSetsDone,
  countPerformedSets,
  countPlannedSets,
  type CountRange,
  type PerformedExercise,
  type PlannedExercise,
} from '../../domain/set-count';
import type { PerformedSet, Range, Side } from '../../domain/types';
import { currentSetOrder, sidesDoneAt } from '../../domain/unilateral';
import { orderMusclesCanonical } from '../authoring/exercise-input';
import type { ExerciseOrigin, Session, SessionExercise } from './fixtures';
import {
  computeSetBadges,
  computeSetBadgesBySide,
  dayRecords,
  headlineVerdict,
  recordWord,
  summarizeBadges,
  verdictWords,
  type VerdictCounts,
  type VerdictWord,
} from './set-badges';
import { getProgress, type CaptureState, type ExerciseProgress } from './state';
import { SESSION_DURATION_MAX_MIN } from './summary';

/** État d'un exo en fin de séance. « en-cours » : commencé, sous le minimum du plan. */
export type ExerciseStatus = 'fait' | 'en-cours' | 'passe' | 'pas-fait';

/**
 * L'état d'un exo. « Passé » prime sur tout (c'est un choix de l'utilisateur,
 * même s'il avait fait une série avant). Sinon on compte les séries LOGIQUES
 * (un rang ; gauche et droite d'une série unilatérale = une série) contre le
 * minimum prescrit.
 */
export function exerciseStatus(
  exercise: Pick<SessionExercise, 'prescription'>,
  progress: ExerciseProgress,
): ExerciseStatus {
  if (progress.skipped) return 'passe';
  const done = countLogicalSetsDone(progress.sets);
  if (done === 0) return 'pas-fait';
  return done >= exercise.prescription.sets.min ? 'fait' : 'en-cours';
}

/** Un nouveau record du jour, typé par axe, unité et côté (cf. en-tête). */
export interface RecapRecord {
  exerciseId: string;
  name: string;
  /** 'e1rm' : record d'e1RM (reps effectives à 0 kg) ; 'charge' : record de charge. */
  axis: 'e1rm' | 'charge';
  /** Unité de `value`. */
  unit: 'kg' | 'reps';
  /**
   * e1RM en kg, poids en kg, reps effectives (axe e1rm à 0 kg) ou reps faites
   * (axe charge à 0 kg). Valeur exacte : l'arrondi revient à l'affichage.
   */
  value: number;
  /** Côté du record en unilatéral, `null` en bilatéral. */
  side: Side | null;
  /** La série qui porte le record. */
  set: { weightKg: number; reps: number; rir: number };
}

/** Un exo dans le récap de fin de séance. */
export interface ExerciseRecap {
  exerciseId: string;
  name: string;
  status: ExerciseStatus;
  /** Séries logiques faites (une série unilatérale entamée d'un côté compte). */
  setsDone: number;
  /** Séries prévues par le plan, en fourchette. */
  setsPlanned: Range;
  /** Séries (lignes) qui battent la dernière fois. */
  beaten: number;
  /** Séries (lignes) qui égalent la dernière fois. */
  matched: number;
  /** Les décomptes des badges de l'exo (lignes : par côté en unilatéral). */
  verdicts: VerdictCounts;
  /** Ses statuts en mots, ceux du récap d'exo (`verdictWords`) : record, puis
   *  battues, puis égalées ; en côtés pour un exo unilatéral. */
  statuses: VerdictWord[];
  /** LA mention de l'exo dans le Sommaire (`headlineVerdict`) : la meilleure,
   *  par côté en unilatéral ; `null` sans rien de mieux ni d'égal. */
  headline: VerdictWord | null;
  /** Les nouveaux records du jour de cet exo, par axe et par côté (cf. en-tête). */
  newRecords: RecapRecord[];
  /** kg soulevés sur cet exo. */
  liftedKg: number;
  /** Unilatéral : le côté fait de la série en cours restée à un seul côté, sinon `null`. */
  openSide: Side | null;
  /** D'où vient l'exo dans la séance : plan, ajouté, ou remplaçant. */
  origin: ExerciseOrigin;
}

/** Le récap de la séance, avant comme après la Clôture. */
export interface SessionRecap {
  sessionName: string;
  exercises: ExerciseRecap[];
  /** Nombre d'exos par état. */
  counts: Record<ExerciseStatus, number>;
  /** Séries logiques loggées dans la séance. */
  setsLogged: number;
  beaten: number;
  /**
   * Les nouveaux records du jour : ceux de chaque exo (`newRecords`), dans
   * l'ordre de la séance. Records de charge et records par côté compris.
   */
  records: RecapRecord[];
  /** kg soulevés dans la séance. */
  liftedKg: number;
}

/**
 * Les records du jour d'un exo, au plus un par axe et par côté (cf. en-tête) :
 * le décompte partagé avec le Journal (`dayRecords`, set-badges).
 */
function recordsOf(
  exercise: SessionExercise,
  sets: PerformedSet[],
  badges: ReturnType<typeof computeSetBadges>,
  unilateral: boolean,
): RecapRecord[] {
  const base = { exerciseId: exercise.exerciseId, name: exercise.name };
  return dayRecords(sets, badges, unilateral).map(({ axis, side, set }) => ({
    ...base,
    side,
    ...(axis === 'e1rm' ? e1rmRecord(set) : chargeRecord(set)),
  }));
}

type RecordReading = Pick<RecapRecord, 'axis' | 'unit' | 'value' | 'set'>;

const setOf = ({ weightKg, reps, rir }: PerformedSet) => ({ weightKg, reps, rir });

/** Un record d'e1RM : en kg, ou en reps effectives à 0 kg (ADR 0013). */
function e1rmRecord(set: PerformedSet): RecordReading {
  if (isZeroLoad(set.weightKg)) {
    return { axis: 'e1rm', unit: 'reps', value: effectiveReps(set.reps, set.rir), set: setOf(set) };
  }
  return { axis: 'e1rm', unit: 'kg', value: estimateE1rm(set.weightKg, set.reps, set.rir), set: setOf(set) };
}

/** Un record de charge : le poids en kg, ou les reps faites à 0 kg. */
function chargeRecord(set: PerformedSet): RecordReading {
  return isZeroLoad(set.weightKg)
    ? { axis: 'charge', unit: 'reps', value: set.reps, set: setOf(set) }
    : { axis: 'charge', unit: 'kg', value: set.weightKg, set: setOf(set) };
}

function recapExercise(exercise: SessionExercise, progress: ExerciseProgress): ExerciseRecap {
  const unilateral = exercise.unilateral ?? false;
  const badges = unilateral
    ? computeSetBadgesBySide(
        progress.sets,
        exercise.reference ?? null,
        exercise.personalRecordBySide ?? {
          left: { bestE1rm: null, bestE1rmSet: null, bestWeightReps: null },
          right: { bestE1rm: null, bestE1rmSet: null, bestWeightReps: null },
        },
      )
    : computeSetBadges(progress.sets, exercise.reference ?? null, exercise.personalRecord ?? null);
  const verdicts = summarizeBadges(progress.sets, badges).total;

  const newRecords = recordsOf(exercise, progress.sets, badges, unilateral);

  // Unilatéral : la série en cours est-elle restée à un seul côté ?
  let openSide: Side | null = null;
  if (unilateral && progress.sets.length > 0) {
    const sides = sidesDoneAt(progress.sets, currentSetOrder(progress.sets));
    if (sides.length === 1) openSide = sides[0] ?? null;
  }

  return {
    exerciseId: exercise.exerciseId,
    name: exercise.name,
    status: exerciseStatus(exercise, progress),
    setsDone: countLogicalSetsDone(progress.sets),
    setsPlanned: exercise.prescription.sets,
    beaten: verdicts.battu,
    matched: verdicts.egalise,
    verdicts,
    statuses: verdictWords(verdicts, recordWord(badges), unilateral),
    headline: headlineVerdict(progress.sets, badges, unilateral),
    newRecords,
    liftedKg: liftedKg(progress.sets),
    openSide,
    origin: exercise.origin ?? 'template',
  };
}

/** Le récap de fin de séance de l'exécution en cours (cf. en-tête). */
export function buildSessionRecap(session: Session, state: CaptureState): SessionRecap {
  const exercises = session.exercises.map((exercise) =>
    recapExercise(exercise, getProgress(state, exercise.exerciseId)),
  );
  const counts: Record<ExerciseStatus, number> = { fait: 0, 'en-cours': 0, passe: 0, 'pas-fait': 0 };
  for (const exercise of exercises) counts[exercise.status] += 1;
  const sum = (pick: (e: ExerciseRecap) => number) => exercises.reduce((n, e) => n + pick(e), 0);
  return {
    sessionName: session.name,
    exercises,
    counts,
    setsLogged: sum((e) => e.setsDone),
    beaten: sum((e) => e.beaten),
    records: exercises.flatMap((e) => e.newRecords),
    liftedKg: sum((e) => e.liftedKg),
  };
}

/**
 * Les séries du jour de chaque exo de la séance, avec son mouvement et ses
 * muscles principaux : l'entrée du décompte par muscle (`countPerformedSets`,
 * `weekSetsByMuscle`). Un exo passé garde ses séries : elles ont été faites.
 */
export function performedToday(session: Session, state: CaptureState): PerformedExercise[] {
  return session.exercises.map((ex) => ({
    unilateral: ex.unilateral ?? false,
    primaryMuscles: ex.primaryMuscles ?? [],
    sets: getProgress(state, ex.exerciseId).sets,
  }));
}

// --- Séries de la séance par muscle, contre son prévu ------------------------

/** Où en est un muscle face au prévu de la séance. */
export type PlanFit = 'sous' | 'dans' | 'au-dela';

/** Un muscle dans le décompte de la séance. Valeurs fractionnaires (ADR 0006). */
export interface MuscleRow {
  muscle: string;
  /** Séries de la séance du jour. */
  done: number;
  /** Fourchette prévue par la séance, `null` si aucun de ses exos ne le travaille. */
  planned: CountRange | null;
  /** Le fait contre la fourchette, `null` sans fourchette. */
  fit: PlanFit | null;
}

/** Le prévu de la séance du jour : les prescriptions de ses exos, tels qu'ils
 *  sont ce jour-là (ajoutés et remplacés compris, passés aussi). */
export function plannedToday(session: Session): PlannedExercise[] {
  return session.exercises.map((ex) => ({
    unilateral: ex.unilateral ?? false,
    primaryMuscles: ex.primaryMuscles ?? [],
    sets: ex.prescription.sets,
    reps: ex.prescription.reps,
  }));
}

/**
 * Décompte de séries par muscle de la séance contre son prévu. Un muscle prévu
 * et pas travaillé (exo passé) figure à zéro ; un muscle travaillé hors du prévu
 * figure sans fourchette. Ordre canonique des muscles (GLOSSARY.md).
 */
export function setsByMuscle(input: { done: PerformedExercise[]; planned: PlannedExercise[] }): MuscleRow[] {
  const done = countPerformedSets(input.done).byMuscle;
  const planned = countPlannedSets(input.planned).byMuscle;
  const muscles = orderMusclesCanonical([...new Set([...Object.keys(planned), ...Object.keys(done)])]);
  return muscles.map((muscle) => {
    const value = done[muscle] ?? 0;
    const range = planned[muscle] ?? null;
    // Tolérance : les décomptes sont des sommes de fractions (0,2 par rep).
    const eps = 1e-9;
    const fit: PlanFit | null =
      range === null ? null : value < range.min - eps ? 'sous' : value > range.max + eps ? 'au-dela' : 'dans';
    return { muscle, done: value, planned: range, fit };
  });
}

// --- Durée corrigeable --------------------------------------------------------

/** Cran de correction de la durée, en minutes. */
export const DURATION_STEP_MIN = 5;
/** Durée proposée quand le chrono n'a rien mesuré (séance oubliée, lancement non horodaté). */
export const DURATION_FALLBACK_MIN = 60;

/**
 * La durée corrigée d'un cran : le multiple de 5 min le plus proche dans le
 * sens demandé (27 donne 30 ou 25). Bornée de 1 min au plafond d'une séance.
 * `null` (durée non mesurée) : le premier geste propose une heure, quel que
 * soit le sens ; rien n'est inventé tant que l'utilisateur n'y touche pas.
 */
export function nudgeDuration(minutes: number | null, direction: 1 | -1): number {
  if (minutes === null) return DURATION_FALLBACK_MIN;
  const step = DURATION_STEP_MIN;
  const next =
    direction === 1 ? Math.floor(minutes / step) * step + step : Math.ceil(minutes / step) * step - step;
  return Math.min(SESSION_DURATION_MAX_MIN, Math.max(1, next));
}
