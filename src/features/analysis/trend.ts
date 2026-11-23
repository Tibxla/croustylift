// Sémantique de tendance (pure) : seuil de stagnation + classification d'un taux
// + couleur associée. Séparée du glyphe `TrendArrow` (composant) pour garder le
// fast-refresh propre et suivre la convention « logique pure dans un module dédié ».
// Couleur + signe/forme, jamais la couleur seule (DESIGN.md) : `trendColor` se lit
// toujours avec la flèche `TrendArrow`.

/** Seuil sous lequel on considère que ça stagne (bruit de mesure ±0,5 %/sem). */
export const FLAT_THRESHOLD = 0.5;

export type Trend = 'up' | 'flat' | 'down';

export function trendOf(rate: number): Trend {
  if (rate > FLAT_THRESHOLD) return 'up';
  if (rate < -FLAT_THRESHOLD) return 'down';
  return 'flat';
}

/** Couleur d'un taux : progression franche en vert, stagnation ET régression en
 * ambre atténué (No Fitness-Red Rule : une baisse n'est pas une urgence rouge). */
export function trendColor(trend: Trend): string {
  return trend === 'up' ? 'text-good' : 'text-warn';
}

/**
 * Ce que fait la MEILLEURE des deux pentes d'une comparaison. Elle ne
 * « progresse » que si elle monte vraiment : entre deux pentes négatives, la
 * gagnante recule le moins ; dans la zone de stagnation, elle tient le mieux.
 */
export function winnerVerdict(
  winnerRate: number,
): 'progresse le plus vite' | 'tient le mieux' | 'recule le moins' {
  const trend = trendOf(winnerRate);
  if (trend === 'up') return 'progresse le plus vite';
  return trend === 'down' ? 'recule le moins' : 'tient le mieux';
}
