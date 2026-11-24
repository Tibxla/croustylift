// Où en est chaque exo de la séance, pour la Salle : marque d'état (index du
// haut, Sommaire), exos faits, et l'exo SUIVANT que propose « Exo suivant ».
// Pur (testé). Le compte est celui du sélecteur d'exos depuis l'issue #46 : des
// SÉRIES LOGIQUES (`countLogicalSetsDone`, un `order` = une série, gauche et
// droite d'un unilatéral comptant pour une), comparées au minimum prescrit.
import { countLogicalSetsDone } from '../../domain/set-count';
import type { ExoState } from '../../ui';
import type { Session } from './fixtures';
import { getProgress, type CaptureState, type ExerciseProgress } from './state';

/** Séries logiques faites d'un exo. */
export function logicalSetsDone(progress: ExerciseProgress): number {
  return countLogicalSetsDone(progress.sets);
}

/** Marque d'état d'un exo : passé, à faire, en cours (sous le minimum), fait. */
export function exoState(progress: ExerciseProgress, prescribedMin: number): ExoState {
  if (progress.skipped) return 'skipped';
  const done = logicalSetsDone(progress);
  if (done === 0) return 'todo';
  return done >= prescribedMin ? 'done' : 'partial';
}

/** Le mot de chaque état, tel que l'écran l'écrit. */
export const EXO_STATE_WORD: Record<ExoState, string> = {
  todo: 'à faire',
  partial: 'en cours',
  done: 'fait',
  skipped: 'passé',
};

/** Exos réglés : faits ou passés (le compte « n sur m » du Sommaire). */
export function settledCount(session: Session, state: CaptureState): number {
  return session.exercises.filter((ex) => {
    const s = exoState(getProgress(state, ex.exerciseId), ex.prescription.sets.min);
    return s === 'done' || s === 'skipped';
  }).length;
}

/**
 * L'exo que propose « Exo suivant » : le premier après `currentId`, dans l'ordre
 * de la séance, qui n'est ni fait ni passé ; à défaut, le premier dans ce cas
 * avant lui (on revient sur un exo laissé en cours). `null` s'il ne reste rien :
 * l'écran propose alors de terminer la séance.
 */
export function nextExerciseId(session: Session, state: CaptureState, currentId: string | null): string | null {
  const list = session.exercises;
  const at = currentId === null ? -1 : list.findIndex((e) => e.exerciseId === currentId);
  for (let k = 1; k <= list.length; k += 1) {
    const ex = list[(at + k + list.length) % list.length]!;
    if (ex.exerciseId === currentId) continue;
    const s = exoState(getProgress(state, ex.exerciseId), ex.prescription.sets.min);
    if (s === 'todo' || s === 'partial') return ex.exerciseId;
  }
  return null;
}

/** Où reprend un exo entamé : « série 2 », ou null s'il n'est pas commencé. */
export function resumeWord(progress: ExerciseProgress): string | null {
  const done = logicalSetsDone(progress);
  return done > 0 ? `série ${done + 1}` : null;
}
