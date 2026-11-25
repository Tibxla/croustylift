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
// tardive de la base ne la touche pas (le réalisé garde le `skipped` local,
// `executionReality`). Les séries faites avant de passer l'exo restent :
// remis, il redevient « en cours ». Logger une série sur un exo passé le remet
// de lui-même (`log-set`).
//
// REMPLACER UN EXO (`replaceExercise`). Deux cas, décidés sur l'état au moment
// du geste :
//   - l'exo n'a aucune série : le remplaçant prend sa place (comportement
//     d'origine, `swapExercise`) ;
//   - l'exo est DÉJÀ COMMENCÉ (machine prise) : il reste à sa place avec ses
//     séries, « en cours », et le remplaçant s'insère juste après lui, marqué
//     « remplacé » (`origin: 'swapped'`, `swappedFrom`). Aucune série ne change
//     de propriétaire, donc aucune écriture.
// La fonction rend la nouvelle `session` (liste affichée), l'`action` qui inscrit
// le geste dans la disposition persistée (`layout`), et `openExerciseId` : le
// remplaçant, si l'exo remplacé était celui que l'instrument affichait (l'écran
// dispatche alors `open-exercise`), sinon `null`. « Commencé » est inscrit dans
// le geste (`keepsReplaced`). Si la base ou la file révèle ensuite une série
// sur l'exo masqué, le réducteur complète ce geste. L'écran rejoue alors la
// disposition corrigée depuis le template. Elle persiste même si la série est
// ensuite supprimée. Le remplaçant
// doit arriver prêt à afficher (historique, note), comme pour un ajout.

import type { Session, SessionExercise } from './fixtures';
import type { OutboxOp } from './outbox';
import { insertReplacementAfter, layoutEditOf, swapExercise } from './session-edit';
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

/** Un remplacement d'exo : la séance à afficher, le geste à journaliser, l'exo à ouvrir. */
export interface ReplaceExerciseGesture extends ExerciseGesture {
  session: Session;
  /** Le remplaçant, si l'exo remplacé était affiché dans l'instrument ; sinon `null`. */
  openExerciseId: string | null;
}

/**
 * Remplace l'exo `targetExerciseId` de `session` par `replacement` (cf. en-tête).
 * `null` si la cible n'est pas dans la séance, ou si le remplaçant y est déjà.
 */
export function replaceExercise(
  state: CaptureState,
  session: Session,
  targetExerciseId: string,
  replacement: SessionExercise,
): ReplaceExerciseGesture | null {
  const ids = session.exercises.map((e) => e.exerciseId);
  if (!ids.includes(targetExerciseId) || ids.includes(replacement.exerciseId)) return null;
  const keepsReplaced = getProgress(state, targetExerciseId).sets.length > 0;
  return {
    session: keepsReplaced
      ? insertReplacementAfter(session, targetExerciseId, replacement)
      : swapExercise(session, targetExerciseId, replacement),
    action: {
      type: 'edit-layout',
      edit: layoutEditOf(replacement, targetExerciseId, { keepsReplaced }),
    },
    ops: [],
    openExerciseId: state.activeExerciseId === targetExerciseId ? replacement.exerciseId : null,
  };
}
