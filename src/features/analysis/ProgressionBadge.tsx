// Badge de progression %/semaine.
//
// DESIGN.md « code progrès/stagnation/régression par couleur + signe/forme,
// jamais par la couleur seule » : on porte donc une FLÈCHE (haut/plat/bas) ET
// un signe (+/−) ET la couleur (vert froid / ambre). Jamais de rouge fitness :
// une régression reste en ambre atténué, pas en alarme.
//
// `null` = pas assez de séances pour ajuster une pente : on l'affiche en clair
// (« pente indispo »), pas en zéro trompeur.

/** Seuil sous lequel on considère que ça stagne (bruit de mesure ±0,5 %/sem). */
const FLAT_THRESHOLD = 0.5;

type Trend = 'up' | 'flat' | 'down';

function trendOf(rate: number): Trend {
  if (rate > FLAT_THRESHOLD) return 'up';
  if (rate < -FLAT_THRESHOLD) return 'down';
  return 'flat';
}

function ArrowIcon({ trend }: { trend: Trend }) {
  // Flèche orientée : la FORME porte l'info même sans couleur (daltonisme).
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

export function ProgressionBadge({ weeklyRate }: { weeklyRate: number | null }) {
  if (weeklyRate === null) {
    return (
      <span className="inline-flex items-center rounded-md bg-surface-2 px-2 py-1 text-xs text-ink-muted">
        pente indispo
      </span>
    );
  }

  const trend = trendOf(weeklyRate);
  // Progression franche en vert ; stagnation ET régression en ambre atténué
  // (No Fitness-Red Rule : une baisse n'est pas une urgence rouge).
  const color = trend === 'up' ? 'text-good' : 'text-warn';
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
      <ArrowIcon trend={trend} />
      <span className="readout text-xs font-medium">
        {sign}
        {weeklyRate.toFixed(1)}
        <span className="ml-0.5 font-normal opacity-80"> %/sem</span>
      </span>
    </span>
  );
}
