// Sémantique de tendance (pure) : seuil de stagnation et classification d'un
// taux, dans un module dédié (logique pure). La couleur d'un statut vient du kit
// (`Status`, src/ui/), toujours avec son signe et son mot.

/** Seuil sous lequel on considère que ça stagne (bruit de mesure ±0,5 %/sem). */
export const FLAT_THRESHOLD = 0.5;

export type Trend = 'up' | 'flat' | 'down';

export function trendOf(rate: number): Trend {
  if (rate > FLAT_THRESHOLD) return 'up';
  if (rate < -FLAT_THRESHOLD) return 'down';
  return 'flat';
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
