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
 * `candidate` est-elle plus récente que `current` ? Départage en cascade :
 *   1. `date` (jour) — l'ordre lexicographique ISO est chronologique ;
 *   2. à `date` égale, `createdAt` (la dernière créée gagne) ;
 *   3. à `createdAt` aussi égal (timestamps tronqués, import groupé, horloge
 *      imprécise, ou tout simplement absent), l'`id` (UUID stable, cf. ADR 0003).
 * Sans l'étape 3, l'égalité retombait sur l'ordre du tableau — non garanti côté
 * data — donc le repère « dernière fois » pouvait basculer entre deux chargements.
 * Le `>=` final garde le « le candidat l'emporte à égalité stricte » du reduce
 * d'origine : il ne se déclenche que quand date, createdAt ET id sont identiques
 * (deux objets indiscernables : le choix est alors sans conséquence).
 */
function isMoreRecent(candidate: ExerciseExecution, current: ExerciseExecution): boolean {
  if (candidate.date !== current.date) return candidate.date > current.date
  const candidateCreatedAt = candidate.createdAt ?? ''
  const currentCreatedAt = current.createdAt ?? ''
  if (candidateCreatedAt !== currentCreatedAt) return candidateCreatedAt > currentCreatedAt
  return (candidate.id ?? '') >= (current.id ?? '')
}
