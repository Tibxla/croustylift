import {
  e1rmBeats,
  e1rmEquals,
  estimateE1rm,
  comparePerformance,
  effectiveReps,
  isZeroLoad,
} from './e1rm'

describe('estimateE1rm', () => {
  it('applies shifted Epley at RIR 0', () => {
    // 5 reps effectives -> 100 * (1 + 4/30) = 113.333...
    expect(estimateE1rm(100, 5, 0)).toBeCloseTo(113.3333, 4)
  })

  it('treats RIR as failure-equivalent reps, raising the estimate', () => {
    // 100x5 @ RIR 2 == 7 effective reps: 100 * (1 + 6/30) = 120
    expect(estimateE1rm(100, 5, 2)).toBeCloseTo(120, 4)
  })

  it('is identical for the same effective reps, whatever the reps/RIR split', () => {
    // 5 reps @ RIR 2 et 7 reps @ RIR 0 valent tous deux 7 reps effectives.
    expect(estimateE1rm(100, 5, 2)).toBeCloseTo(estimateE1rm(100, 7, 0), 10)
  })

  it('increases with weight, all else equal', () => {
    expect(estimateE1rm(110, 5, 1)).toBeGreaterThan(estimateE1rm(100, 5, 1))
  })

  it('increases with reps, all else equal', () => {
    expect(estimateE1rm(100, 6, 1)).toBeGreaterThan(estimateE1rm(100, 5, 1))
  })

  it('increases with RIR, all else equal', () => {
    expect(estimateE1rm(100, 5, 3)).toBeGreaterThan(estimateE1rm(100, 5, 2))
  })

  it('is anchored: one rep to failure IS the 1RM, no special case needed', () => {
    // Le cas qui a motivé l'ADR 0013 : un maximal réel doit se relire tel quel.
    expect(estimateE1rm(140, 1, 0)).toBeCloseTo(140, 10)
    expect(estimateE1rm(100, 1, 0)).toBeCloseTo(100, 10)
  })

  it('a single rep with reps left in reserve estimates ABOVE the weight', () => {
    // 100x1 @ RIR 1 == 2 reps effectives : 100 * (1 + 1/30) = 103.333...
    expect(estimateE1rm(100, 1, 1)).toBeCloseTo(103.3333, 4)
  })

  it('throws when reps is below 1', () => {
    expect(() => estimateE1rm(100, 0, 0)).toThrow(/reps/)
  })

  it('throws when weightKg is negative', () => {
    expect(() => estimateE1rm(-1, 5, 0)).toThrow(/weight/i)
  })

  it('throws when rir is negative', () => {
    expect(() => estimateE1rm(100, 5, -1)).toThrow(/rir/i)
  })

  it('throws when reps is not an integer', () => {
    // reps is a discrete count; a fractional value signals a caller bug
    expect(() => estimateE1rm(100, 5.5, 0)).toThrow(/reps/)
  })

  it('throws when rir is not an integer', () => {
    expect(() => estimateE1rm(100, 5, 1.5)).toThrow(/rir/i)
  })
})

// Comparaison EXACTE, en entiers : poids en centièmes de kg × (29 + reps + RIR).
// Ni flottant ni arrondi : un arrondi au centième rabattait 36,4166… et 36,425
// sur la même valeur et masquait un vrai record.
describe('comparaison exacte d’e1RM', () => {
  const e = (w: number, reps: number, rir = 0) => estimateE1rm(w, reps, rir)

  it('23,25 × 18 bat 28,75 × 9 (36,425 contre 36,4166…), dépassement réel sous le centième', () => {
    expect(e1rmBeats(e(23.25, 18), e(28.75, 9))).toBe(true)
    expect(e1rmBeats(e(28.75, 9), e(23.25, 18))).toBe(false)
  })

  it('87,5 × 5 et 85 × 6 à RIR 0 sont à égalité, malgré le bruit flottant', () => {
    expect(e(87.5, 5)).not.toBe(e(85, 6))
    expect(e1rmBeats(e(87.5, 5), e(85, 6))).toBe(false)
    expect(e1rmBeats(e(85, 6), e(87.5, 5))).toBe(false)
    expect(e1rmEquals(e(85, 6), e(87.5, 5))).toBe(true)
    // À RIR 2 les deux ne sont plus égales : 85 × 37 contre 87,5 × 36.
    expect(e1rmBeats(e(87.5, 5, 2), e(85, 6, 2))).toBe(true)
  })

  it('égalité exacte sur la frontière du demi-centième (5,775 kg des deux côtés)', () => {
    // 5,25 × 4 et 4,95 × 6 : 525 × 33 = 495 × 35 = 17 325.
    expect(e1rmBeats(e(5.25, 4), e(4.95, 6))).toBe(false)
    expect(e1rmBeats(e(4.95, 6), e(5.25, 4))).toBe(false)
    expect(e1rmEquals(e(5.25, 4), e(4.95, 6))).toBe(true)
  })

  it('un centième de charge en plus suffit à battre', () => {
    expect(e1rmBeats(e(100.01, 1), e(100, 1))).toBe(true)
    expect(e1rmEquals(e(100.01, 1), e(100, 1))).toBe(false)
  })
})

// Exo au poids du corps saisi à 0 kg : l'e1RM est nul quelle que soit la perf.
// La règle d'ordre (ADR 0013, amendement du 2026-11-23) juge alors aux reps
// effectives, sans jamais comparer des reps à des kilos.
describe('comparePerformance', () => {
  const p = (weightKg: number, reps: number, rir = 0) => ({ weightKg, reps, rir })

  it('à 0 kg des deux côtés, les reps effectives jugent', () => {
    expect(comparePerformance(p(0, 11), p(0, 8))).toBeGreaterThan(0)
    expect(comparePerformance(p(0, 9), p(0, 12))).toBeLessThan(0)
    expect(comparePerformance(p(0, 10), p(0, 10))).toBe(0)
  })

  it('à 0 kg le RIR compte 1 pour 1, comme dans l’e1RM', () => {
    expect(comparePerformance(p(0, 10, 2), p(0, 12, 0))).toBe(0)
    expect(comparePerformance(p(0, 10, 2), p(0, 11, 0))).toBeGreaterThan(0)
  })

  it('une série chargée passe devant toute série à 0 kg, quelles que soient les reps', () => {
    expect(comparePerformance(p(2.5, 1), p(0, 30))).toBeGreaterThan(0)
    expect(comparePerformance(p(0, 30), p(2.5, 1))).toBeLessThan(0)
  })

  it('deux séries chargées se jugent à l’e1RM exact, jamais aux reps', () => {
    // 87,5 × 5 et 85 × 6 : même e1RM, reps différentes -> égalité.
    expect(comparePerformance(p(87.5, 5), p(85, 6))).toBe(0)
    expect(comparePerformance(p(100, 6, 1), p(100, 5, 1))).toBeGreaterThan(0)
  })

  it('l’ordre est transitif à travers la frontière charge nulle / chargé', () => {
    const sorted = [p(5, 3), p(0, 8), p(0, 12), p(2.5, 1), p(0, 10, 2)].sort(comparePerformance)
    expect(sorted.map((s) => `${s.weightKg}x${s.reps}+${s.rir}`)).toEqual([
      '0x8+0',
      '0x12+0',
      '0x10+2',
      '2.5x1+0',
      '5x3+0',
    ])
  })

  it('la charge nulle se lit au centième de kg', () => {
    expect(isZeroLoad(0)).toBe(true)
    expect(isZeroLoad(0.004)).toBe(true)
    expect(isZeroLoad(0.01)).toBe(false)
    expect(effectiveReps(10, 2)).toBe(12)
  })
})
