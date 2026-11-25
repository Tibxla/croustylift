// Changement d'onglet : la décision, sans React ni DOM, pour être testable.
// `App.tsx` fournit les effets (rechargement, affichage).
//
// Ordre imposé :
//   1. le rechargement sur une nouvelle version, si une attend (`requestReload`,
//      pwa/register.ts). Il est refusé tant qu'un écran, même caché, tient un
//      brouillon (`useReloadBlockWhile`) ou qu'une séance est en cours : rien de
//      non enregistré ne part avec la page. Les vues mémorisées des autres
//      onglets (défilement, page ouverte, filtre) partent, elles, avec ce
//      rechargement rare ; la Salle retrouve la sienne par son état persisté ;
//   2. l'affichage de l'onglet, dans tous les cas : si le rechargement tardait
//      ou n'arrivait pas, l'app ne doit pas rester sourde au tap.
//
// Plus de garde de sortie ici : l'onglet quitté reste monté, caché, avec son
// brouillon (shell/surface-memory.ts). Demander « Quitter sans enregistrer ? »
// annoncerait une perte qui n'a plus lieu. La garde reste pour les retours DANS
// un écran (features/authoring/seance-dirty.ts).

import type { SurfaceName } from './pwa/update'

/** Les effets du changement d'onglet, fournis par `App.tsx`. */
export interface SurfaceSwitchEffects {
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
  // Tap sur l'onglet déjà affiché : rien n'est quitté, rien à recharger.
  if (next === current) {
    effects.show(next)
    return
  }
  effects.requestReload('surface-change', next)
  effects.show(next)
}
