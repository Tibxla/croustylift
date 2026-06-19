import { describe, it, expect } from 'vitest'
import type { E1rmPoint } from './types'
import { weeklyProgressionRate } from './progression'

describe('weeklyProgressionRate', () => {
  it('renvoie null en deçà de minPoints points (défaut 3)', () => {
    const points: E1rmPoint[] = [
      { date: '2026-01-01', e1rm: 100 },
      { date: '2026-01-08', e1rm: 102 },
    ]
    expect(weeklyProgressionRate(points)).toBeNull()
  })

  it('renvoie un taux positif pour une tendance croissante', () => {
    const points: E1rmPoint[] = [
      { date: '2026-01-01', e1rm: 100 },
      { date: '2026-01-08', e1rm: 102 },
      { date: '2026-01-15', e1rm: 104 },
    ]
    const rate = weeklyProgressionRate(points)
    expect(rate).not.toBeNull()
    expect(rate!).toBeGreaterThan(0)
  })

  it('renvoie ~0 pour une série plate', () => {
    const points: E1rmPoint[] = [
      { date: '2026-01-01', e1rm: 100 },
      { date: '2026-01-08', e1rm: 100 },
      { date: '2026-01-15', e1rm: 100 },
      { date: '2026-01-22', e1rm: 100 },
    ]
    expect(weeklyProgressionRate(points)!).toBeCloseTo(0, 10)
  })

  it('renvoie un taux négatif pour une tendance décroissante', () => {
    const points: E1rmPoint[] = [
      { date: '2026-01-01', e1rm: 104 },
      { date: '2026-01-08', e1rm: 102 },
      { date: '2026-01-15', e1rm: 100 },
    ]
    expect(weeklyProgressionRate(points)!).toBeLessThan(0)
  })

  it("est invariant d'échelle : ×k (k>0) ne change pas le %/semaine", () => {
    const base: E1rmPoint[] = [
      { date: '2026-01-01', e1rm: 100 },
      { date: '2026-01-08', e1rm: 103 },
      { date: '2026-01-15', e1rm: 105 },
      { date: '2026-01-22', e1rm: 109 },
    ]
    const k = 2.5
    const scaled: E1rmPoint[] = base.map((p) => ({ ...p, e1rm: p.e1rm * k }))
    expect(weeklyProgressionRate(scaled)!).toBeCloseTo(weeklyProgressionRate(base)!, 10)
  })

  it('trie une entrée désordonnée : même résultat que triée', () => {
    const sorted: E1rmPoint[] = [
      { date: '2026-01-01', e1rm: 100 },
      { date: '2026-01-08', e1rm: 103 },
      { date: '2026-01-15', e1rm: 105 },
      { date: '2026-01-22', e1rm: 109 },
    ]
    const shuffled: E1rmPoint[] = [sorted[2]!, sorted[0]!, sorted[3]!, sorted[1]!]
    expect(weeklyProgressionRate(shuffled)!).toBeCloseTo(weeklyProgressionRate(sorted)!, 10)
  })

  it('renvoie null si tous les points sont à la même date (timespan 0, pente indéfinie)', () => {
    const points: E1rmPoint[] = [
      { date: '2026-01-01', e1rm: 100 },
      { date: '2026-01-01', e1rm: 105 },
      { date: '2026-01-01', e1rm: 110 },
    ]
    expect(weeklyProgressionRate(points)).toBeNull()
  })

  it('renvoie null si tous les e1RM sont nuls (base 0, taux relatif indéfini)', () => {
    const points: E1rmPoint[] = [
      { date: '2026-01-01', e1rm: 0 },
      { date: '2026-01-08', e1rm: 0 },
      { date: '2026-01-15', e1rm: 0 },
    ]
    expect(weeklyProgressionRate(points)).toBeNull()
  })
})
