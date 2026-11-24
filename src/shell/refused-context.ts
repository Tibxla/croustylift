// Ouvrir l'écran des saisies refusées depuis n'importe quel écran authentifié
// (ligne de synchro, Réglages). Le shell (App.tsx) pose la feuille et fournit
// l'ouverture ; hors du shell, rien (null).
import { createContext, useContext } from 'react';

export const RefusedWritesContext = createContext<(() => void) | null>(null);

export function useOpenRefusedWrites(): (() => void) | null {
  return useContext(RefusedWritesContext);
}

/** L'action de la ligne de synchro vers l'écran des saisies refusées, s'il y en a. */
export function refusedAction(refused: number, open: (() => void) | null): { label: string; onClick: () => void } | undefined {
  if (refused === 0 || !open) return undefined;
  return { label: `${refused} refusée${refused > 1 ? 's' : ''}`, onClick: open };
}
