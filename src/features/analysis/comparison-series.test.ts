import { describe, it, expect } from 'vitest'
import type { E1rmPoint } from '../../domain/types'
import { toWeeklySeries, weekLabel } from './comparison-series'

describe('toWeeklySeries', () => {
  it('met le premier point à la semaine 0', () => {
    const curve: E1rmPoint[] = [
      { date: '2026-01-01', e1rm: 100 },
      { date: '2026-01-08', e1rm: 102 },
    ]
    const series = toWeeklySeries(curve)
    expect(series[0]!.week).toBe(0)
    expect(series[0]!.e1rm).toBe(100)
  })

  it('convertit l\'écart de dates en semaines (7 jours = 1 semaine)', () => {
    const curve: E1rmPoint[] = [
      { date: '2026-01-01', e1rm: 100 },
      { date: '2026-01-08', e1rm: 102 }, // +7 jours
      { date: '2026-01-22', e1rm: 106 }, // +21 jours
    ]
    const series = toWeeklySeries(curve)
    expect(series[1]!.week).toBeCloseTo(1, 10)
    expect(series[2]!.week).toBeCloseTo(3, 10)
  })

  it('normalise depuis le point le plus ancien même si l\'entrée est désordonnée', () => {
    const curve: E1rmPoint[] = [
      { date: '2026-01-15', e1rm: 104 },
      { date: '2026-01-01', e1rm: 100 },
      { date: '2026-01-08', e1rm: 102 },
    ]
    const series = toWeeklySeries(curve)
    expect(series.map((p) => p.week)).toEqual([0, 1, 2])
    expect(series[0]!.e1rm).toBe(100)
  })

  it('renvoie [] pour une courbe vide', () => {
    expect(toWeeklySeries([])).toEqual([])
  })
})

describe('weekLabel', () => {
  it('la première semaine est S1 (jamais S0)', () => {
    expect(weekLabel(0)).toBe('S1')
  })

  it('tronque au lieu d’arrondir : le jour 4 du bloc est encore en S1', () => {
    const [, day4, day10] = toWeeklySeries([
      { date: '2026-09-01', e1rm: 100 },
      { date: '2026-09-05', e1rm: 100 },
      { date: '2026-09-11', e1rm: 100 },
    ])
    expect(weekLabel(day4!.week)).toBe('S1')
    expect(weekLabel(day10!.week)).toBe('S2')
  })

  it('une semaine pleine écoulée ouvre la suivante', () => {
    expect(weekLabel(1)).toBe('S2')
    expect(weekLabel(2)).toBe('S3')
  })
})
