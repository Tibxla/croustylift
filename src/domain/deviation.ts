// Déviations dérivées par diff entre le prescrit et le réalisé (cf. ADR 0002).
//
// PÉRIMÈTRE : ce module ne dérive QUE les déviations de COMPTE DE SÉRIES
// (série annulée/skippée, série en moins, série en trop). On compare le NOMBRE
// de séries réellement faites à la fourchette `prescription.sets`.
// Les déviations de reps/RIR par série et les déviations d'ordre d'exécution
// sont HORS périmètre — volontairement non implémentées ici.
//
// On compte des SÉRIES LOGIQUES, pas des lignes : un exo UNILATÉRAL tient une
// série sur deux lignes (gauche + droite au MÊME `order`, cf. CONTEXT.md
// « Série » / « Unilatéral »). Comparer `performedSets.length` (le nombre de
// lignes) à `prescription.sets` (un nombre de séries) doublerait le compte en
// unilatéral — 3 séries (6 lignes) face à un prescrit {3,4} apparaîtraient « au-
// dessus ». On délègue donc à `countLogicalSetsDone` (orders distincts), qui
// vaut le nombre de lignes en bilatéral (1 ligne = 1 order) et reste juste en
// unilatéral.
import type { Range, Prescription, PerformedSet } from './types';
import { countLogicalSetsDone } from './set-count';

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
  const count = countLogicalSetsDone(performedSets);
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
