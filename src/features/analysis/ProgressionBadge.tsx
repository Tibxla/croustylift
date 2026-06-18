// Badge de progression %/semaine.
//
// DESIGN.md « code progrès/stagnation/régression par couleur + signe/forme,
// jamais par la couleur seule » : on porte donc une FLÈCHE (haut/plat/bas) ET
// un signe (+/−) ET la couleur (vert froid / ambre). Jamais de rouge fitness :
// une régression reste en ambre atténué, pas en alarme. Flèche + couleur
// partagées avec les cartes de comparaison (cf. `TrendArrow`).
//
// `null` = pas assez de séances pour ajuster une pente : on l'affiche en clair
// (« pente indispo »), pas en zéro trompeur.
import { TrendArrow, trendColor, trendOf } from './TrendArrow';

export function ProgressionBadge({ weeklyRate }: { weeklyRate: number | null }) {
  if (weeklyRate === null) {
    return (
      <span className="inline-flex items-center rounded-md bg-surface-2 px-2 py-1 text-xs text-ink-muted">
        pente indispo
      </span>
    );
  }

  const trend = trendOf(weeklyRate);
  const color = trendColor(trend);
  const sign = weeklyRate > 0 ? '+' : ''; // le '−' vient déjà du nombre négatif.
  const label =
    trend === 'up'
      ? `Progression ${sign}${weeklyRate.toFixed(1)} % par semaine`
      : trend === 'down'
        ? `Régression ${weeklyRate.toFixed(1)} % par semaine`
        : `Stagnation, ${sign}${weeklyRate.toFixed(1)} % par semaine`;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md bg-surface-2 px-2 py-1 ${color}`}
      aria-label={label}
    >
      <TrendArrow trend={trend} />
      <span className="readout text-xs font-medium">
        {sign}
        {weeklyRate.toFixed(1)}
        <span className="ml-0.5 font-normal opacity-80"> %/sem</span>
      </span>
    </span>
  );
}
