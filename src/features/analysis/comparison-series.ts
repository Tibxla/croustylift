// Normalise une courbe e1RM en série indexée par SEMAINE ÉCOULÉE depuis son
// premier point, pour superposer deux blocs séparés dans le temps.
//
// But produit : comparer des VITESSES de progression, pas des dates. Deux blocs
// peuvent être à des mois d'écart ; les afficher sur un axe de dates absolues
// les juxtaposerait sans se recouvrir. En ramenant chacun à « semaine 0 = son
// début », les deux pentes partent du même origine X et se lisent l'une sur
// l'autre. Pure, sans dépendance réseau.
import type { E1rmPoint } from '../../domain/types'

/** Un point de courbe replacé sur un axe X = semaines depuis le début du bloc. */
export interface WeeklyPoint {
  /**
   * Semaines ÉCOULÉES depuis le premier point du bloc (le 1er point est à 0) :
   * c'est l'écart exact qui rend les pentes comparables. L'AFFICHAGE compte les
   * semaines à partir de S1 (« S0 » n'existe pas en muscu) ; ce +1 ne vit que
   * dans le libellé (`weekLabel`), pas dans la valeur.
   */
  week: number
  e1rm: number
}

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000

export function toWeeklySeries(curve: E1rmPoint[]): WeeklyPoint[] {
  if (curve.length === 0) return []

  // Tri chronologique (dates ISO : ordre lexicographique = chronologique), pour
  // ancrer la semaine 0 au point le plus ancien quelle que soit l'entrée.
  const sorted = [...curve].sort((a, b) => a.date.localeCompare(b.date))
  const first = sorted[0]
  if (!first) return []
  const t0 = Date.parse(first.date)

  return sorted.map((point) => ({
    week: (Date.parse(point.date) - t0) / MS_PER_WEEK,
    e1rm: point.e1rm,
  }))
}

/**
 * Libellé d'une semaine écoulée : « S1 » pour la première, pas « S0 ». On
 * TRONQUE : un point au jour 4 du bloc (0,57 semaine) est encore en S1, il ne
 * passe en S2 qu'au jour 7. Sert aux ticks de l'axe et à l'infobulle du graphe.
 */
export function weekLabel(week: number): string {
  return `S${Math.floor(week) + 1}`
}
