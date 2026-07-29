// Records personnels dérivés de l'historique d'un exo (issue #34).
//
// Deux records, deux mesures (cf. CONTEXT.md « Record personnel ») :
//   - bestE1rm       : le meilleur 1RM estimé (RIR-ajusté Epley, cf. e1rm.ts),
//                      pris sur TOUTES les séries — un record est une perf
//                      démontrée, quel que soit le rang de la série. La courbe
//                      e1RM d'analyse, elle, reste sur la 1ʳᵉ série de chaque
//                      exécution (weakSideE1rm) pour la comparabilité jour à
//                      jour : le record peut donc dépasser le sommet de la courbe.
//   - bestWeightReps : le record de CHARGE — la série la plus lourde jamais
//                      faite (toutes séries confondues), les reps départageant
//                      à poids égal.
// `bestE1rmSet` porte la perf (poids × reps) derrière le meilleur e1RM : c'est
// ELLE qu'on affiche en salle (« Record : 95 × 10 · e1RM 127 »).
//
// Tout est DÉRIVÉ de l'historique, jamais stocké : un record se recalcule depuis
// les exécutions. Style aligné sur reference.ts (fonctions pures, ExerciseExecution[]).
import type { ExerciseExecution, PerformedSet } from './types'
import { estimateE1rm } from './e1rm'
import { pairSidesByOrder } from './unilateral'

/** Une charge réalisée : poids et reps (le couple d'un record poids×reps). */
export interface WeightReps {
  weightKg: number
  reps: number
}

/** Les records d'un exo. `null` = aucun historique réel (premier passage). */
export interface PersonalRecord {
  /** Meilleur e1RM (toutes séries confondues), ou null si aucune perf. */
  bestE1rm: number | null
  /**
   * La perf qui porte le meilleur e1RM (poids × reps de cette série ; la ligne du
   * côté FAIBLE en unilatéral). Null exactement quand `bestE1rm` est null.
   */
  bestE1rmSet: WeightReps | null
  /** Série la plus lourde (reps en départage), ou null si aucune perf. */
  bestWeightReps: WeightReps | null
}

/** `b` est-elle une charge strictement supérieure à `a` (poids, puis reps) ? */
function heavier(a: WeightReps, b: WeightReps): boolean {
  if (b.weightKg !== a.weightKg) return b.weightKg > a.weightKg
  return b.reps > a.reps
}

/**
 * Records d'un exo dérivés de son historique. Les exécutions vides (trous) et
 * les séries des autres exos sont ignorées. Sans aucune série réelle, les deux
 * records valent `null`.
 */
export function personalRecord(
  executions: ExerciseExecution[],
  exerciseId: string,
): PersonalRecord {
  let bestE1rm: number | null = null
  let bestE1rmSet: WeightReps | null = null
  let bestWeightReps: WeightReps | null = null

  for (const exec of executions) {
    if (exec.exerciseId !== exerciseId || exec.sets.length === 0) continue

    // e1RM : TOUTES les séries comptent. Pour un exo UNILATÉRAL, chaque série
    // logique (paire G/D au même order) vaut son CÔTÉ FAIBLE, cohérent avec la
    // courbe primaire et l'ADR 0005 ; la perf porteuse est la ligne de ce côté.
    for (const { value, set } of seriesE1rms(exec.sets)) {
      if (bestE1rm === null || value > bestE1rm) {
        bestE1rm = value
        bestE1rmSet = { weightKg: set.weightKg, reps: set.reps }
      }
    }

    // poids×reps : la charge max sur l'ensemble des séries.
    for (const s of exec.sets) {
      const candidate = { weightKg: s.weightKg, reps: s.reps }
      if (bestWeightReps === null || heavier(bestWeightReps, candidate)) {
        bestWeightReps = candidate
      }
    }
  }

  return { bestE1rm, bestE1rmSet, bestWeightReps }
}

/**
 * L'e1RM de chaque série logique d'une exécution, avec la ligne qui le porte :
 *   - BILATÉRAL (séries sans `side`) : une entrée par ligne, e1RM simple ;
 *   - UNILATÉRAL : une entrée par paire G/D (appariée par order), au CÔTÉ FAIBLE
 *     (e1RM min des deux côtés ; à égalité, la ligne gauche). Un côté manquant
 *     (saisie incomplète) retombe sur le côté présent.
 */
function seriesE1rms(sets: PerformedSet[]): { value: number; set: PerformedSet }[] {
  const withE1rm = (set: PerformedSet) => ({
    value: estimateE1rm(set.weightKg, set.reps, set.rir),
    set,
  })

  const isUnilateral = sets.some((s) => s.side !== undefined)
  if (!isUnilateral) return sets.map(withE1rm)

  const out: { value: number; set: PerformedSet }[] = []
  for (const pair of pairSidesByOrder(sets)) {
    const left = pair.left ? withE1rm(pair.left) : null
    const right = pair.right ? withE1rm(pair.right) : null
    if (left && right) out.push(left.value <= right.value ? left : right)
    else if (left) out.push(left)
    else if (right) out.push(right)
  }
  return out
}

/** Les records d'un exo unilatéral, tenus SÉPARÉMENT par côté (ADR 0010). */
export interface PersonalRecordBySide {
  left: PersonalRecord
  right: PersonalRecord
}

/**
 * Records d'un exo unilatéral dérivés PAR CÔTÉ (ADR 0010) : en salle, chaque bras
 * est sa propre piste — son meilleur e1RM (toutes séries du côté confondues)
 * et sa charge la plus lourde. Distinct du record côté faible que l'analyse
 * conserve (`personalRecord`). Côté sans aucune série réelle -> records nuls.
 * Un exo bilatéral n'a pas à l'appeler (ses séries n'ont pas de côté).
 */
export function personalRecordBySide(
  executions: ExerciseExecution[],
  exerciseId: string,
): PersonalRecordBySide {
  return {
    left: sideRecord(executions, exerciseId, 'left'),
    right: sideRecord(executions, exerciseId, 'right'),
  }
}

/** Record d'UN côté : best e1RM + best charge, toutes séries du côté confondues. */
function sideRecord(
  executions: ExerciseExecution[],
  exerciseId: string,
  side: 'left' | 'right',
): PersonalRecord {
  let bestE1rm: number | null = null
  let bestE1rmSet: WeightReps | null = null
  let bestWeightReps: WeightReps | null = null

  for (const exec of executions) {
    if (exec.exerciseId !== exerciseId || exec.sets.length === 0) continue

    for (const s of exec.sets) {
      if (s.side !== side) continue

      // e1RM : toutes les séries de CE côté comptent (même règle qu'en bilatéral).
      const e1rm = estimateE1rm(s.weightKg, s.reps, s.rir)
      if (bestE1rm === null || e1rm > bestE1rm) {
        bestE1rm = e1rm
        bestE1rmSet = { weightKg: s.weightKg, reps: s.reps }
      }

      // charge : la plus lourde de CE côté.
      const candidate = { weightKg: s.weightKg, reps: s.reps }
      if (bestWeightReps === null || heavier(bestWeightReps, candidate)) {
        bestWeightReps = candidate
      }
    }
  }

  return { bestE1rm, bestE1rmSet, bestWeightReps }
}

/**
 * La série `set` bat-elle le record d'e1RM ? Strict : un record égalé n'est pas
 * un nouveau record. Un record vierge (null) est toujours battu par une série réelle.
 */
export function isE1rmRecord(record: PersonalRecord, set: PerformedSet): boolean {
  const e1rm = estimateE1rm(set.weightKg, set.reps, set.rir)
  return record.bestE1rm === null || e1rm > record.bestE1rm
}

/**
 * La série `set` bat-elle le record de charge (poids×reps) ? Strict : poids
 * strictement supérieur, ou poids égal avec reps strictement supérieures. Un
 * record vierge (null) est toujours battu.
 */
export function isWeightRepsRecord(record: PersonalRecord, set: PerformedSet): boolean {
  if (record.bestWeightReps === null) return true
  return heavier(record.bestWeightReps, { weightKg: set.weightKg, reps: set.reps })
}
