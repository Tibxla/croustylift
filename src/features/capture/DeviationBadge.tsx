// Badge de statut sobre — couleur + glyphe/forme, jamais couleur seule (PRODUCT.md A11y).
// S'appuie sur deriveDeviations() du domaine pour le sens.
import type { Deviation } from '../../domain/deviation';
import type { Range } from '../../domain/types';
import { formatRange } from './format';

type Tone = 'good' | 'warn' | 'neutral';

interface Visual {
  tone: Tone;
  label: string;
  /** Glyphe SVG (path) qui double l'info couleur. */
  glyph: 'check' | 'down' | 'up' | 'dash';
}

const GLYPHS: Record<Visual['glyph'], string> = {
  check: 'M4 12l5 5L20 6',
  down: 'M12 5v14M6 13l6 6 6-6',
  up: 'M12 19V5M6 11l6-6 6 6',
  dash: 'M5 12h14',
};

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

const TONE_CLASS: Record<Tone, string> = {
  good: 'text-good',
  warn: 'text-warn',
  neutral: 'text-ink-muted',
};

export function DeviationBadge({ visual }: { visual: Visual }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-sm font-medium ${TONE_CLASS[visual.tone]}`}
    >
      <svg
        viewBox="0 0 24 24"
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d={GLYPHS[visual.glyph]} />
      </svg>
      {visual.label}
    </span>
  );
}
