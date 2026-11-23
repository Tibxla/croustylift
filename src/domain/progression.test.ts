import { describe, it, expect } from 'vitest'
import type { E1rmPoint } from './types'
import { roundRate, weeklyProgressionRate } from './progression'

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

  it('renvoie null pour trois points sur deux dates (reprise le même jour puis lendemain)', () => {
    // Une pente par semaine ne se lit pas sur 24 h : sans cette garde, ce jeu
    // affichait « +13,9 %/sem ».
    const points: E1rmPoint[] = [
      { date: '2026-09-01', e1rm: 100 },
      { date: '2026-09-01', e1rm: 100 },
      { date: '2026-09-02', e1rm: 102 },
    ]
    expect(weeklyProgressionRate(points)).toBeNull()
  })

  it('mesure une pente dès trois dates distinctes, même avec un doublon de date', () => {
    const points: E1rmPoint[] = [
      { date: '2026-09-01', e1rm: 100 },
      { date: '2026-09-01', e1rm: 100 },
      { date: '2026-09-08', e1rm: 102 },
      { date: '2026-09-15', e1rm: 104 },
    ]
    expect(weeklyProgressionRate(points)).not.toBeNull()
  })
})

describe('roundRate', () => {
  it('arrondit à 0,1 point, comme l’affichage', () => {
    expect(roundRate(2.26)).toBe(2.3)
    expect(roundRate(2.24)).toBe(2.2)
    expect(roundRate(-1.04)).toBe(-1)
  })

  it('ramène un zéro négatif à zéro (jamais de « −0,0 »)', () => {
    expect(Object.is(roundRate(-0.04), 0)).toBe(true)
  })
})

// Exo jamais chargé (ADR 0013, amendement du 2026-11-23) : la pente d'une courbe
// en reps se mesure sur `29 + reps effectives`, soit l'e1RM à poids du corps constant.
describe('weeklyProgressionRate sur une courbe en reps', () => {
  const reps = [
    { date: '2026-01-01', e1rm: 10 },
    { date: '2026-01-08', e1rm: 11 },
    { date: '2026-01-15', e1rm: 12 },
  ]

  it('vaut la pente e1RM des mêmes séries à charge constante, quelle que soit la charge', () => {
    const rate = weeklyProgressionRate(reps, 3, 'reps')!
    for (const bodyweight of [60, 85]) {
      const loaded = reps.map((p) => ({ date: p.date, e1rm: (bodyweight * (29 + p.e1rm)) / 30 }))
      expect(rate).toBeCloseTo(weeklyProgressionRate(loaded)!, 9)
    }
    // Une rep de plus par semaine autour de 11 reps : 1 / 40 = +2,5 %/sem.
    expect(rate).toBeCloseTo(2.5, 9)
  })

  it('n’est pas le pourcentage brut de reps (qui triplerait le chiffre)', () => {
    expect(weeklyProgressionRate(reps)!).toBeCloseTo(100 / 11, 9)
  })

  it('reps stables : stagnation, sous le seuil de 0,5 %/sem', () => {
    const flat = reps.map((p) => ({ ...p, e1rm: 12 }))
    expect(weeklyProgressionRate(flat, 3, 'reps')).toBe(0)
  })
})

