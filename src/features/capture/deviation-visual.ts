// Mappe l'état d'un exo (déviations prescription↔réel + nb de séries) vers un
// visuel de badge (ton + libellé + glyphe). Logique pure, séparée du composant
// `DeviationBadge` (fast-refresh propre, convention « logique pure en module »).
// Couleur + glyphe/forme, jamais la couleur seule (PRODUCT.md A11y).
import type { Deviation } from '../../domain/deviation';
import type { Range } from '../../domain/types';
import { formatRange } from './format';

export type Tone = 'good' | 'warn' | 'neutral';

export interface Visual {
  tone: Tone;
  label: string;
  /** Glyphe SVG (clé) qui double l'info couleur. */
  glyph: 'check' | 'down' | 'up' | 'dash';
}

/** Mappe l'état d'un exo (déviations + nb séries) vers un visuel de badge. */
export function deviationVisual(deviations: Deviation[], sets: Range, count: number): Visual {
  if (count === 0) {
    return { tone: 'warn', label: 'Passé', glyph: 'dash' };
  }
  const dev = deviations[0];
  if (!dev) {
    // Dans la fourchette de séries prescrite.
    return { tone: 'good', label: `Cible tenue · ${count} séries`, glyph: 'check' };
  }
  if (dev.kind === 'skipped') {
    return { tone: 'warn', label: 'Passé', glyph: 'dash' };
  }
  if (dev.kind === 'fewer-sets') {
    return {
      tone: 'warn',
      label: `Sous l'objectif · ${count}/${formatRange(sets)} séries`,
      glyph: 'down',
    };
  }
  // extra-sets
  return {
    tone: 'good',
    label: `Au-dessus · ${count}/${formatRange(sets)} séries`,
    glyph: 'up',
  };
}
