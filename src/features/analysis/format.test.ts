import { describe, expect, it } from 'vitest'
import { formatCount, formatRate } from './format'

// Chiffres de l'Analyse en français : virgule décimale, vrai signe moins
// (U+2212), jamais de point ni de trait d'union.
describe('formatRate', () => {
  it('une hausse porte un plus et une virgule', () => {
    expect(formatRate(3.21)).toBe('+3,2')
  })

  it('une baisse porte le signe moins typographique, pas un trait d’union', () => {
    expect(formatRate(-1.04)).toBe('\u22121,0')
    expect(formatRate(-1.04)).not.toContain('-')
  })

  it('zéro n’a pas de signe, y compris un presque zéro négatif', () => {
    expect(formatRate(0)).toBe('0,0')
    expect(formatRate(-0.04)).toBe('0,0')
    expect(formatRate(0.04)).toBe('0,0')
  })

  it('arrondit comme le verdict de comparaison (0,1 point)', () => {
    expect(formatRate(2.26)).toBe('+2,3')
    expect(formatRate(2.34)).toBe('+2,3')
    expect(formatRate(2.24)).toBe('+2,2')
  })
})

describe('formatCount', () => {
  it('une décimale et une virgule, un entier sans décimale, comme la fin de séance', () => {
    expect(formatCount(5.8)).toBe('5,8')
    expect(formatCount(6)).toBe('6')
    expect(formatCount(5.96)).toBe('6')
  })
})
