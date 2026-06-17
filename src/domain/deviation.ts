// Déviations dérivées par diff entre le prescrit et le réalisé (cf. ADR 0002).
//
// PÉRIMÈTRE : ce module ne dérive QUE les déviations de COMPTE DE SÉRIES
// (série annulée/skippée, série en moins, série en trop). On compare le NOMBRE
// de séries réellement faites à la fourchette `prescription.sets`.
// Les déviations de reps/RIR par série et les déviations d'ordre d'exécution
// sont HORS périmètre — volontairement non implémentées ici.
import type { Range, Prescription, PerformedSet } from './types';

export type DeviationKind = 'skipped' | 'fewer-sets' | 'extra-sets';

export interface Deviation {
  kind: DeviationKind;
  expected: Range;
  actual: number;
}

export function deriveDeviations(
  prescription: Prescription,
  performedSets: PerformedSet[],
): Deviation[] {
  const count = performedSets.length;
  const expected = prescription.sets;

  if (count === 0) {
    return [{ kind: 'skipped', expected, actual: count }];
  }

  if (count < expected.min) {
    return [{ kind: 'fewer-sets', expected, actual: count }];
  }

  if (count > expected.max) {
    return [{ kind: 'extra-sets', expected, actual: count }];
  }

  return [];
}
