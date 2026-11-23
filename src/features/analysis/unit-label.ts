// Les mots de l'unité d'une courbe (cf. `CurveUnit`, domain/types.ts). Un exo
// jamais chargé (poids du corps saisi à 0 kg) se lit en reps effectives : l'écran
// dit alors « reps », jamais « e1RM » ni « kg ». Purs.
import type { CurveUnit } from '../../domain/types'

/** Le nom court de la mesure, pour un pied de graphe ou un libellé : « e1RM », « reps eff. ». */
export function measureLabel(unit: CurveUnit): string {
  return unit === 'reps' ? 'reps eff.' : 'e1RM'
}

/** L'intitulé du chiffre héros d'une carte. */
export function heroLabel(unit: CurveUnit): string {
  return unit === 'reps' ? 'Reps effectives' : 'e1RM estimé'
}

/** Le libellé des séries 2+ : une moyenne de la mesure. */
export function secondaryLabel(unit: CurveUnit): string {
  return unit === 'reps' ? 'reps eff. moyennes' : 'e1RM moyen'
}

/**
 * Les exécutions hors d'une courbe en kilos parce que saisies à 0 kg : on le dit
 * sous le graphe plutôt que de les écarter en silence. `null` s'il n'y en a pas.
 */
export function zeroLoadHolesLabel(count: number): string | null {
  if (count <= 0) return null
  return count === 1 ? '1 séance à 0 kg hors courbe' : `${count} séances à 0 kg hors courbe`
}
