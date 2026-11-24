// Les mots de l'unité d'une courbe (cf. `CurveUnit`, domain/types.ts). Un exo
// jamais chargé (poids du corps saisi à 0 kg) se lit en reps effectives : l'écran
// dit alors « reps », jamais « e1RM » ni « kg ». Purs.
import type { CurveUnit } from '../../domain/types'
import { sessionsLabel } from './rate-period'

/** Le nom court de la mesure, pour un pied de graphe ou un libellé : « e1RM », « reps eff. ». */
export function measureLabel(unit: CurveUnit): string {
  return unit === 'reps' ? 'reps eff.' : 'e1RM'
}

/** Le libellé des séries 2+ : une moyenne de la mesure. */
export function secondaryLabel(unit: CurveUnit): string {
  return unit === 'reps' ? 'reps eff. moyennes' : 'e1RM moyen'
}

/**
 * Ce que mesure le « %/sem » d'un exo en reps : la force estimée (l'e1RM à poids
 * du corps constant, cf. `weeklyProgressionRate`), pas le pourcentage de reps
 * qu'on lirait sur la courbe. `null` en kilos, où la pente est celle de la courbe.
 */
export function rateNote(unit: CurveUnit): string | null {
  return unit === 'reps'
    ? '%/sem en force estimée, à poids du corps constant : une rep de plus vaut environ +2,5 %.'
    : null
}

/**
 * Les exécutions hors d'une courbe en kilos parce que saisies à 0 kg : on le dit
 * sous le graphe plutôt que de les écarter en silence. `null` s'il n'y en a pas.
 */
export function zeroLoadHolesLabel(count: number): string | null {
  return count > 0 ? `${sessionsLabel(count)} à 0 kg hors courbe` : null
}
