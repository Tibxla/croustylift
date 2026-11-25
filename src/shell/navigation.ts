// Le seul point de navigation entre surfaces, offert à tous les écrans.
//
// `goTo(surface)` passe par `switchSurface` (surface-switch.ts) : le
// rechargement sur une nouvelle version si une attend, puis l'affichage. La
// surface quittée reste montée, cachée, et se retrouve telle quelle au retour
// (shell/surface-memory.ts). Aucun écran ne change de surface autrement (pas de
// changement d'état direct), sans quoi le défilement et les vues mémorisées
// seraient contournés.
import { createContext, useContext, useLayoutEffect, useRef } from 'react';
import type { SurfaceName } from '../pwa/update';

export const SurfaceNavigationContext = createContext<((surface: SurfaceName) => void) | null>(null);

/** Aller sur une autre surface, par le même chemin que la ligne de navigation. */
export function useGoToSurface(): (surface: SurfaceName) => void {
  const go = useContext(SurfaceNavigationContext);
  if (!go) throw new Error('useGoToSurface hors du shell authentifié');
  return go;
}

// --- Surface affichée ou cachée -----------------------------------------------
//
// Une surface visitée reste montée, cachée, quand on change d'onglet
// (shell/surface-memory.ts). Ce qu'elle faisait « au montage » se partage
// désormais en deux : au montage (première visite), et AU RETOUR sur l'onglet.
// Cachée, elle ne lit rien en tâche de fond (use-dated-load.ts) ; au retour,
// elle relit ce qu'un remontage aurait relu, sans toucher à sa vue.

/** Vrai quand la surface qui contient l'écran est affichée (vrai hors du shell). */
export const SurfaceActiveContext = createContext(true);

/** La surface de cet écran est-elle affichée ? */
export function useSurfaceActive(): boolean {
  return useContext(SurfaceActiveContext);
}

/**
 * Appelle `onReturn` quand la surface de l'écran est de nouveau affichée après
 * avoir été cachée (jamais au montage). Appelé à la mise en page, avant que la
 * surface ne se peigne : un état posé là s'affiche d'emblée, sans image
 * intermédiaire de l'ancienne vue.
 */
export function useSurfaceReturn(onReturn: () => void): void {
  const active = useSurfaceActive();
  const wasActive = useRef(active);
  const latest = useRef(onReturn);
  useLayoutEffect(() => {
    latest.current = onReturn;
  });
  useLayoutEffect(() => {
    if (active && !wasActive.current) latest.current();
    wasActive.current = active;
  }, [active]);
}

// --- Intention d'ouverture ----------------------------------------------------
//
// Un écran qui mène à une surface peut déposer une intention ponctuelle
// (« ouvrir l'Analyse sur le Journal »). Elle prime sur la vue mémorisée de la
// surface visée : lue à son montage, ou à son retour si elle était déjà montée,
// puis effacée. Elle périme vite : un rechargement ne la laisse pas ressurgir à
// une ouverture ultérieure.

/** Ce qu'une surface sait ouvrir d'emblée. */
export type SurfaceIntent = { surface: 'analysis'; open: 'journal' };

/** Durée de vie d'une intention : le temps de charger la surface, pas plus. */
export const SURFACE_INTENT_TTL_MS = 30_000;

let pendingIntent: { intent: SurfaceIntent; at: number } | null = null;

/** Dépose l'intention, juste avant `goTo(intent.surface)`. */
export function setSurfaceIntent(intent: SurfaceIntent, now: number = Date.now()): void {
  pendingIntent = { intent, at: now };
}

/** L'intention en attente pour cette surface, sans l'effacer (lecture au rendu). */
export function peekSurfaceIntent<S extends SurfaceIntent['surface']>(
  surface: S,
  now: number = Date.now(),
): Extract<SurfaceIntent, { surface: S }> | null {
  if (!pendingIntent || pendingIntent.intent.surface !== surface) return null;
  if (now - pendingIntent.at > SURFACE_INTENT_TTL_MS) return null;
  return pendingIntent.intent as Extract<SurfaceIntent, { surface: S }>;
}

/** Une intention attend-elle cette surface ? (pour le défilement, App.tsx) */
export function hasSurfaceIntent(surface: SurfaceName, now: number = Date.now()): boolean {
  return surface === 'analysis' && peekSurfaceIntent(surface, now) !== null;
}

/** Efface l'intention de cette surface (après son montage ou son retour). */
export function clearSurfaceIntent(surface: SurfaceIntent['surface']): void {
  if (pendingIntent?.intent.surface === surface) pendingIntent = null;
}
