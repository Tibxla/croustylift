// Joue un geste sur les séries (set-gestures.ts) comme l'écran de la Salle le
// fait pour corriger, supprimer ou changer le côté d'une série : l'action part
// au réducteur, la projection synchrone de l'état avance du même pas, puis les
// écritures du geste s'enfilent EN UNE FOIS (une unité dans la file, cf.
// `enqueueAll`, outbox.ts). Une écriture de série exige l'exécution en base :
// elle est ré-affirmée avant (insertion seule, le lancement ne bouge pas).
//
// Sans React ni réseau : l'écran passe ses propres `dispatch`, ré-affirmation et
// mise en file (CaptureScreen), les tests des espions.
import type { OutboxOp } from './outbox';
import type { SetGesture } from './set-gestures';
import { captureReducer, type CaptureAction, type CaptureState } from './state';

export interface SetGestureIo {
  dispatch: (action: CaptureAction) => void;
  /** Ré-affirme l'exécution en base (une fois par montage). */
  ensureExecution: () => void;
  /** Enfile les ops du geste comme une unité, puis lance l'envoi. */
  enqueueGesture: (ops: readonly OutboxOp[]) => void;
}

/** L'état après le geste (le même si `gesture` est `null` : rien à faire). */
export function applySetGesture(state: CaptureState, gesture: SetGesture | null, io: SetGestureIo): CaptureState {
  if (gesture === null) return state;
  io.dispatch(gesture.action);
  const next = captureReducer(state, gesture.action);
  if (gesture.ops.some((op) => op.type === 'insertSet' || op.type === 'patchSet')) io.ensureExecution();
  io.enqueueGesture(gesture.ops);
  return next;
}
