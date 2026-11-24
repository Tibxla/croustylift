// Le style commun des graphes de l'Analyse. On lit les tokens OKLCH directement :
// le SVG de Recharts accepte `stroke="var(--color-…)"`, donc le thème reste la
// SEULE source de vérité. Une définition pour les quatre graphes.
export const ACCENT = 'var(--color-accent)'
export const BG = 'var(--color-bg)'
export const LINE = 'var(--color-line)'
export const HAIR = 'var(--color-hair)'
export const INK_MUTED = 'var(--color-ink-muted)'
export const INK_FAINT = 'var(--color-ink-faint)'

/** Police mono tabulaire pour tous les chiffres mesurés d'un axe (Readout Rule). */
export const READOUT_TICK = {
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  fill: INK_MUTED,
  fontVariant: 'tabular-nums',
} as const
