// Kit E · écran bas : la Salle se resserre pour garder ses plaques de réglage
// (poids, Reps, RIR) au-dessus du pied sans défiler. Deux paliers :
//   - bas (hauteur ≤ 800 px, ex. 360×780, et l'iPhone de l'utilisateur en écran
//     d'accueil, 393×793) : `useCompact`. Poids à 64 px (56 en unilatéral),
//     règle de 48 px, air de 10 px ;
//   - très bas (hauteur ≤ 700 px, ex. iPhone SE en écran d'accueil, 375×667) :
//     `useCompactTight`, en plus du premier. Poids à 48 px, règle et rangées de
//     44 px, air de 6 px, et plus d'index des exos : sans cela, la variante A4
//     passait 15 px sous le pied (mesuré le 25/11, barre d'état de 20 px et
//     marge de navigation de 14 px comprises).
import { useSyncExternalStore } from 'react';

const QUERY = '(max-height: 800px)';
const TIGHT_QUERY = '(max-height: 700px)';

/** Abonnement stable par requête : `useSyncExternalStore` ne se réabonne pas à chaque rendu. */
function mediaStore(query: string) {
  return {
    subscribe(cb: () => void): () => void {
      const mq = typeof window === 'undefined' ? null : window.matchMedia?.(query);
      mq?.addEventListener?.('change', cb);
      return () => mq?.removeEventListener?.('change', cb);
    },
    get: () => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches,
  };
}

const LOW = mediaStore(QUERY);
const TIGHT = mediaStore(TIGHT_QUERY);
const never = () => false;

/** Vrai sur un écran bas (même seuil que la variante CSS `[@media(max-height:800px)]`). */
export function useCompact(): boolean {
  return useSyncExternalStore(LOW.subscribe, LOW.get, never);
}

/** Vrai sur un écran très bas (même seuil que `[@media(max-height:700px)]`). */
export function useCompactTight(): boolean {
  return useSyncExternalStore(TIGHT.subscribe, TIGHT.get, never);
}
