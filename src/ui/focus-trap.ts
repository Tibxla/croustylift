// Kit E · piège de focus d'une feuille modale, sans React (testé).

/** Ce qui reçoit le focus au clavier dans une feuille. */
export const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Où va le focus quand on tabule dans une feuille de `count` éléments
 * focalisables, depuis l'élément `index` (-1 : le focus est ailleurs, sur le
 * titre par exemple) ? Rend l'index à focaliser, ou null si la tabulation
 * ordinaire reste dans la feuille. Le focus boucle : après le dernier, le
 * premier ; avant le premier, le dernier.
 */
export function trapTarget(index: number, count: number, backwards: boolean): number | null {
  if (count === 0) return null;
  if (index === -1) return backwards ? count - 1 : 0;
  if (backwards && index === 0) return count - 1;
  if (!backwards && index === count - 1) return 0;
  return null;
}
