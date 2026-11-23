// Calcul de contraste WCAG 2 pour des couleurs OKLCH : fonctions pures, testées
// (contrast-lib.test.mjs). Le script `contrast.mjs` les applique aux tokens de
// src/index.css.

/** OKLCH (L 0..1, C, H en degrés) vers sRGB LINÉAIRE, composantes bornées à 0..1. */
export function oklchToLinearSrgb(l, c, hDeg) {
  const h = (hDeg * Math.PI) / 180
  const a = c * Math.cos(h)
  const b = c * Math.sin(h)
  // OKLab vers LMS (non linéaire), puis cube, puis sRGB linéaire (Björn Ottosson).
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
  const clamp = (x) => Math.min(1, Math.max(0, x))
  return [
    clamp(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_),
    clamp(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_),
    clamp(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_),
  ]
}

/** Luminance relative WCAG d'une couleur sRGB linéaire. */
export function luminance([r, g, b]) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Rapport de contraste WCAG entre deux luminances (de 1 à 21). */
export function contrastRatio(lumA, lumB) {
  const hi = Math.max(lumA, lumB)
  const lo = Math.min(lumA, lumB)
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * Extrait d'une feuille CSS les tokens `--color-nom: oklch(L C H)` opaques.
 * Rend `{ nom: [L, C, H] }`. Les couleurs en `rgba()`, `color-mix()` ou avec
 * alpha sont ignorées : leur contraste dépend du fond sur lequel elles se posent.
 */
export function parseOklchTokens(css) {
  const tokens = {}
  const pattern = /--color-([a-z0-9-]+):\s*oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)\s*\)/g
  for (const [, name, l, c, h] of css.matchAll(pattern)) {
    const lightness = l.endsWith('%') ? parseFloat(l) / 100 : parseFloat(l)
    tokens[name] = [lightness, parseFloat(c), parseFloat(h)]
  }
  return tokens
}

/** Contraste entre deux tokens OKLCH `[L, C, H]`. */
export function tokenContrast(fg, bg) {
  return contrastRatio(luminance(oklchToLinearSrgb(...fg)), luminance(oklchToLinearSrgb(...bg)))
}
