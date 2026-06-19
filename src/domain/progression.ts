import type { E1rmPoint } from './types'

export function weeklyProgressionRate(
  points: E1rmPoint[],
  minPoints = 3,
): number | null {
  if (points.length < minPoints) {
    return null
  }

  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date))
  const t0 = Date.parse(sorted[0].date)
  const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000

  const xs = sorted.map((p) => (Date.parse(p.date) - t0) / MS_PER_WEEK)
  const ys = sorted.map((p) => p.e1rm)
  const n = sorted.length

  const meanX = xs.reduce((s, x) => s + x, 0) / n
  const meanY = ys.reduce((s, y) => s + y, 0) / n

  let sxx = 0
  let sxy = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX
    sxx += dx * dx
    sxy += dx * (ys[i] - meanY)
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
