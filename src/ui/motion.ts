// Kit E · préférence de mouvement du système, lue au moment du geste.

/** Vrai si les animations sont réduites : `data-motion="reduite"` sur <html>,
 *  posé par le réglage « Réduire les animations » (src/settings/reglages.ts,
 *  défaut = préférence du système). Les déplacements joués en JS (sortie de
 *  feuille, élan de la règle) le lisent eux-mêmes : les règles CSS ne couvrent
 *  que les transitions déclarées en CSS. Sans attribut (harnais, tests), la
 *  préférence du système. */
export function prefersReducedMotion(): boolean {
  if (typeof document !== 'undefined') {
    const motion = document.documentElement.dataset.motion;
    if (motion) return motion === 'reduite';
  }
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}
