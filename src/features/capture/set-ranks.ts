// LA règle des rangs après la suppression d'une série, en un seul endroit.
//
// Décision ouverte (ADR 0024, proposé) : quand on supprime la série 2 d'un exo
// qui en a quatre, les suivantes REMONTENT-elles (1, 2, 3) ou laissent-elles un
// TROU (1, 3, 4) ? La règle retenue par défaut est la remontée, celle de
// l'éditeur de séance passée (`reorderSets`, past-session-edit.ts) : le rang
// d'une série est sa place dans l'exo, c'est lui que la Référence compare
// (« série 2 contre série 2 de la dernière fois »).
//
// Pour basculer : changer `RANK_POLICY_AFTER_DELETION`. Le réducteur
// (`delete-set`, state.ts) et le geste (`deleteSet`, set-gestures.ts) passent
// tous deux par `ranksAfterDeletion`, rien d'autre ne connaît la règle.

import type { PerformedSet } from '../../domain/types';

/** 'compact' : les séries suivantes remontent d'un rang. 'gap' : les rangs restants ne bougent pas. */
export type RankPolicy = 'compact' | 'gap';

/** La règle en vigueur (cf. ADR 0024, proposé). */
export const RANK_POLICY_AFTER_DELETION: RankPolicy = 'compact';

/**
 * Les séries restantes après la suppression de la série LOGIQUE de rang
 * `deletedOrder` (toutes ses lignes : gauche et droite en unilatéral), avec
 * leurs rangs selon la règle. Les deux côtés d'une série gardent un rang
 * commun. Pur ; l'ordre des lignes est conservé.
 */
export function ranksAfterDeletion<T extends Pick<PerformedSet, 'order'>>(
  sets: readonly T[],
  deletedOrder: number,
  policy: RankPolicy = RANK_POLICY_AFTER_DELETION,
): T[] {
  const kept = sets.filter((set) => set.order !== deletedOrder);
  if (policy === 'gap') return kept;
  return kept.map((set) => (set.order > deletedOrder ? { ...set, order: set.order - 1 } : set));
}
