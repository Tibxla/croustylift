// Kit E · écran bas : la Salle se resserre pour garder la rangée RIR au-dessus
// de la barre du pouce sans défiler. Deux paliers :
//   - bas (hauteur ≤ 800 px, ex. 360×780) : `useCompact` ;
//   - très bas (hauteur ≤ 700 px, ex. iPhone SE en écran d'accueil, 375×667) :
//     `useCompactTight`, en plus du premier. Poids à 48 px, bande et barre plus
//     serrées : au premier palier seul, la rangée RIR y passait 13 px sous la
//     barre (audit UI du 24/11).
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
