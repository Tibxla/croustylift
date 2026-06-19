// Logique unilatérale (issue #46). Un exo UNILATÉRAL se logge un côté à la fois :
// une « série » se complète en saisissant le côté gauche PUIS le droit, chacun
// avec ses propres poids/reps/RIR. En base, ces deux saisies partagent le MÊME
// `order` et portent un `side` distinct (cf. PerformedSet.side, type domaine).
//
// Pour la PROGRESSION, on suit le CÔTÉ FAIBLE : le membre le moins fort dicte la
// charge réelle et le risque de déséquilibre. Le point de courbe d'une exécution
// unilatérale est donc l'e1RM le PLUS BAS des deux côtés sur la 1ʳᵉ série. Logique
// pure (aucun Supabase), réutilisée par buildPrimaryCurve.
//
// LIMITES CONNUES (hors périmètre issue #46, à traiter dans des issues dédiées) :
//   - Édition d'une séance passée (issue #38) : `reorderSets` recompacte les
//     orders en 1..N et l'EditableSet ne porte pas `side` -> éditer une exécution
//     unilatérale dé-apparierait G/D. À ne pas faire tant que l'édition n'a pas
//     été rendue consciente du côté.
//   - Log brut (issue #27/#32) : les séries unilatérales s'y affichent en deux
//     lignes au même order, sans libellé de côté (RawLogSet n'a pas `side`).
import { estimateE1rm } from './e1rm'
import type { PerformedSet } from './types'

/** Une série appariée par `order` : ses deux côtés (null si un côté manque). */
export interface SidePair {
  order: number
  left: PerformedSet | null
  right: PerformedSet | null
}

/**
 * Apparie les séries d'une exécution par `order` : pour chaque rang, ses côtés
 * gauche et droite. Un côté manquant (saisie incomplète) reste `null` plutôt
 * que d'être fabriqué. Trié par `order` croissant. Une série SANS `side`
 * (bilatérale) n'est appariée à aucun côté : ce helper ne sert que l'unilatéral.
 */
export function pairSidesByOrder(sets: PerformedSet[]): SidePair[] {
  const byOrder = new Map<number, SidePair>()
  for (const set of sets) {
    if (set.side === undefined) continue
    let pair = byOrder.get(set.order)
    if (!pair) {
      pair = { order: set.order, left: null, right: null }
      byOrder.set(set.order, pair)
    }
    if (set.side === 'left') pair.left = set
    else pair.right = set
  }
  return [...byOrder.values()].sort((a, b) => a.order - b.order)
}

/** e1RM d'une série, ou null si elle est absente (côté manquant). */
function e1rmOf(set: PerformedSet | null): number | null {
  return set === null ? null : estimateE1rm(set.weightKg, set.reps, set.rir)
}

/**
 * e1RM représentatif de la 1ʳᵉ série d'une exécution, point de la courbe primaire :
 *   - BILATÉRAL (séries sans `side`) : l'e1RM de la 1ʳᵉ série (order min), inchangé ;
 *   - UNILATÉRAL : le CÔTÉ FAIBLE de la 1ʳᵉ série, soit l'e1RM le PLUS BAS des
 *     deux côtés appariés par `order`. Un côté manquant (saisie incomplète) tombe
 *     sur le côté présent.
 * `null` si l'exécution n'a aucune série.
 */
export function weakSideE1rm(sets: PerformedSet[]): number | null {
  if (sets.length === 0) return null

  const isUnilateral = sets.some((s) => s.side !== undefined)
  if (!isUnilateral) {
    const first = sets.reduce((earliest, s) => (s.order < earliest.order ? s : earliest))
    return estimateE1rm(first.weightKg, first.reps, first.rir)
  }

  const pairs = pairSidesByOrder(sets)
  if (pairs.length === 0) return null
  const firstPair = pairs[0] // déjà trié par order : le rang 1
  const left = e1rmOf(firstPair.left)
  const right = e1rmOf(firstPair.right)
  if (left !== null && right !== null) return Math.min(left, right)
  return left ?? right
}
