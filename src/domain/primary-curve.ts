import { estimateE1rm } from './e1rm'
import type { ExerciseExecution, E1rmPoint } from './types'

export function buildPrimaryCurve(
  executions: ExerciseExecution[],
  exerciseId: string,
): E1rmPoint[] {
  const points = executions.flatMap((execution) => {
    if (execution.exerciseId !== exerciseId || execution.sets.length === 0) {
      return []
    }
    const firstSet = execution.sets.reduce((earliest, set) =>
      set.order < earliest.order ? set : earliest,
    )
    return [
      {
        date: execution.date,
        e1rm: estimateE1rm(firstSet.weightKg, firstSet.reps, firstSet.rir),
      },
    ]
  })

  // Dates ISO 'YYYY-MM-DD' : l'ordre lexicographique est l'ordre chronologique.
  return points.sort((a, b) => a.date.localeCompare(b.date))
}
