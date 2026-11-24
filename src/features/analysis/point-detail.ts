// Le détail d'un point de courbe et les faits datés d'un exo (page d'un exo,
// prototype e/analyse-exo.tsx). Purs.
//
// `ExerciseAnalysis` ne porte que des points { date, mesure } : pour lire les
// séries d'un point, la page relit les exécutions de l'exo
// (`loadExerciseExecutions`, la lecture de la comparaison de blocs) et les
// aligne ici sur la courbe par la MÊME construction que le domaine
// (`buildPrimaryCurve` exécution par exécution, ordre `compareCurvePoints`) : le
// i-ème point d'une courbe est la i-ème exécution rendue, sans deviner par date.
import { compareCurvePoints, buildPrimaryCurve } from '../../domain/primary-curve'
import { personalRecord } from '../../domain/pr'
import { curveValue } from '../../domain/unilateral'
import { e1rmEquals, estimateE1rm, effectiveReps } from '../../domain/e1rm'
import type { CurveUnit, E1rmPoint, ExerciseExecution } from '../../domain/types'

/**
 * Les exécutions d'une séance (`seanceId`, `null` = hors séance) qui font un
 * point de sa courbe, dans l'ordre des points.
 */
export function pointExecutions(
  executions: readonly ExerciseExecution[],
  exerciseId: string,
  seanceId: string | null,
  unit: CurveUnit,
): ExerciseExecution[] {
  return executions
    .filter((e) => (e.seanceId ?? null) === seanceId)
    .flatMap((e) => {
      const [point] = buildPrimaryCurve([e], exerciseId, unit)
      return point ? [{ e, seed: { ...point, createdAt: e.createdAt, id: e.id } }] : []
    })
    .sort((a, b) => compareCurvePoints(a.seed, b.seed))
    .map(({ e }) => e)
}

/**
 * L'exécution du point `index` d'une courbe, ou `undefined` si la seconde
 * lecture ne concorde plus avec la courbe affichée. La courbe ne porte pas
 * d'id d'exécution (`E1rmPoint`, couche de données gelée) : on exige donc que
 * les deux lectures aient le même nombre de points ET que l'exécution retenue
 * redonne exactement la date et la mesure du point. Une exécution supprimée,
 * ajoutée ou corrigée sur un autre appareil entre les deux lectures ne fait
 * jamais afficher les séries, le tonnage ni le lien d'une autre séance.
 */
export function pointExecution(
  executions: readonly ExerciseExecution[],
  exerciseId: string,
  seanceId: string | null,
  unit: CurveUnit,
  curve: readonly E1rmPoint[],
  index: number,
): ExerciseExecution | undefined {
  const aligned = pointExecutions(executions, exerciseId, seanceId, unit)
  const point = curve[index]
  const candidate = aligned[index]
  if (aligned.length !== curve.length || !point || !candidate) return undefined
  const [own] = buildPrimaryCurve([candidate], exerciseId, unit)
  return own && own.date === point.date && own.e1rm === point.e1rm ? candidate : undefined
}

/** Le record d'un exo et sa date : meilleure mesure, toutes séries confondues. */
export interface RecordFact {
  /** e1RM, ou reps effectives pour un exo jamais chargé. */
  value: number
  set: { weightKg: number; reps: number; rir: number }
  date: string | null
}

export interface ExerciseFacts {
  record: RecordFact | null
  /** La série la plus lourde (reps en départage), et sa date. */
  heaviest: { weightKg: number; reps: number; date: string | null } | null
}

/** Records d'un exo (glossaire « Record personnel »), datés par la 1ʳᵉ exécution qui les porte. */
export function exerciseFacts(executions: readonly ExerciseExecution[], exerciseId: string, unit: CurveUnit): ExerciseFacts {
  const own = executions.filter((e) => e.exerciseId === exerciseId)
  const pr = personalRecord([...own], exerciseId)
  const dated = [...own].sort((a, b) => a.date.localeCompare(b.date))
  let record: RecordFact | null = null
  const best = pr.bestE1rmSet
  if (pr.bestE1rm !== null && best) {
    const rir = best.rir ?? 0
    const value = unit === 'reps' ? effectiveReps(best.reps, rir) : pr.bestE1rm
    const at = dated.find((e) =>
      e.sets.some((s) => s.weightKg === best.weightKg && s.reps === best.reps && e1rmEquals(estimateE1rm(s.weightKg, s.reps, s.rir), pr.bestE1rm!)),
    )
    record = { value, set: { weightKg: best.weightKg, reps: best.reps, rir }, date: at?.date ?? null }
  }
  const h = pr.bestWeightReps
  const heaviest = h
    ? { ...h, date: dated.find((e) => e.sets.some((s) => s.weightKg === h.weightKg && s.reps === h.reps))?.date ?? null }
    : null
  return { record, heaviest }
}

/** La mesure d'une série dans l'unité de la courbe (e1RM, ou reps effectives). */
export function setMeasure(set: { weightKg: number; reps: number; rir: number }, unit: CurveUnit): number | null {
  return curveValue({ ...set, order: 1 }, unit)
}

/** Écart au-delà duquel deux points ne sont plus reliés : une pause, pas une tendance. */
export const GAP_DAYS = 21
const DAY_MS = 86_400_000

/** Coupe avant le point `i` d'une courbe : plus de `GAP_DAYS` depuis le précédent. */
export function gapBreaks(curve: readonly E1rmPoint[]): boolean[] {
  return curve.map((p, i) => i > 0 && (Date.parse(p.date) - Date.parse(curve[i - 1]!.date)) / DAY_MS > GAP_DAYS)
}

/**
 * Coupe avant le point `i` des séries 2+ : une exécution de la courbe primaire
 * tombe entre lui et le précédent sans point secondaire (pas de série 2+ ce
 * jour-là), ou la pause dépasse `GAP_DAYS`.
 */
export function secondaryBreaks(secondary: readonly E1rmPoint[], primary: readonly E1rmPoint[]): boolean[] {
  const gaps = gapBreaks(secondary)
  return secondary.map((p, i) => {
    if (i === 0) return false
    if (gaps[i]) return true
    const prev = secondary[i - 1]!.date
    const between = primary.filter((q) => q.date > prev && q.date < p.date).length
    return between > 0
  })
}
