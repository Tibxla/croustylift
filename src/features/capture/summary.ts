// Logiques pures de récapitulatif et de chrono — extraites de CaptureScreen pour
// être testables en isolation (pas de DOM, pas de React).
import type { CaptureState } from './state';
import { getProgress } from './state';
import type { Session } from './fixtures';
import type { SessionSummary } from './SessionEnd';

/**
 * Durée écoulée en minutes (arrondi) depuis le lancement de la séance, ou `null`
 * si `startedAt` est absent/invalide (cas dégénéré : on n'envoie ni n'affiche
 * de durée plutôt qu'une valeur trompeuse).
 */
export function elapsedMinutesSince(startedAt: number | undefined): number | null {
  if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) return null;
  return Math.round((Date.now() - startedAt) / 60000);
}

/** Construit le récap sobre de l'exécution courante (exos faits / total, séries). */
export function buildSummary(session: Session, state: CaptureState): SessionSummary {
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
