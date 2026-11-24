// Gestes sur les EXOS de la séance en cours (pas sur leurs séries, cf.
// set-gestures.ts). Logique pure, sans React ni réseau.
//
// API pour l'écran, même forme que set-gestures.ts : chaque geste est une
// fonction `geste(état, arguments) -> { action, ops } | null`. L'écran dispatche
// `action`, avance sa projection par le même réducteur, puis enfile `ops`.
// `null` : rien à faire.
//
// REMETTRE UN EXO PASSÉ (`restoreSkippedExercise`). « Passé » est une marque de
// l'appareil (`ExerciseProgress.skipped`) : elle n'existe pas en base, donc le
// geste n'enfile rien. Elle est persistée avec l'état de capture, et une réponse
// tardive de la base ne la touche pas (`reconcileProgress` et `applyQueuedSets`
// gardent le `skipped` local). Les séries faites avant de passer l'exo restent :
// remis, il redevient « en cours ». Logger une série sur un exo passé le remet
// de lui-même (`log-set`).

import type { OutboxOp } from './outbox';
import { getProgress, type CaptureAction, type CaptureState } from './state';

/** Ce qu'un geste demande à l'écran : une action pour le réducteur, des écritures pour la file. */
export interface ExerciseGesture {
  action: CaptureAction;
  ops: OutboxOp[];
}

/** Remet l'exo `exerciseId` s'il est marqué « passé ». `null` s'il ne l'est pas. */
export function restoreSkippedExercise(
  state: CaptureState,
  exerciseId: string,
): ExerciseGesture | null {
  if (!getProgress(state, exerciseId).skipped) return null;
  return { action: { type: 'unskip-exercise', exerciseId }, ops: [] };
}
