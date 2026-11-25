// Ce que dit le pied de l'instrument de la Salle (le rendu : SalleFoot.tsx).
// Pur : le libellé de « Logger » et ce qu'« Annuler » retirera, tels que le
// moteur les écrit (log : `log-set` du réducteur ; annulation : `undoLastSet`,
// set-gestures.ts).
import type { Side } from '../../domain/types';
import { targetSlotForSide } from '../../domain/unilateral';
import type { ExerciseProgress } from './state';

const sideWord = (side: Side): string => (side === 'left' ? 'gauche' : 'droite');

/** Le rang que dit « Logger » : en unilatéral, la série que vise le côté choisi
 *  (la case en cours de la bande, `targetSlotForSide`) ; en bilatéral, la série
 *  qui suit les séries faites. */
export function logRank(progress: ExerciseProgress, side: Side | null): number {
  return side ? targetSlotForSide(progress.sets, side) + 1 : progress.sets.length + 1;
}

/** Libellé de « Logger » : le côté en unilatéral, le rang sinon, « une de plus »
 *  au-delà du plan. L'info tient au TEXTE, jamais à la couleur seule. */
export function logLabel(side: Side | null, rank: number, plannedMax: number): string {
  if (side) return `Logger ${sideWord(side)} · série ${rank}`;
  return rank > plannedMax ? 'Logger une de plus' : `Logger la série ${rank}`;
}

/** « Annuler » retire la DERNIÈRE ligne loggée : un côté en unilatéral (décision
 *  2b). Son nom lu, et le mot court que le pied peut écrire ; `null` sans série. */
export function footUndo(progress: ExerciseProgress): { aria: string; word: string } | null {
  const last = progress.sets[progress.sets.length - 1];
  if (!last) return null;
  return last.side
    ? { aria: `Annuler le côté ${sideWord(last.side)} de la série ${last.order}`, word: sideWord(last.side) }
    : { aria: `Annuler la série ${last.order}`, word: `série ${last.order}` };
}
