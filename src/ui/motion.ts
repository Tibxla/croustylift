// Kit E · préférence de mouvement du système, lue au moment du geste.

/** Vrai si le système demande de réduire les animations. Les déplacements joués
 *  en JS (sortie de feuille, élan de la règle) la lisent eux-mêmes : la règle CSS
 *  `prefers-reduced-motion` ne couvre que les transitions déclarées en CSS. */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}
