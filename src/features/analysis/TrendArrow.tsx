// Glyphe de tendance partagé : flèche orientée (haut/plat/bas) qui porte l'info
// par la FORME, pas seulement la couleur (DESIGN.md « couleur + signe/forme,
// jamais la couleur seule » ; daltonisme). Utilisé par ProgressionBadge et par
// les cartes de taux de la comparaison de blocs (BlockComparisonPanel).
//
// La sémantique pure (seuil, classification, couleur) vit dans `./trend` ; ce
// fichier ne porte que le composant SVG (fast-refresh propre).
import type { Trend } from './trend';

export function TrendArrow({ trend }: { trend: Trend }) {
  // La FORME porte l'info même sans couleur (daltonisme).
  const paths: Record<Trend, string> = {
    up: 'M5 12l5-6 5 6', // chevron vers le haut
    down: 'M5 6l5 6 5-6', // chevron vers le bas
    flat: 'M5 9h10', // trait plat
  };
  return (
    <svg
      viewBox="0 0 20 18"
      width="13"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[trend]} />
    </svg>
  );
}
