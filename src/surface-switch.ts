// Changement d'onglet : la décision, sans React ni DOM, pour être testable.
// `App.tsx` fournit les effets (garde de sortie, rechargement, affichage).
//
// Ordre imposé :
//   1. la garde de sortie (`requestLeave`, features/authoring/seance-dirty.ts) :
//      un écran qui porte des modifications non enregistrées demande d'abord
//      confirmation. Tant que l'utilisateur n'a pas accepté de quitter, il ne se
//      passe RIEN : ni rechargement, ni changement d'onglet. Un rechargement
//      lancé avant la réponse emporterait la saisie qu'on propose de garder ;
//   2. le rechargement sur une nouvelle version, si une attend (`requestReload`,
//      pwa/register.ts) : le changement d'onglet démonte déjà l'écran quitté ;
//   3. l'affichage de l'onglet, dans tous les cas une fois la sortie acceptée :
//      si le rechargement tardait ou n'arrivait pas, l'app ne doit pas rester
//      sourde au tap.

import type { SurfaceName } from './pwa/update'

/** Les effets du changement d'onglet, fournis par `App.tsx`. */
export interface SurfaceSwitchEffects {
  /** Passe par la garde de sortie de l'écran courant, s'il en pose une. */
  requestLeave: (proceed: () => void) => void
  /** Recharge sur la nouvelle version si le moment s'y prête ; vrai si la page recharge. */
  requestReload: (trigger: 'surface-change', target: SurfaceName) => boolean
  /** Affiche l'onglet. */
  show: (surface: SurfaceName) => void
}

/** L'utilisateur tape l'onglet `next` alors que `current` est affiché. */
export function switchSurface(
  next: SurfaceName,
  current: SurfaceName,
  effects: SurfaceSwitchEffects,
): void {
  // Tap sur l'onglet déjà affiché : rien n'est quitté, rien à garder ni à recharger.
  if (next === current) {
    effects.show(next)
    return
  }
  effects.requestLeave(() => {
    effects.requestReload('surface-change', next)
    effects.show(next)
  })
}
