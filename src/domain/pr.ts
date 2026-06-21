// Records personnels (PR) dérivés de l'historique d'un exo (issue #34).
//
// Deux records, deux mesures :
//   - bestE1rm       : le meilleur 1RM estimé (RIR-ajusté Epley, cf. e1rm.ts),
//                      pris sur la 1ʳᵉ série de chaque exécution (la série de
//                      référence, faite à plein potentiel avant la fatigue).
//   - bestWeightReps : le record de CHARGE — la série la plus lourde jamais
//                      faite (toutes séries confondues), les reps départageant
//                      à poids égal.
//
// Tout est DÉRIVÉ de l'historique, jamais stocké : un PR se recalcule depuis les
// exécutions. Style aligné sur reference.ts (fonctions pures, ExerciseExecution[]).
import type { ExerciseExecution, PerformedSet } from './types'
import { estimateE1rm } from './e1rm'
import { weakSideE1rm } from './unilateral'

/** Une charge réalisée : poids et reps (le couple d'un record poids×reps). */
export interface WeightReps {
  weightKg: number
  reps: number
}

/** Les records d'un exo. `null` = aucun historique réel (premier passage). */
export interface PersonalRecord {
  /** Meilleur e1RM (1ʳᵉ série de chaque exécution), ou null si aucune perf. */
  bestE1rm: number | null
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
  let bestWeightReps: WeightReps | null = null

  for (const exec of executions) {
    if (exec.exerciseId !== exerciseId || exec.sets.length === 0) continue

    // e1RM : seule la 1ʳᵉ série compte (la plus représentative du potentiel).
    // Pour un exo UNILATÉRAL, c'est le CÔTÉ FAIBLE de cette 1ʳᵉ série (e1RM min
    // des deux côtés G/D appariés par order), cohérent avec la courbe primaire et
    // l'ADR 0005 — pas le 1er élément du tableau, qui serait souvent le côté fort
    // (G et D partageant le même order, un reduce sur l'order ne les départage pas).
    // Pour un bilatéral (1 ligne par série), weakSideE1rm retombe sur l'e1RM simple
    // de la 1ʳᵉ série : comportement inchangé.
    const e1rm = weakSideE1rm(exec.sets)
    if (e1rm !== null && (bestE1rm === null || e1rm > bestE1rm)) bestE1rm = e1rm

    // poids×reps : la charge max sur l'ensemble des séries.
    for (const s of exec.sets) {
      const candidate = { weightKg: s.weightKg, reps: s.reps }
      if (bestWeightReps === null || heavier(bestWeightReps, candidate)) {
        bestWeightReps = candidate
      }
    }
  }

  return { bestE1rm, bestWeightReps }
}

/** Les records d'un exo unilatéral, tenus SÉPARÉMENT par côté (ADR 0010). */
export interface PersonalRecordBySide {
  left: PersonalRecord
  right: PersonalRecord
}

/**
 * Records d'un exo unilatéral dérivés PAR CÔTÉ (ADR 0010) : en salle, chaque bras
 * est sa propre piste — son meilleur e1RM (1ʳᵉ série du côté à chaque exécution)
 * et sa charge la plus lourde. Distinct du record côté faible que l'analyse
 * conserve (`personalRecord` + `weakSideE1rm`). Côté sans aucune série réelle ->
 * records nuls. Un exo bilatéral n'a pas à l'appeler (ses séries n'ont pas de côté).
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

/** Record d'UN côté : best e1RM (1ʳᵉ série du côté) + best charge (toutes séries du côté). */
function sideRecord(
  executions: ExerciseExecution[],
  exerciseId: string,
  side: 'left' | 'right',
): PersonalRecord {
  let bestE1rm: number | null = null
  let bestWeightReps: WeightReps | null = null

  for (const exec of executions) {
    if (exec.exerciseId !== exerciseId || exec.sets.length === 0) continue
    const sideSets = exec.sets.filter((s) => s.side === side)
    if (sideSets.length === 0) continue

    // e1RM : la 1ʳᵉ série de CE côté (plus petit `order`), la plus représentative.
    const firstOrder = Math.min(...sideSets.map((s) => s.order))
    const first = sideSets.find((s) => s.order === firstOrder)
    if (first) {
      const e1rm = estimateE1rm(first.weightKg, first.reps, first.rir)
      if (bestE1rm === null || e1rm > bestE1rm) bestE1rm = e1rm
    }

    // charge : la plus lourde de CE côté, toutes séries du côté confondues.
    for (const s of sideSets) {
      const candidate = { weightKg: s.weightKg, reps: s.reps }
      if (bestWeightReps === null || heavier(bestWeightReps, candidate)) {
        bestWeightReps = candidate
      }
    }
  }

  return { bestE1rm, bestWeightReps }
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
