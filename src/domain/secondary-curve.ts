import { curveValue, pairSidesByOrder, weakerSide } from './unilateral'
import { compareCurvePoints, curveUnit } from './primary-curve'
import type { CurveUnit, ExerciseExecution, E1rmPoint, PerformedSet } from './types'

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
//
// UNITÉ (cf. `CurveUnit`) : la même que la primaire, décidée sur tout l'exo. En
// 'reps' on moyenne les reps effectives ; en 'kg' une série à 0 kg est un trou
// (elle ne tire pas la moyenne vers zéro).
export function buildSecondaryCurve(
  executions: ExerciseExecution[],
  exerciseId: string,
  unit: CurveUnit = curveUnit(executions, exerciseId),
): E1rmPoint[] {
  const points = executions.flatMap((execution) => {
    if (execution.exerciseId !== exerciseId) {
      return []
    }
    const followUps = followUpSetValues(execution.sets, unit)
    if (followUps.length === 0) {
      return []
    }
    const mean = followUps.reduce((sum, value) => sum + value, 0) / followUps.length
    // On garde `createdAt`/`id` le temps du tri (cf. compareCurvePoints) pour
    // départager deux exécutions le même jour de façon STABLE, comme la primaire,
    // puis on les jette : `E1rmPoint` reste `{ date, e1rm }` pour l'UI.
    return [{ date: execution.date, e1rm: mean, createdAt: execution.createdAt, id: execution.id }]
  })

  return points
    .sort(compareCurvePoints)
    .map(({ date, e1rm }) => ({ date, e1rm }))
}

/**
 * La mesure des séries 2+ (order >= 2) d'une exécution, une valeur par série :
 *   - UNILATÉRAL : le CÔTÉ FAIBLE de chaque paire G/D d'order >= 2 (la moindre
 *     perf des deux côtés). Un côté manquant (saisie incomplète) tombe sur le
 *     côté présent.
 *   - BILATÉRAL (séries sans `side`) : chaque série d'order >= 2.
 * Les séries sans mesure dans l'unité (0 kg sur une courbe en kilos) sont omises.
 */
function followUpSetValues(sets: PerformedSet[], unit: CurveUnit): number[] {
  const isUnilateral = sets.some((s) => s.side !== undefined)
  const followUps = isUnilateral
    ? pairSidesByOrder(sets)
        .filter((pair) => pair.order >= 2)
        .flatMap((pair) => weakerSide(pair) ?? [])
    : sets.filter((set) => set.order >= 2)
  return followUps.flatMap((set) => curveValue(set, unit) ?? [])
}
