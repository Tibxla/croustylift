// Kit E · indice de glissé : ce qui coulisse le montre, une fois par appareil.
import { prefersReducedMotion } from './motion';

/** Drapeau par appareil : l'indice a joué. */
const KEY = 'croustylift:indice-glisse';
/** L'écran se pose avant l'indice : l'œil a trouvé les plaques. */
const DELAY_MS = 450;
/** Aller, puis retour, chacun en 300 ms. */
const LEG_MS = 300;
/** Décalage entre deux couches (règle, Reps, RIR) : elles partent l'une après l'autre. */
const STAGGER_MS = 70;
const SHIFT_PX = 14;
const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';
const EASE_IN_OUT = 'cubic-bezier(0.77, 0, 0.175, 1)';

/**
 * Indice de glissé, joué UNE fois par appareil (retour de l'utilisateur du
 * 25/11 : les rangées Reps, RIR et la règle coulissent, « on ne dirait pas
 * qu'on peut »). Au premier affichage de l'instrument, chaque couche marquée
 * `data-glisse` sous `root` glisse de 14 px vers ce qui est caché puis revient
 * (300 ms ease-out fort à l'aller, 300 ms au retour), l'une après l'autre. Une
 * rangée (`data-glisse="enfants"`) fait glisser ses cases, pas son masque ; la
 * piste de la règle glisse sous l'aiguille, qui ne bouge pas.
 *
 * Jamais sur un geste : seulement au montage, et le drapeau (localStorage) est
 * écrit au moment où l'indice joue. Rien avec « Réduire les animations » (le
 * drapeau n'est alors pas écrit), ni sur un écran caché (surface garée par le
 * shell : `inert` et `visibility: hidden`, App.tsx), ni sans `Element.animate`
 * (tests). Un toucher l'interrompt, ou l'annule s'il vient avant. En `translate`,
 * propriété à part : elle se compose au `transform` de la piste, et le
 * `scrollLeft` des rangées (et leur accroche) n'est pas touché.
 *
 * Renvoie le nettoyage (pour un `useEffect`).
 */
export function slideHintOnce(root: HTMLElement | null): () => void {
  if (!root) return () => {};
  let anims: Animation[] = [];
  let timer = 0;
  const stop = () => {
    window.clearTimeout(timer);
    for (const a of anims) a.cancel();
    anims = [];
  };
  timer = window.setTimeout(() => {
    try {
      if (localStorage.getItem(KEY)) return;
    } catch {
      return;
    }
    if (prefersReducedMotion() || root.closest('[inert]') || getComputedStyle(root).visibility === 'hidden') return;
    const layers = [...root.querySelectorAll<HTMLElement>('[data-glisse]')];
    if (layers.length === 0 || typeof layers[0]!.animate !== 'function') return;
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      // Stockage plein ou refusé : l'indice joue quand même.
    }
    layers.forEach((layer, i) => {
      const row = layer.dataset.glisse === 'enfants';
      // Vers ce qui est caché : à droite, sauf au bout d'une rangée.
      const atEnd = row && layer.scrollLeft >= layer.scrollWidth - layer.clientWidth - 1;
      const dx = atEnd ? SHIFT_PX : -SHIFT_PX;
      const targets = row ? [...layer.children] : [layer];
      for (const t of targets) {
        anims.push(
          t.animate(
            [
              { translate: '0px', easing: EASE_OUT },
              { translate: `${dx}px`, offset: 0.5, easing: EASE_IN_OUT },
              { translate: '0px' },
            ],
            { duration: 2 * LEG_MS, delay: i * STAGGER_MS },
          ),
        );
      }
    });
  }, DELAY_MS);
  root.addEventListener('pointerdown', stop);
  return () => {
    root.removeEventListener('pointerdown', stop);
    stop();
  };
}
