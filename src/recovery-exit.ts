// La sortie de secours de l'écran d'erreur (ErrorBoundary.tsx) vers la Salle.
import type { SurfaceName } from './pwa/update'

/**
 * La sortie de secours vers la Salle, selon la surface qui a planté. Depuis une
 * autre surface, on y va (le changement de surface remonte la frontière, dont la
 * clé est la surface). Depuis la Salle elle-même, aller sur la Salle ne
 * changerait rien : on la réaffiche en remontant la frontière.
 */
export function salleExit(surface: SurfaceName | undefined): { label: string; remount: boolean } {
  return surface === 'capture'
    ? { label: 'Réafficher la Salle', remount: true }
    : { label: 'Retour à la Salle', remount: false }
}

/** Le geste de la sortie : remonter la frontière sur la Salle, y aller sinon. */
export function leaveToSalle(
  surface: SurfaceName | undefined,
  effects: { goTo: (surface: SurfaceName) => void; reset: () => void },
): void {
  if (salleExit(surface).remount) effects.reset()
  else effects.goTo('capture')
}
