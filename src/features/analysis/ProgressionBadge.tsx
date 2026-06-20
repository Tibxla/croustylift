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
import { TrendArrow } from './TrendArrow';
import { trendColor, trendOf } from './trend';

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
  // Fond du badge teinté par le statut (maquette : delta sur fond good/warn voilé).
  // Vert/ambre atténués seulement — jamais de violet ici (One Voice), jamais de rouge.
  const bgTint =
    trend === 'up'
      ? 'bg-[color-mix(in_oklab,var(--color-good),transparent_86%)]'
      : trend === 'down'
        ? 'bg-[color-mix(in_oklab,var(--color-warn),transparent_86%)]'
        : 'bg-surface-2';
  const sign = weeklyRate > 0 ? '+' : ''; // le '−' vient déjà du nombre négatif.
  const label =
    trend === 'up'
      ? `Progression ${sign}${weeklyRate.toFixed(1)} % par semaine`
      : trend === 'down'
        ? `Régression ${weeklyRate.toFixed(1)} % par semaine`
        : `Stagnation, ${sign}${weeklyRate.toFixed(1)} % par semaine`;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 ${bgTint} ${color}`}
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
