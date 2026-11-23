import type { E1rmPoint } from './types'

/**
 * Sous ce nombre de points, et d'autant de JOURS distincts, une pente n'est pas
 * mesurée (cf. `weeklyProgressionRate`).
 */
export const MIN_SLOPE_POINTS = 3

export function weeklyProgressionRate(
  points: E1rmPoint[],
  minPoints = MIN_SLOPE_POINTS,
): number | null {
  if (points.length < minPoints) {
    return null
  }

  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date))
  // Trois points ne suffisent pas s'ils tiennent sur deux jours (séance reprise
  // après Clôture, puis le lendemain) : la droite passerait par 24 h et
  // s'afficherait « +13,9 %/sem ». On exige autant de DATES distinctes que de
  // points minimaux.
  if (new Set(sorted.map((p) => p.date)).size < minPoints) {
    return null
  }
  const first = sorted[0]
  // Garde indépendante de `minPoints` : un appel `minPoints <= 0` sur un tableau
  // vide franchirait la garde ci-dessus mais n'a aucune pente mesurable.
  if (first === undefined) {
    return null
  }
  const t0 = Date.parse(first.date)
  const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000

  const xs = sorted.map((p) => (Date.parse(p.date) - t0) / MS_PER_WEEK)
  const ys = sorted.map((p) => p.e1rm)
  const n = sorted.length

  const meanX = xs.reduce((s, x) => s + x, 0) / n
  const meanY = ys.reduce((s, y) => s + y, 0) / n

  let sxx = 0
  let sxy = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - meanX
    sxx += dx * dx
    sxy += dx * (ys[i]! - meanY)
  }

  // Timespan nul (tous les points à la même date) → pente indéfinie : on
  // renvoie null plutôt qu'un NaN. Choix : pas de progression mesurable sans
  // étalement temporel.
  if (sxx === 0) {
    return null
  }

  // Base nulle (tous les e1RM à 0) → taux RELATIF indéfini : division par 0 qui
  // donnerait NaN/Infinity et contaminerait compareBlocks/decideWinner. On
  // renvoie null, dans le même esprit que la garde sxx ci-dessus : pas de
  // pourcentage de progression mesurable sans base non nulle.
  if (meanY === 0) {
    return null
  }

  const slope = sxy / sxx // kg / semaine
  return (slope / meanY) * 100
}

/**
 * Une pente à la précision de son AFFICHAGE : 0,1 point de %/semaine. Sert à la
 * fois au formatage et à l'égalité de deux pentes, pour qu'un verdict ne
 * désigne jamais un gagnant entre deux cartes qui affichent le même chiffre.
 * Un zéro négatif est ramené à zéro (jamais de « −0,0 »).
 */
export function roundRate(rate: number): number {
  const rounded = Number(rate.toFixed(1))
  return rounded === 0 ? 0 : rounded
}
