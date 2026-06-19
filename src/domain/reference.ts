import type { ExerciseExecution, PerformedSet } from './types'

export function lastReference(
  executions: ExerciseExecution[],
  exerciseId: string,
): PerformedSet[] | null {
  const real = executions.filter(
    (e) => e.exerciseId === exerciseId && e.sets.length > 0,
  )
  if (real.length === 0) return null
  // Plus récente perf réelle. À `date` égale (reprise après clôture ou 2 séances
  // le même jour — `performed_on` est à la granularité du jour), on départage par
  // `createdAt` : la dernière CRÉÉE gagne. Sans ce tie-break, l'égalité laissait
  // l'ordre du tableau trancher (non garanti côté data), donc le repère « dernière
  // fois » pouvait basculer entre deux chargements.
  const last = real.reduce((a, b) => (isMoreRecent(b, a) ? b : a))
  return [...last.sets].sort((a, b) => a.order - b.order)
}

/**
 * `candidate` est-elle plus récente que `current` ? `date` (jour) départage en
 * premier ; à égalité, `createdAt` (la dernière créée gagne). Le `>=`/`>` garde
 * le comportement « le candidat l'emporte à égalité stricte » du reduce d'origine,
 * mais l'égalité est maintenant tranchée par `createdAt` quand il est présent.
 */
function isMoreRecent(candidate: ExerciseExecution, current: ExerciseExecution): boolean {
  if (candidate.date !== current.date) return candidate.date > current.date
  const candidateCreatedAt = candidate.createdAt ?? ''
  const currentCreatedAt = current.createdAt ?? ''
  return candidateCreatedAt >= currentCreatedAt
}
