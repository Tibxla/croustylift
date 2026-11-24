// Kit E · emplacement des feuilles basses.
import { createContext } from 'react';

/** Emplacement des feuilles, fourni par le shell (dernier enfant de sa racine,
 *  `sticky bottom-0`) : les feuilles s'y montent par portail, sans
 *  `position: fixed`, et héritent des tokens et de `--sig`. Hors shell (null), une
 *  feuille ne s'affiche pas. */
export const SheetSlotContext = createContext<HTMLElement | null>(null);
