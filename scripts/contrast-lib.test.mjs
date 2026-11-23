import { describe, expect, it } from 'vitest'
import {
  contrastRatio,
  luminance,
  oklchToLinearSrgb,
  parseOklchTokens,
  tokenContrast,
} from './contrast-lib.mjs'

describe('contraste OKLCH', () => {
  it('blanc et noir aux bornes', () => {
    expect(luminance(oklchToLinearSrgb(1, 0, 0))).toBeCloseTo(1, 3)
    expect(luminance(oklchToLinearSrgb(0, 0, 0))).toBeCloseTo(0, 6)
    expect(tokenContrast([1, 0, 0], [0, 0, 0])).toBeCloseTo(21, 1)
  })

  it('une couleur connue : oklch(0.628 0.2577 29.23) est le rouge sRGB pur', () => {
    const [r, g, b] = oklchToLinearSrgb(0.628, 0.2577, 29.23)
    expect(r).toBeCloseTo(1, 2)
    expect(g).toBeCloseTo(0, 2)
    expect(b).toBeCloseTo(0, 2)
  })

  it('gris moyen #777 sur blanc : 4,48:1, juste sous AA', () => {
    // #777777 = oklch(0.5693 0 0)
    expect(tokenContrast([0.5693, 0, 0], [1, 0, 0])).toBeCloseTo(4.48, 1)
  })

  it('le rapport est symétrique', () => {
    expect(contrastRatio(0.2, 0.8)).toBe(contrastRatio(0.8, 0.2))
  })
})

describe('parseOklchTokens', () => {
  it('lit les tokens opaques et ignore les autres', () => {
    const css = `
      --color-bg: oklch(0.145 0.012 286);         /* fond */
      --color-ink: oklch(97.5% 0.004 286);
      --color-hair: rgba(255, 255, 255, 0.075);
      --color-accent-soft: color-mix(in oklab, var(--color-accent), transparent 86%);
      --accent-glow: oklch(0.62 0.19 286 / 0.5);
    `
    expect(parseOklchTokens(css)).toEqual({
      bg: [0.145, 0.012, 286],
      ink: [0.975, 0.004, 286],
    })
  })
})
