// Une pente %/semaine en mots de la triade (DESIGN.md, The Status Triad Rule) :
// en hausse (signal, ▲), stable (blanc cassé, ▬), en baisse (gris, ▼). Le seuil
// de stagnation est celui de `trend.ts` : la synthèse, la ligne d'exo et sa page
// jugent la même pente de la même façon. Purs.
import type { Verdict } from '../../ui/status-tone'
import { trendOf } from './trend'

/** Le verdict d'une pente : seul « en hausse » prend le signal. */
export function rateVerdict(rate: number): Verdict {
  const trend = trendOf(rate)
  return trend === 'up' ? 'up' : trend === 'down' ? 'down' : 'eq'
}

/** Le mot d'une pente, à côté de son signe. */
export const SLOPE_WORD: Record<Verdict, string> = {
  up: 'en hausse',
  eq: 'stable',
  down: 'en baisse',
}
