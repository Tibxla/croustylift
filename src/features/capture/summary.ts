// Logiques pures de récapitulatif et de chrono — extraites de CaptureScreen pour
// être testables en isolation (pas de DOM, pas de React).
import type { CaptureState } from './state';
import { getProgress } from './state';
import type { Session } from './fixtures';
import type { SessionSummary } from './SessionEnd';
import { countPerformedSets } from '../../domain/set-count';

/**
 * Durée écoulée en minutes (arrondi) depuis le lancement de la séance, ou `null`
 * si `startedAt` est absent/invalide (cas dégénéré : on n'envoie ni n'affiche
 * de durée plutôt qu'une valeur trompeuse).
 */
export function elapsedMinutesSince(startedAt: number | undefined): number | null {
  if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) return null;
  return Math.round((Date.now() - startedAt) / 60000);
}

/**
 * Construit le récap sobre de l'exécution courante : exos faits / total + le
 * décompte RÉEL des séries (total + par muscle, issue #37). Le décompte applique
 * la règle exacte via le domaine pur `countPerformedSets` : une série logique =
 * un set_order (unilatéral G+D au même order = 1), unilatéral pèse 2 au total et
 * 1 par muscle, bilatéral 1/1, +1 par muscle principal de l'exo.
 */
export function buildSummary(session: Session, state: CaptureState): SessionSummary {
  const exercisesDone = session.exercises.filter((ex) => {
    const p = getProgress(state, ex.exerciseId);
    return p.skipped || p.sets.length >= ex.prescription.sets.min;
  }).length;

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
    exercisesTotal: session.exercises.length,
    totalSets: count.total,
    setsByMuscle: count.byMuscle,
  };
}
