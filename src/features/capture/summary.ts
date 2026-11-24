// Logiques pures de récapitulatif et de chrono — extraites de CaptureScreen pour
// être testables en isolation (pas de DOM, pas de React).
import type { CaptureState } from './state';
import { getProgress } from './state';
import type { Session } from './fixtures';
import { countLogicalSetsDone, countPerformedSets } from '../../domain/set-count';

/** Récap sobre de l'exécution : exos faits / total + décompte des séries. La fin
 *  de séance affiche désormais `buildSessionRecap` (session-recap.ts). */
export interface SessionSummary {
  sessionName: string;
  /** Exos dont le minimum prescrit est atteint. Un exo passé n'en fait pas partie. */
  exercisesDone: number;
  /** Exos explicitement passés, sans égard à leurs séries : affichés à part. */
  exercisesSkipped: number;
  exercisesTotal: number;
  /** Total des séries, pondéré par reps (issue #60, ADR 0006). Valeur fractionnaire. */
  totalSets: number;
  /** Décompte réel des séries par muscle principal, pondéré par reps. Valeurs fractionnaires. */
  setsByMuscle: Record<string, number>;
}

/**
 * Durée maximale d'une séance, en minutes (10 h) : le même plafond que l'éditeur
 * de séance passée. Au-delà, le chrono n'a pas mesuré une séance.
 */
export const SESSION_DURATION_MAX_MIN = 600;

/**
 * Durée écoulée en minutes (arrondi) depuis le lancement de la séance, ou `null`
 * si elle n'est pas MESURABLE : `startedAt` absent ou invalide, ou durée au-delà
 * du plafond. Ce second cas est celui d'une séance oubliée sans clôture puis
 * terminée le lendemain : le chrono affichait de l'ordre de 1 400 min, valeur
 * jamais mesurée qui écrasait l'échelle du graphe de durée. On n'envoie ni
 * n'affiche alors de durée, plutôt qu'une valeur inventée (elle reste
 * saisissable depuis le journal).
 */
export function elapsedMinutesSince(startedAt: number | undefined): number | null {
  if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) return null;
  // Clampé à 0 : un `startedAt` dans le futur (horloge qui recule, cache restauré
  // d'un autre appareil) donnerait une durée NÉGATIVE, que la base rejette — et
  // une op de clôture rejetée empoisonne l'outbox (incident 2026-07-30 : la
  // contrainte refusait aussi 0, cf. migration 0012). 0 = « moins de 30 s »,
  // mesure honnête d'un faux départ.
  const minutes = Math.max(0, Math.round((Date.now() - startedAt) / 60000));
  return minutes > SESSION_DURATION_MAX_MIN ? null : minutes;
}

/**
 * Construit le récap sobre de l'exécution courante : exos faits / total (les exos
 * passés comptés à part) + le
 * décompte RÉEL des séries (total + par muscle), pondéré par reps (issue #60,
 * affine #37). Le décompte applique la règle exacte via le domaine pur
 * `countPerformedSets` : chaque série logique (un set_order ; unilatéral G+D au
 * même order = 1) vaut `min(reps,5)/5` ; l'unilatéral somme ses deux côtés au
 * total et retient le côté faible par muscle, pour chaque muscle principal de l'exo.
 * Les comptes sont FRACTIONNAIRES (affichés à une décimale par SessionEnd).
 */
export function buildSummary(session: Session, state: CaptureState): SessionSummary {
  const exercisesDone = session.exercises.filter((ex) => {
    const p = getProgress(state, ex.exerciseId);
    // Séries LOGIQUES (orders distincts), pas lignes : un exo unilatéral logge
    // deux lignes par série (G + D), donc `sets.length` le déclarerait « fait »
    // à mi-chemin du prescrit. `countLogicalSetsDone` vaut `sets.length` en
    // bilatéral (1 ligne = 1 order) et reste juste en unilatéral.
    // Un exo PASSÉ n'est pas un exo fait : il est compté à part, pour que
    // « Exercices faits 3/3 » ne couvre pas une séance où l'on en a sauté un.
    return !p.skipped && countLogicalSetsDone(p.sets) >= ex.prescription.sets.min;
  }).length;
  const exercisesSkipped = session.exercises.filter(
    (ex) => getProgress(state, ex.exerciseId).skipped,
  ).length;

  const count = countPerformedSets(
    session.exercises.map((ex) => ({
      unilateral: ex.unilateral ?? false,
      primaryMuscles: ex.primaryMuscles ?? [],
      sets: getProgress(state, ex.exerciseId).sets,
    })),
  );

  return {
    sessionName: session.name,
    exercisesDone,
    exercisesSkipped,
    exercisesTotal: session.exercises.length,
    totalSets: count.total,
    setsByMuscle: count.byMuscle,
  };
}
