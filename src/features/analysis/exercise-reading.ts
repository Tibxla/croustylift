// Ce que l'index de l'Analyse lit de chaque exo, et la synthèse du haut. Purs.
//
// La courbe qui porte la lecture d'un exo est la séance la plus récemment
// exécutée parmi ses courbes AFFICHÉES (les masquées le restent d'un écran à
// l'autre) : la ligne de l'index, la synthèse et la page de l'exo lisent donc la
// même pente, celle du bloc en cours (`SeanceCurve.weeklyRate`).
//
// La synthèse ne porte que sur la ROUTINE COURANTE (demande du 2026-11-24) : les
// exos de son plan (`loadPlanExerciseOrder`). Un exo hors plan (ancienne
// routine, ajout ponctuel) n'y compte pas ; il reste lisible plus bas.
import type { Verdict } from '../../ui/status-tone'
import type { ExerciseAnalysis, RatePeriod, SeanceCurve } from './data'
import { visibleCurves } from './curve-visibility'
import { rateVerdict } from './slope-words'

/** La courbe qui porte la lecture, ou `null` (exo sans courbe, cas limite à 0 kg). */
export function leadCurve(analysis: ExerciseAnalysis, hidden: ReadonlySet<string>): SeanceCurve | null {
  return visibleCurves(analysis.seanceCurves, hidden)[0] ?? null
}

export interface RoutineSummary {
  /** Exos du plan jugés sur une pente, par verdict. */
  counts: Record<Verdict, number>
  /** Exos du plan faits dans le bloc, mais trop peu pour une pente (noms, ordre du plan). */
  thin: string[]
  /** Exos du plan pas faits dans le bloc en cours, jamais faits compris. */
  notYet: number
  /** La période des pentes (le bloc en cours), lue sur la première courbe. */
  period: RatePeriod | null
}

/**
 * La synthèse de la routine courante. `plan` : les exos de son plan, dans
 * l'ordre ; `leadOf` : la courbe qui porte la lecture d'un exo (cf. `leadCurve`).
 */
export function summarizeRoutine(
  analyses: readonly ExerciseAnalysis[],
  plan: readonly string[],
  leadOf: (a: ExerciseAnalysis) => SeanceCurve | null,
): RoutineSummary {
  const planIds = new Set(plan)
  const counts: Record<Verdict, number> = { up: 0, eq: 0, down: 0 }
  const thin: string[] = []
  let notYet = 0
  let period: RatePeriod | null = null
  const seen = new Set<string>()
  for (const analysis of analyses) {
    if (!planIds.has(analysis.exerciseId)) continue
    seen.add(analysis.exerciseId)
    const lead = leadOf(analysis)
    if (lead && !period) period = lead.ratePeriod
    if (!lead || lead.ratePeriod.sessions === 0) notYet += 1
    else if (lead.weeklyRate === null) thin.push(analysis.name)
    else counts[rateVerdict(lead.weeklyRate)] += 1
  }
  for (const id of planIds) if (!seen.has(id)) notYet += 1
  return { counts, thin, notYet, period }
}
