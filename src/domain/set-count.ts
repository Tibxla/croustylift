// Décompte de séries d'une séance, par muscle principal et au total (issue #37).
//
// Deux lectures de la MÊME séance, dérivées du même cœur de comptage :
//   - PRÉVU  : à partir des prescriptions (séries prescrites par exo, en fourchette) ;
//   - RÉEL   : à partir des séries réellement loggées (PerformedSet[]).
//
// VOCABULAIRE — on parle de DÉCOMPTE DE SÉRIES, jamais de « volume » : le
// CONTEXT.md réserve « groupe musculaire principal » au regroupement/filtre et
// proscrit le terme « volume ». Ici on compte des séries rattachées à chaque
// muscle PRINCIPAL de l'exo (la LISTE `primary_muscles` d'issue #33, pas le
// `muscle_group` legacy au singulier).
//
// SÉRIE LOGIQUE — l'unité de comptage est la série logique, soit un `set_order` :
//   - BILATÉRAL  : une ligne loggée = une série logique ;
//   - UNILATÉRAL : deux lignes (gauche + droite) au MÊME order = une série logique.
//
// RÈGLE DE POIDS (à la lettre, cf. issue #37) :
//   - TOTAL séance : chaque série logique compte (exo unilatéral ? 2 : 1). Une
//     série unilatérale vaut donc 2 au total (les deux côtés travaillés), une
//     bilatérale 1.
//   - PAR MUSCLE M : chaque série logique d'un exo ayant M dans ses muscles
//     principaux compte 1 pour M, unilatéral comme bilatéral (le muscle ne
//     travaille pas « deux fois » du seul fait des deux côtés). Une série
//     multi-muscles compte +1 pour CHACUN des muscles principaux de l'exo.
import type { PerformedSet } from './types'

/** Fourchette de comptes (min, max). Une valeur fixe a `min === max`. */
export interface CountRange {
  min: number
  max: number
}

/** Décompte RÉEL : total et répartition par muscle (entiers exacts). */
export interface SetCount {
  total: number
  /** Nombre de séries rattachées à chaque muscle principal présent. */
  byMuscle: Record<string, number>
}

/** Décompte PRÉVU : total et répartition par muscle, en fourchettes. */
export interface PlannedSetCount {
  total: CountRange
  byMuscle: Record<string, CountRange>
}

/** Le facteur du TOTAL pour un exo : unilatéral compte double, bilatéral simple. */
function totalWeight(unilateral: boolean): number {
  return unilateral ? 2 : 1
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
  unilateral: boolean
  primaryMuscles: string[]
  /** Nombre de séries logiques (prévues ou faites) à compter pour cet exo. */
  logicalSets: number
}

/**
 * Cœur de comptage : applique la règle de poids sur un nombre de séries logiques
 * déjà calculé, sans connaître sa provenance (prévu ou réel). Le total pondère
 * par l'unilatéralité (×2) ; chaque muscle principal reçoit +1 par série logique.
 */
export function countSetsByMuscle(exercises: CountableExercise[]): SetCount {
  let total = 0
  const byMuscle: Record<string, number> = {}
  for (const exo of exercises) {
    if (exo.logicalSets <= 0) continue
    total += exo.logicalSets * totalWeight(exo.unilateral)
    for (const muscle of exo.primaryMuscles) {
      byMuscle[muscle] = (byMuscle[muscle] ?? 0) + exo.logicalSets
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
 * Décompte RÉEL d'une séance, dérivé des séries loggées. Chaque exo apporte ses
 * séries logiques (orders distincts) pondérées par la règle (cf. en-tête).
 */
export function countPerformedSets(exercises: PerformedExercise[]): SetCount {
  return countSetsByMuscle(
    exercises.map((exo) => ({
      unilateral: exo.unilateral,
      primaryMuscles: exo.primaryMuscles,
      logicalSets: countLogicalSetsDone(exo.sets),
    })),
  )
}

/** Un exo prescrit : son drapeau unilatéral, ses muscles, sa fourchette de séries. */
export interface PlannedExercise {
  unilateral: boolean
  primaryMuscles: string[]
  /** Séries prescrites, en fourchette (fixe = min === max). */
  sets: CountRange
}

/**
 * Décompte PRÉVU d'une séance, dérivé des prescriptions. Comme une prescription
 * peut être une FOURCHETTE de séries (min..max), le décompte l'est aussi : on
 * compte deux fois — une passe sur les min, une sur les max — et on assemble une
 * fourchette par muscle et au total. Prescription fixe (min === max) -> fourchette
 * dégénérée, donc une valeur unique à l'affichage.
 */
export function countPlannedSets(exercises: PlannedExercise[]): PlannedSetCount {
  const atMin = countSetsByMuscle(
    exercises.map((exo) => ({
      unilateral: exo.unilateral,
      primaryMuscles: exo.primaryMuscles,
      logicalSets: exo.sets.min,
    })),
  )
  const atMax = countSetsByMuscle(
    exercises.map((exo) => ({
      unilateral: exo.unilateral,
      primaryMuscles: exo.primaryMuscles,
      logicalSets: exo.sets.max,
    })),
  )

  // Réunit les deux passes en fourchettes. Les clés muscle des deux passes sont
  // identiques (mêmes exos, mêmes muscles) dès que la borne est > 0 ; on prend
  // donc l'union des clés pour rester robuste à un min à 0 (fourchette 0..n).
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
