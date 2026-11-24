// Couleur de signal : les prédéfinies et la couleur libre (teinte et clarté),
// calculées sans React (testé).
//
// Couleur libre : toutes les teintes (crans de 2°) et toutes les clartés (25
// crans, OKLCH L de 0,30 à 0,96), à l'intensité la plus forte que le sRGB permet
// pour ce couple : ni gris ni tons éteints, un signal doit ressortir. La chroma
// est réduite pour rester dans le gamut, jamais un canal écrêté, donc jamais une
// teinte qui dérive. Une couleur libre n'est jamais refusée : sous 4,5:1 sur le
// fond, l'écran dit « Peu lisible sous les néons », sans chiffre.
import presets from './signal-presets.json';

export interface SignalPreset {
  name: string;
  hex: string;
}

/** Six prédéfinies réparties sur le cercle des teintes, toutes à 5,9:1 au moins
 *  sur le fond et sur les feuilles (prouvé par `npm run contrast` et son test). */
export const SIG_PRESETS: readonly SignalPreset[] = presets;

/** La prédéfinie par défaut (Jaune). */
export const SIG_DEFAULT: SignalPreset = presets[0]!;

/** Nom affiché d'une couleur libre : pas de degré, pas de chiffre. */
export const FREE_NAME = 'Autre couleur';

/** Teinte libre : crans de 2°, de 0 à 358. */
export const HUE_STEP = 2;
export const HUE_MAX = 358;
/** Clarté libre : 25 crans, du sombre (0) au clair (24). */
export const CLARTE_MAX = 24;
/** Clarté de départ : L ≈ 0,80, proche des prédéfinies. */
export const CLARTE_DEFAUT = 18;
const L_MIN = 0.3;
const L_MAX = 0.96;
const lightOf = (l: number) => L_MIN + ((L_MAX - L_MIN) * l) / CLARTE_MAX;

/** Fond de l'app (--color-bg), pour juger la lisibilité d'une couleur libre. */
const BG = '#100e0c';

/** OKLCH vers sRGB linéaire (non borné : hors gamut si un canal sort de [0, 1]). */
function oklchToLinear(L: number, C: number, h: number): [number, number, number] {
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = (rgb: number[]) => rgb.every((v) => v >= -0.0005 && v <= 1.0005);

/** Chroma la plus forte qui reste dans le sRGB pour (L, h) : recherche par dichotomie. */
function maxChroma(L: number, h: number): number {
  let lo = 0;
  let hi = 0.37;
  for (let k = 0; k < 18; k++) {
    const mid = (lo + hi) / 2;
    if (inGamut(oklchToLinear(L, mid, h))) lo = mid;
    else hi = mid;
  }
  return lo;
}

function linearToHex(lin: number[]): string {
  const enc = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
  return (
    '#' +
    lin
      .map((v) => Math.round(Math.min(1, Math.max(0, enc(v))) * 255).toString(16).padStart(2, '0'))
      .join('')
  );
}

/** Couleur libre : teinte en degrés (0 à 358), clarté en crans (0 à CLARTE_MAX). */
export function freeHex(h: number, l: number): string {
  const L = lightOf(l);
  return linearToHex(oklchToLinear(L, maxChroma(L, h), h));
}

/** Contraste WCAG entre deux couleurs #rrggbb. */
export function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const c = [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

/** Lisible sous les néons : 4,5:1 au moins sur le fond. */
export const readable = (hex: string) => contrast(hex, BG) >= 4.5;
