import { isZeroLoad } from './e1rm'
import { curveValue, firstSeriesWeakSet } from './unilateral'
import type { CurveUnit, ExerciseExecution, E1rmPoint } from './types'

/**
 * L'unité des courbes d'un exo (cf. `CurveUnit`) : 'reps' tant qu'aucune de ses
 * séries n'a été chargée, 'kg' dès qu'une charge apparaît dans son historique.
 * À appeler sur TOUTES les exécutions de l'exo, puis à passer telle quelle aux
 * courbes d'un sous-ensemble (une séance, un bloc) : l'unité ne change pas d'une
 * courbe à l'autre d'un même exo. Sans aucune série, 'kg' (cas général).
 */
export function curveUnit(executions: ExerciseExecution[], exerciseId: string): CurveUnit {
  let seen = false
  for (const execution of executions) {
    if (execution.exerciseId !== exerciseId) continue
    for (const set of execution.sets) {
      if (!isZeroLoad(set.weightKg)) return 'kg'
      seen = true
    }
  }
  return seen ? 'reps' : 'kg'
}

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

/**
 * Courbe PRIMAIRE d'un exo : un point par exécution, la mesure de sa 1ʳᵉ série
 * (e1RM en 'kg', reps effectives en 'reps'). `unit` vient de `curveUnit` sur
 * tout l'historique de l'exo ; par défaut elle se déduit des exécutions passées,
 * ce qui ne vaut que si ce sont toutes celles de l'exo.
 *
 * Sur une courbe en kilos, une exécution dont la 1ʳᵉ série est à 0 kg ne fait
 * pas de point : c'est un trou, pas un zéro (un e1RM nul plongerait la courbe
 * et fausserait la pente).
 */
export function buildPrimaryCurve(
  executions: ExerciseExecution[],
  exerciseId: string,
  unit: CurveUnit = curveUnit(executions, exerciseId),
): E1rmPoint[] {
  const points = executions.flatMap((execution) => {
    if (execution.exerciseId !== exerciseId || execution.sets.length === 0) {
      return []
    }
    // Point de l'exécution : la mesure de la 1ʳᵉ série. Pour un exo unilatéral,
    // c'est le CÔTÉ FAIBLE de cette 1ʳᵉ série (la moindre perf des deux côtés
    // appariés par order) ; pour un bilatéral, la 1ʳᵉ série (cf. unilateral.ts).
    const first = firstSeriesWeakSet(execution.sets)
    const e1rm = first === null ? null : curveValue(first, unit)
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
