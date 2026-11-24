// Le seul point de navigation entre surfaces, offert à tous les écrans.
//
// `goTo(surface)` passe par `switchSurface` (surface-switch.ts) : la garde de
// sortie d'abord, puis le rechargement sur une nouvelle version si une attend,
// puis l'affichage. Aucun écran ne change de surface autrement (pas de
// `setSurface` direct), sans quoi la garde des modifications non enregistrées
// serait contournée.
import { createContext, useContext } from 'react';
import type { SurfaceName } from '../pwa/update';

export const SurfaceNavigationContext = createContext<((surface: SurfaceName) => void) | null>(null);

/** Aller sur une autre surface, par le même chemin que la ligne de navigation. */
export function useGoToSurface(): (surface: SurfaceName) => void {
  const go = useContext(SurfaceNavigationContext);
  if (!go) throw new Error('useGoToSurface hors du shell authentifié');
  return go;
}
