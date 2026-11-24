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
// tous deux par `logicalSetRows` puis `ranksAfterDeletion`, rien d'autre ne
// connaît la règle.
//
// QUELLES LIGNES PARTENT (`logicalSetRows`). On désigne une LIGNE ; c'est sa
// série logique qui part. En bilatéral, la ligne seule : deux lignes peuvent
// partager un rang (deux onglets ont chacun ajouté une série depuis le même
// état, la base n'y met aucune unicité), la bande en montre alors deux cases,
// et supprimer l'une ne doit pas emporter l'autre. En unilatéral, la gauche ET
// la droite du rang, mais seulement quand elles forment une paire sans
// ambiguïté (exactement une gauche et une droite à ce rang) ; sinon, la ligne
// seule.
//
// QUI REMONTE (`ranksAfterDeletion`). Seulement si le rang est devenu VIDE :
// avec A1, B2, C2, D3, supprimer B laisse C au rang 2, et faire remonter D
// créerait une nouvelle collision (D2).

import type { PerformedSet } from '../../domain/types';

/** 'compact' : les séries suivantes remontent d'un rang. 'gap' : les rangs restants ne bougent pas. */
export type RankPolicy = 'compact' | 'gap';

/** La règle en vigueur (cf. ADR 0024, proposé). */
export const RANK_POLICY_AFTER_DELETION: RankPolicy = 'compact';

/**
 * Les index des lignes qui partent quand on supprime la série de la ligne
 * `index` (cf. en-tête) : la ligne seule, ou la paire gauche et droite de son
 * rang. Vide si `index` ne désigne aucune ligne. Pur.
 */
export function logicalSetRows<T extends Pick<PerformedSet, 'order' | 'side'>>(
  sets: readonly T[],
  index: number,
): number[] {
  const target = sets[index];
  if (target === undefined) return [];
  if (target.side === undefined) return [index];
  const sameRank = sets.flatMap((set, i) => (set.order === target.order ? [i] : []));
  const sides = new Set(sameRank.map((i) => sets[i]!.side));
  const pair = sameRank.length === 2 && sides.has('left') && sides.has('right');
  return pair ? sameRank : [index];
}

/**
 * Les lignes restantes après le retrait des lignes d'index `removed` (une
 * série logique, cf. `logicalSetRows`), avec leurs rangs selon la règle : si le
 * rang retiré est devenu vide, les suivantes remontent d'un rang ('compact').
 * Les deux côtés d'une série gardent un rang commun. Pur ; l'ordre des lignes
 * est conservé.
 */
export function ranksAfterDeletion<T extends Pick<PerformedSet, 'order'>>(
  sets: readonly T[],
  removed: readonly number[],
  policy: RankPolicy = RANK_POLICY_AFTER_DELETION,
): T[] {
  const gone = new Set(removed);
  const kept = sets.filter((_, i) => !gone.has(i));
  const deletedOrder = sets[removed[0] ?? -1]?.order;
  if (policy === 'gap' || deletedOrder === undefined) return kept;
  if (kept.some((set) => set.order === deletedOrder)) return kept;
  return kept.map((set) => (set.order > deletedOrder ? { ...set, order: set.order - 1 } : set));
}

/**
 * Ce qu'emporterait la suppression de la série de la ligne `index`, tel que la
 * confirmation l'annonce : les deux côtés partent-ils (`bothSides`), et combien
 * de séries suivantes changent de rang (`movedRanks`, en séries : une paire
 * compte une fois). Lit la même règle que le geste. Pur.
 */
export function deletionPreview<T extends Pick<PerformedSet, 'order' | 'side'>>(
  sets: readonly T[],
  index: number,
  policy: RankPolicy = RANK_POLICY_AFTER_DELETION,
): { bothSides: boolean; movedRanks: number } {
  const removed = logicalSetRows(sets, index);
  const kept = sets.filter((_, i) => !removed.includes(i));
  const after = ranksAfterDeletion(sets, removed, policy);
  const moved = new Set(kept.filter((set, i) => after[i]?.order !== set.order).map((set) => set.order));
  return { bothSides: removed.length === 2, movedRanks: moved.size };
}
