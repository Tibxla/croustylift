// Formatage des readouts (Readout Rule) — chiffres mesurés en FR (virgule décimale).
import type { Range, PerformedSet } from '../../domain/types';

/** Poids en kg, virgule décimale FR, sans zéro inutile : 82.5 -> "82,5", 80 -> "80". */
export function formatWeight(kg: number): string {
  const rounded = Math.round(kg * 100) / 100;
  return rounded.toString().replace('.', ',');
}

/** Une fourchette : "8-12" si min≠max, sinon "3" si min===max. */
export function formatRange(range: Range): string {
  return range.min === range.max ? `${range.min}` : `${range.min}-${range.max}`;
}

/** La cible prescrite en une ligne : "3-4 × 8-12 @ RIR 1-2". */
export function formatPrescription(sets: Range, reps: Range, rir: Range): string {
  return `${formatRange(sets)} × ${formatRange(reps)} @ RIR ${formatRange(rir)}`;
}

/** Une série loggée en ligne mono : "82,5 × 8 @ RIR 2". */
export function formatSet(set: PerformedSet): string {
  return `${formatWeight(set.weightKg)} × ${set.reps} @ RIR ${set.rir}`;
}

/** Un décompte de séries en équivalent-série (demi-série possible) : "1", "0,5", "1,5". */
export function formatSetCount(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return rounded.toString().replace('.', ',');
}

/** e1RM arrondi à 0,5 kg, format FR : "94,4". */
export function formatE1rm(value: number): string {
  const half = Math.round(value * 2) / 2;
  return formatWeight(half);
}
