import { weakSideE1rm } from './unilateral'
import type { ExerciseExecution, E1rmPoint } from './types'

/**
 * Un point de courbe en cours de construction : un `E1rmPoint` plus les clés de
 * départage de son exécution (`createdAt`, `id`). Interne aux modules de courbe :
 * ces clés servent au TRI puis sont jetées (le point final reste `E1rmPoint`).
 */
export interface CurvePointSeed extends E1rmPoint {
  createdAt?: string
  id?: string
}

/**
 * Ordonne deux points de courbe de façon STABLE, comme `isMoreRecent` côté
 * `reference.ts`, en cascade :
 *   1. `date` (jour) — l'ordre lexicographique ISO 'YYYY-MM-DD' est chronologique ;
 *   2. à `date` égale (reprise après clôture / 2 séances le même jour), `createdAt` ;
 *   3. à `createdAt` aussi égal (tronqué, import groupé, absent), l'`id` (UUID
 *      stable, cf. ADR 0003).
 * La PENTE d'une régression est invariante à l'ordre : ce tri ne corrige aucune
 * VALEUR, il fige l'ordre D'AFFICHAGE des points à date égale (sans lui, l'ordre
 * du tableau d'entrée — non garanti côté data — décidait).
 */
export function compareCurvePoints(a: CurvePointSeed, b: CurvePointSeed): number {
  if (a.date !== b.date) return a.date.localeCompare(b.date)
  const byCreatedAt = (a.createdAt ?? '').localeCompare(b.createdAt ?? '')
  if (byCreatedAt !== 0) return byCreatedAt
  return (a.id ?? '').localeCompare(b.id ?? '')
}

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
    // On garde `createdAt`/`id` le temps du tri (cf. compareCurvePoints) pour
    // départager deux exécutions le même jour de façon STABLE, puis on les jette :
    // `E1rmPoint` reste `{ date, e1rm }` pour l'UI.
    return [{ date: execution.date, e1rm, createdAt: execution.createdAt, id: execution.id }]
  })

  return points
    .sort(compareCurvePoints)
    .map(({ date, e1rm }) => ({ date, e1rm }))
}
