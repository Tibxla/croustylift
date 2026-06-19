import { weakSideE1rm } from './unilateral'
import type { ExerciseExecution, E1rmPoint } from './types'

export function buildPrimaryCurve(
  executions: ExerciseExecution[],
  exerciseId: string,
): E1rmPoint[] {
  const points = executions.flatMap((execution) => {
    if (execution.exerciseId !== exerciseId || execution.sets.length === 0) {
      return []
    }
    // Point de l'exécution : l'e1RM de la 1ʳᵉ série. Pour un exo unilatéral, c'est
    // le CÔTÉ FAIBLE de cette 1ʳᵉ série (e1RM min des deux côtés appariés par
    // order) ; pour un bilatéral, l'e1RM simple de la 1ʳᵉ série (cf. unilateral.ts).
    const e1rm = weakSideE1rm(execution.sets)
    if (e1rm === null) return []
    return [{ date: execution.date, e1rm }]
  })

  // Dates ISO 'YYYY-MM-DD' : l'ordre lexicographique est l'ordre chronologique.
  return points.sort((a, b) => a.date.localeCompare(b.date))
}
