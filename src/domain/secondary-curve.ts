import { estimateE1rm } from './e1rm'
import { pairSidesByOrder } from './unilateral'
import type { ExerciseExecution, E1rmPoint, PerformedSet } from './types'

// Courbe SECONDAIRE : la tendance des séries 2+ (order >= 2), subordonnée à la
// courbe primaire (1ʳᵉ série, cf. primary-curve.ts). On résume les séries qui
// SUIVENT la 1ʳᵉ par leur e1RM moyen sur l'exécution : un proxy de « résistance
// à la fatigue / capacité de travail » (les séries de travail tiennent-elles le
// niveau ?). Même forme de sortie que la primaire (E1rmPoint[]), donc lisible
// sur la même échelle et réutilisable par le même pipeline d'affichage.
//
// Pour un exo UNILATÉRAL, chaque série 2+ vaut son CÔTÉ FAIBLE (e1RM min des deux
// côtés G/D appariés par order), cohérent avec la primaire et l'ADR 0005 qui
// écarte explicitement l'e1RM moyen des deux côtés (il noierait le déséquilibre).
// On moyenne donc le côté faible des séries d'order >= 2, pas leurs e1RM bruts.
// Pour un bilatéral (1 ligne par série), on moyenne directement les e1RM des
// séries 2+ : comportement inchangé.
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
    const followUpE1rms = followUpSetE1rms(execution.sets)
    if (followUpE1rms.length === 0) {
      return []
    }
    const meanE1rm =
      followUpE1rms.reduce((sum, e1rm) => sum + e1rm, 0) / followUpE1rms.length
    return [{ date: execution.date, e1rm: meanE1rm }]
  })

  // Dates ISO 'YYYY-MM-DD' : l'ordre lexicographique est l'ordre chronologique.
  return points.sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * Les e1RM des séries 2+ (order >= 2) d'une exécution, une valeur par série :
 *   - UNILATÉRAL : le CÔTÉ FAIBLE de chaque paire G/D d'order >= 2 (e1RM min des
 *     deux côtés). Un côté manquant (saisie incomplète) tombe sur le côté présent.
 *   - BILATÉRAL (séries sans `side`) : l'e1RM brut de chaque série d'order >= 2.
 */
function followUpSetE1rms(sets: PerformedSet[]): number[] {
  const isUnilateral = sets.some((s) => s.side !== undefined)
  if (!isUnilateral) {
    return sets
      .filter((set) => set.order >= 2)
      .map((set) => estimateE1rm(set.weightKg, set.reps, set.rir))
  }

  return pairSidesByOrder(sets)
    .filter((pair) => pair.order >= 2)
    .map((pair) => {
      const left = pair.left
        ? estimateE1rm(pair.left.weightKg, pair.left.reps, pair.left.rir)
        : null
      const right = pair.right
        ? estimateE1rm(pair.right.weightKg, pair.right.reps, pair.right.rir)
        : null
      if (left !== null && right !== null) return Math.min(left, right)
      // Un côté manquant : on retombe sur le côté présent (au moins un l'est, la
      // paire n'existe que si une ligne au moins l'a créée).
      return (left ?? right) as number
    })
}
