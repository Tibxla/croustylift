import { estimateE1rm } from './e1rm'
import type { ExerciseExecution, E1rmPoint } from './types'

// Courbe SECONDAIRE : la tendance des séries 2+ (order >= 2), subordonnée à la
// courbe primaire (1ʳᵉ série, cf. primary-curve.ts). On résume les séries qui
// SUIVENT la 1ʳᵉ par leur e1RM moyen sur l'exécution : un proxy de « résistance
// à la fatigue / capacité de travail » (les séries de travail tiennent-elles le
// niveau ?). Même forme de sortie que la primaire (E1rmPoint[]), donc lisible
// sur la même échelle et réutilisable par le même pipeline d'affichage.
//
// Une exécution sans aucune série 2+ ne produit pas de point : c'est un trou,
// pas un zéro (miroir du traitement des exécutions vides dans la primaire). Si
// AUCUNE exécution n'a de série 2+, le résultat est [] et l'UI n'affiche rien.
export function buildSecondaryCurve(
  executions: ExerciseExecution[],
  exerciseId: string,
): E1rmPoint[] {
  const points = executions.flatMap((execution) => {
    if (execution.exerciseId !== exerciseId) {
      return []
    }
    const followUpSets = execution.sets.filter((set) => set.order >= 2)
    if (followUpSets.length === 0) {
      return []
    }
    const meanE1rm =
      followUpSets.reduce(
        (sum, set) => sum + estimateE1rm(set.weightKg, set.reps, set.rir),
        0,
      ) / followUpSets.length
    return [{ date: execution.date, e1rm: meanE1rm }]
  })

  // Dates ISO 'YYYY-MM-DD' : l'ordre lexicographique est l'ordre chronologique.
  return points.sort((a, b) => a.date.localeCompare(b.date))
}
