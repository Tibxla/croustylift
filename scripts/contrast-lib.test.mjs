import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  contrastRatio,
  hexContrast,
  luminance,
  oklchToLinearSrgb,
  parseHexTokens,
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

describe('contraste hexadécimal', () => {
  it('blanc sur noir : 21:1, #777 sur blanc : 4,48:1', () => {
    expect(hexContrast('#ffffff', '#000000')).toBeCloseTo(21, 1)
    expect(hexContrast('#777777', '#ffffff')).toBeCloseTo(4.48, 1)
  })

  it('lit les tokens #rrggbb, garde la première déclaration, ignore le reste', () => {
    const css = `
      --color-bg: #100E0C;        /* fond */
      --color-ink: #f4f0e7;
      --color-sig: var(--sig);
      --color-court: #fff;
      --color-hair: rgba(255, 255, 255, 0.075);
      --color-bg: #000000;        /* alias plus bas : ignoré */
    `
    expect(parseHexTokens(css)).toEqual({ bg: '#100e0c', ink: '#f4f0e7' })
  })
})

// Garde CI du critère AA (registre U1) : les encres de texte de E tiennent 4,5:1
// sur tous les fonds où du texte se pose, et chaque signal prédéfini aussi.
describe('tokens de src/index.css', () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
  const tokens = parseHexTokens(read('../src/index.css'))
  const presets = JSON.parse(read('../src/settings/signal-presets.json'))

  it.each(['ink', 'muted', 'faint'].flatMap((ink) => ['bg', 'raise'].map((bg) => [ink, bg])))(
    '%s sur %s : 4,5:1 au moins',
    (ink, bg) => {
      expect(hexContrast(tokens[ink], tokens[bg])).toBeGreaterThanOrEqual(4.5)
    },
  )

  it('bouton principal : libellé et ligne secondaire lisibles sur le blanc cassé', () => {
    expect(hexContrast(tokens.bg, tokens.ink)).toBeGreaterThanOrEqual(4.5)
    expect(hexContrast(tokens['on-ink'], tokens.ink)).toBeGreaterThanOrEqual(4.5)
  })

  it.each(presets.map((p) => [p.name, p.hex]))('signal %s lisible sur le fond et sur les feuilles', (_name, hex) => {
    expect(hexContrast(hex, tokens.bg)).toBeGreaterThanOrEqual(4.5)
    expect(hexContrast(hex, tokens.raise)).toBeGreaterThanOrEqual(4.5)
  })
})
