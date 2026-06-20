// Badge de statut sobre — couleur + glyphe/forme, jamais couleur seule (PRODUCT.md A11y).
// Le mapping état→visuel (pur) vit dans `./deviation-visual` ; ce fichier ne porte
// que le rendu du badge (fast-refresh propre).
import { type Tone, type Visual } from './deviation-visual';

const GLYPHS: Record<Visual['glyph'], string> = {
  check: 'M4 12l5 5L20 6',
  down: 'M12 5v14M6 13l6 6 6-6',
  up: 'M12 19V5M6 11l6-6 6 6',
  dash: 'M5 12h14',
};

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
