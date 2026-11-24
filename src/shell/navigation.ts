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

// --- Intention d'ouverture ----------------------------------------------------
//
// Une surface s'ouvre toujours sur son état de départ. Un écran qui y mène peut
// déposer une intention ponctuelle (« ouvrir l'Analyse sur le Journal »), lue
// par la surface visée à son montage puis effacée. Elle périme vite : un
// changement de surface refusé (garde de sortie) ou un rechargement ne la
// laisse pas ressurgir à une ouverture ultérieure.

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

/** Efface l'intention de cette surface (après son montage). */
export function clearSurfaceIntent(surface: SurfaceIntent['surface']): void {
  if (pendingIntent?.intent.surface === surface) pendingIntent = null;
}
