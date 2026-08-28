import { estimateE1rm } from './e1rm'

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
