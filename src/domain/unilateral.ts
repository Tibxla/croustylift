// Logique unilatérale (issue #46, sélecteur de côté #63). Un exo UNILATÉRAL se
// logge un côté à la fois : une « série » se complète quand les DEUX côtés (G et
// D) sont saisis, chacun avec ses propres poids/reps/RIR. L'utilisateur CHOISIT
// le côté (sélecteur G/D, #63) et peut commencer par la droite ; l'appariement
// ne suppose plus « gauche d'abord ». En base, les deux saisies d'une série
// partagent le MÊME `order` et portent un `side` distinct (cf. PerformedSet.side).
//
// Pour la PROGRESSION, on suit le CÔTÉ FAIBLE : le membre le moins fort dicte la
// charge réelle et le risque de déséquilibre. Le point de courbe d'une exécution
// unilatérale est donc l'e1RM le PLUS BAS des deux côtés sur la 1ʳᵉ série. Logique
// pure (aucun Supabase), réutilisée par buildPrimaryCurve.
//
// LIMITE CONNUE :
//   - Log brut (issue #27/#32) : les séries unilatérales s'y affichent en deux
//     lignes au même order, sans libellé de côté (RawLogSet n'a pas `side`).
// L'édition d'une séance passée (issue #38) gère DÉSORMAIS le côté : `side` est
// porté de bout en bout (chargement -> diff -> outbox -> DB) et `reorderSets`
// recompacte par SÉRIE LOGIQUE pour garder G/D appariés (cf. past-session-edit).
import { estimateE1rm } from './e1rm'
import type { PerformedSet, Side } from './types'

const SIDES: readonly Side[] = ['left', 'right']

/** L'autre côté (gauche <-> droite). */
function otherSide(side: Side): Side {
  return side === 'left' ? 'right' : 'left'
}

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

// --- Choix du côté & appariement agnostique de l'ordre (issue #63) -----------
// Le logging unilatéral n'impose plus « gauche PUIS droite » : l'utilisateur
// CHOISIT le côté (sélecteur G/D) et peut commencer par la droite. Une « série »
// logique se complète quand les DEUX côtés du MÊME set_order sont loggés, peu
// importe l'ordre de saisie. Ces helpers purs remplacent l'hypothèse « gauche
// d'abord » que portaient `pendingSide`/`nextSetOrder` (state.ts, issue #46).

/** Les côtés déjà loggés pour un set_order donné (0, 1 ou 2 entrées). */
export function sidesDoneAt(sets: PerformedSet[], order: number): Side[] {
  return sets
    .filter((s) => s.order === order && s.side !== undefined)
    .map((s) => s.side as Side)
}

/** Une série est complète quand ses DEUX côtés sont loggés au même set_order. */
export function isSetComplete(sets: PerformedSet[], order: number): boolean {
  const done = sidesDoneAt(sets, order)
  return SIDES.every((side) => done.includes(side))
}

/** Le plus grand set_order déjà loggé, ou 0 si aucune série. */
function maxOrder(sets: PerformedSet[]): number {
  return sets.reduce((max, s) => (s.order > max ? s.order : max), 0)
}

/**
 * Le set_order de la série EN COURS de saisie pour un exo unilatéral :
 *   - aucune série loggée -> 1 (la 1ʳᵉ série à venir) ;
 *   - la dernière série entamée est INCOMPLÈTE (un seul côté) -> son order, on
 *     reste dessus tant que l'autre côté manque ;
 *   - la dernière série est COMPLÈTE -> l'order suivant (la prochaine série).
 * Indépendant de l'ordre de saisie (commencer par la droite ne change rien).
 */
export function currentSetOrder(sets: PerformedSet[]): number {
  const top = maxOrder(sets)
  if (top === 0) return 1
  return isSetComplete(sets, top) ? top + 1 : top
}

/**
 * Le côté PROPOSÉ par défaut au sélecteur pour la prochaine saisie :
 *   - série en cours entamée d'un seul côté -> le côté MANQUANT (l'autre) ;
 *   - série en cours vide (aucune ou complète) -> gauche, sans rien forcer
 *     (l'utilisateur reste libre de choisir la droite).
 * Remplace `pendingSide` (issue #46) qui imposait l'ordre gauche -> droite.
 */
export function defaultSide(sets: PerformedSet[]): Side {
  const order = currentSetOrder(sets)
  const done = sidesDoneAt(sets, order)
  if (done.length === 1) return otherSide(done[0])
  return 'left'
}

/**
 * Le set_order où ÉCRIRE si l'utilisateur logge le côté `side` :
 *   - le côté complète la série en cours (entamée par l'autre côté, ce côté pas
 *     encore fait) -> réutilise son order (la paire G/D partage le même order) ;
 *   - sinon (série en cours vide, complète, ou ce côté déjà fait à cet order)
 *     -> ouvre une nouvelle série (max order + 1), pour ne JAMAIS écraser une
 *     saisie existante.
 * Pur, miroir local de la sémantique d'écriture (état + outbox). Remplace
 * `nextSetOrder` (state.ts) qui supposait que seul un GAUCHE pouvait être en
 * attente d'un droit.
 */
export function nextOrderForSide(sets: PerformedSet[], side: Side): number {
  const order = currentSetOrder(sets)
  const done = sidesDoneAt(sets, order)
  if (!done.includes(side)) return order
  return maxOrder(sets) + 1
}
