// Décompte de séries d'une séance, par muscle principal et au total. Pondéré par
// les reps de chaque série (issue #60, affine la règle initiale d'issue #37).
//
// Deux lectures de la MÊME séance, dérivées du même cœur de comptage :
//   - PRÉVU  : à partir des prescriptions (séries prescrites par exo, en fourchette) ;
//   - RÉEL   : à partir des séries réellement loggées (PerformedSet[]).
//
// VOCABULAIRE — on parle de DÉCOMPTE DE SÉRIES, jamais de « volume » : le
// CONTEXT.md réserve « muscle principal » au regroupement/filtre et proscrit le
// terme « volume ». Ici on compte des séries (pondérées) rattachées à chaque
// muscle PRINCIPAL de l'exo (la LISTE `primary_muscles` d'issue #33, pas le
// `muscle_group` legacy au singulier).
//
// SÉRIE LOGIQUE — l'unité de comptage est la série logique, soit un `set_order` :
//   - BILATÉRAL  : une ligne loggée = une série logique ;
//   - UNILATÉRAL : deux lignes (gauche + droite) au MÊME order = une série logique.
//
// PONDÉRATION PAR REPS (issue #60, à la lettre) — une série ne vaut plus « 1 »
// mais sa CONTRIBUTION, fonction de ses reps :
//   contribution(reps) = min(reps, 5) / 5
//   (reps ≥ 5 → 1 plafonné ; reps < 5 → crédit partiel reps/5). Ex. 3 reps → 0.6 ;
//   10 reps → 1 (plafonné, pas 2).
//
// COMBINAISON UNILATÉRAL (série = côté gauche + côté droit, reps par côté) :
//   - TOTAL séance : somme des DEUX côtés (contribution gauche + contribution
//     droite). Une série pleine unilatérale (≥5 reps des deux côtés) vaut donc 2.
//   - PAR MUSCLE M : le côté FAIBLE seulement (reps le plus bas), cohérent avec
//     l'e1RM pris côté faible. Une série pleine vaut donc 1 par muscle.
//   - La contribution PAR MUSCLE s'applique à CHACUN des muscles principaux de l'exo.
//   BILATÉRAL : la série vaut contribution(reps) au total ET pour chaque muscle.
import type { PerformedSet } from './types'

/** Plafond de reps au-delà duquel une série vaut « plein » (1). */
const FULL_REPS = 5

/**
 * Contribution d'une série au décompte, pondérée par ses reps (issue #60) :
 * `min(reps, FULL_REPS) / FULL_REPS`. reps ≥ 5 → 1 (plafonné) ; reps < 5 →
 * crédit partiel reps/5 ; reps ≤ 0 (cas dégénéré) → 0, jamais de crédit négatif.
 */
export function contribution(reps: number): number {
  if (reps <= 0) return 0
  return Math.min(reps, FULL_REPS) / FULL_REPS
}

/** Fourchette de comptes (min, max). Une valeur fixe a `min === max`. */
export interface CountRange {
  min: number
  max: number
}

/**
 * Décompte RÉEL : total et répartition par muscle. Valeurs FRACTIONNAIRES depuis
 * la pondération par reps (issue #60) — à afficher avec une décimale.
 */
export interface SetCount {
  total: number
  /** Contribution cumulée rattachée à chaque muscle principal présent. */
  byMuscle: Record<string, number>
}

/** Décompte PRÉVU : total et répartition par muscle, en fourchettes fractionnaires. */
export interface PlannedSetCount {
  total: CountRange
  byMuscle: Record<string, CountRange>
}

/**
 * Contribution déjà pondérée d'UNE série logique, séparée selon sa destination :
 * `total` (somme des côtés pour l'unilatéral) et `perMuscle` (côté faible pour
 * l'unilatéral), appliquée telle quelle à chaque muscle principal de l'exo.
 */
export interface LogicalSetContribution {
  total: number
  perMuscle: number
}

/**
 * Nombre de SÉRIES LOGIQUES réellement loggées d'un exo, à partir de ses
 * PerformedSet : le nombre de `set_order` DISTINCTS. Une série unilatérale
 * (gauche + droite au même order) compte donc une fois, un côté seul (saisie
 * incomplète) compte tout de même la série entamée.
 */
export function countLogicalSetsDone(sets: PerformedSet[]): number {
  const orders = new Set<number>()
  for (const set of sets) orders.add(set.order)
  return orders.size
}

/** Un exo réduit au strict nécessaire pour le comptage (cœur partagé). */
export interface CountableExercise {
  primaryMuscles: string[]
  /**
   * Contribution déjà pondérée de chaque série logique (prévue ou faite) à
   * compter pour cet exo. Le calcul de la pondération (reps, côté faible…) est
   * fait en amont, par la lecture prévue ou réelle.
   */
  logicalSets: LogicalSetContribution[]
}

/**
 * Cœur de comptage : somme les contributions déjà pondérées de chaque série
 * logique, sans connaître leur provenance (prévu ou réel). Chaque série ajoute
 * sa `total` au global et sa `perMuscle` à CHACUN des muscles principaux de l'exo.
 */
export function countSetsByMuscle(exercises: CountableExercise[]): SetCount {
  let total = 0
  const byMuscle: Record<string, number> = {}
  for (const exo of exercises) {
    for (const set of exo.logicalSets) {
      total += set.total
      for (const muscle of exo.primaryMuscles) {
        byMuscle[muscle] = (byMuscle[muscle] ?? 0) + set.perMuscle
      }
    }
  }
  return { total, byMuscle }
}

/** Un exo loggé : son drapeau unilatéral, ses muscles principaux, ses séries faites. */
export interface PerformedExercise {
  unilateral: boolean
  primaryMuscles: string[]
  sets: PerformedSet[]
}

/**
 * Contribution réelle d'un exo loggé : groupe les PerformedSet par `order` (série
 * logique) puis applique la pondération par reps (issue #60).
 *   - BILATÉRAL : une ligne par série, contribution = contribution(reps) au total
 *     et par muscle.
 *   - UNILATÉRAL : les côtés partagent l'order. total = somme des contributions
 *     des côtés présents ; perMuscle = contribution du côté FAIBLE (reps le plus
 *     bas) ; un seul côté loggé (saisie incomplète) → ce côté seul des deux parts.
 */
function performedContributions(exo: PerformedExercise): LogicalSetContribution[] {
  const byOrder = new Map<number, PerformedSet[]>()
  for (const set of exo.sets) {
    const group = byOrder.get(set.order)
    if (group) group.push(set)
    else byOrder.set(set.order, [set])
  }

  const contributions: LogicalSetContribution[] = []
  for (const group of byOrder.values()) {
    if (!exo.unilateral) {
      // Bilatéral : une série = une (ou plusieurs, défensif) ligne(s) au même
      // order ; on additionne (cas normal : une seule ligne).
      const c = group.reduce((sum, set) => sum + contribution(set.reps), 0)
      contributions.push({ total: c, perMuscle: c })
      continue
    }
    // Unilatéral : total = somme des côtés présents ; muscle = côté faible.
    const perSide = group.map((set) => contribution(set.reps))
    const total = perSide.reduce((sum, c) => sum + c, 0)
    const perMuscle = Math.min(...perSide)
    contributions.push({ total, perMuscle })
  }
  return contributions
}

/**
 * Décompte RÉEL d'une séance, dérivé des séries loggées et pondéré par reps
 * (issue #60). Chaque exo apporte la contribution de ses séries logiques.
 */
export function countPerformedSets(exercises: PerformedExercise[]): SetCount {
  return countSetsByMuscle(
    exercises.map((exo) => ({
      primaryMuscles: exo.primaryMuscles,
      logicalSets: performedContributions(exo),
    })),
  )
}

/** Un exo prescrit : son drapeau unilatéral, ses muscles, ses séries et reps prescrits. */
export interface PlannedExercise {
  unilateral: boolean
  primaryMuscles: string[]
  /** Séries prescrites, en fourchette (fixe = min === max). */
  sets: CountRange
  /** Reps prescrites, en fourchette (fixe = min === max). On pondère par `reps.min`. */
  reps: CountRange
}

/**
 * Contribution d'UNE série prévue d'un exo, pondérée par `reps.min` (borne basse
 * de la prescription, issue #60). Les deux côtés d'un unilatéral suivent la même
 * prescription → total = 2 × contribution, perMuscle = contribution (côté faible
 * = même reps).
 */
function plannedContribution(exo: PlannedExercise): LogicalSetContribution {
  const c = contribution(exo.reps.min)
  return exo.unilateral ? { total: 2 * c, perMuscle: c } : { total: c, perMuscle: c }
}

/**
 * Décompte PRÉVU d'une séance, dérivé des prescriptions et pondéré par `reps.min`
 * (issue #60). REPRÉSENTATION DE LA FOURCHETTE : la prescription de reps est
 * figée à sa borne basse (`reps.min`) ; seul le NOMBRE de séries varie. Le
 * décompte est donc une fourchette `[sets.min, sets.max] × contribution(reps.min)`
 * — fourchette de séries (« 1,8–2,4 ») ; séries fixes → fourchette dégénérée
 * (valeur unique). On compte deux fois (passe min, passe max) et on assemble.
 */
export function countPlannedSets(exercises: PlannedExercise[]): PlannedSetCount {
  // Une série prévue par exo, mais répétée `sets.min` (resp. `sets.max`) fois.
  const at = (bound: 'min' | 'max'): SetCount =>
    countSetsByMuscle(
      exercises.map((exo) => {
        const c = plannedContribution(exo)
        const repeat = Math.max(0, exo.sets[bound])
        return {
          primaryMuscles: exo.primaryMuscles,
          logicalSets: Array.from({ length: repeat }, () => c),
        }
      }),
    )

  const atMin = at('min')
  const atMax = at('max')

  // Réunit les deux passes en fourchettes. Union des clés muscle pour rester
  // robuste à un min à 0 (fourchette 0..n) — les clés diffèrent alors.
  const muscles = new Set([...Object.keys(atMin.byMuscle), ...Object.keys(atMax.byMuscle)])
  const byMuscle: Record<string, CountRange> = {}
  for (const muscle of muscles) {
    byMuscle[muscle] = {
      min: atMin.byMuscle[muscle] ?? 0,
      max: atMax.byMuscle[muscle] ?? 0,
    }
  }

  return {
    total: { min: atMin.total, max: atMax.total },
    byMuscle,
  }
}
