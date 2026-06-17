import { estimateE1rm } from './e1rm'

describe('estimateE1rm', () => {
  it('applies adjusted Epley at RIR 0', () => {
    // 100 * (1 + 5/30) = 116.666...
    expect(estimateE1rm(100, 5, 0)).toBeCloseTo(116.6667, 4)
  })

  it('treats RIR as failure-equivalent reps, raising the estimate', () => {
    // 100x5 @ RIR 2 == 7 effective reps: 100 * (1 + 7/30) = 123.333...
    expect(estimateE1rm(100, 5, 2)).toBeCloseTo(123.3333, 4)
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

  it('applies the formula to a single rep at RIR 0 (no special case)', () => {
    // 100 * (1 + 1/30) = 103.333..., slightly above the weight, not equal to it
    expect(estimateE1rm(100, 1, 0)).toBeCloseTo(103.3333, 4)
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
