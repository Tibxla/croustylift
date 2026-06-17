import type { ExerciseExecution, PerformedSet } from './types'

export function lastReference(
  executions: ExerciseExecution[],
  exerciseId: string,
): PerformedSet[] | null {
  const real = executions.filter(
    (e) => e.exerciseId === exerciseId && e.sets.length > 0,
  )
  if (real.length === 0) return null
  const last = real.reduce((a, b) => (b.date >= a.date ? b : a))
  return [...last.sets].sort((a, b) => a.order - b.order)
}
