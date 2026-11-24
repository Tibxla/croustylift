// Kit E · écran bas (hauteur ≤ 800 px, ex. 360×780) : la Salle se resserre pour
// garder la rangée RIR au-dessus de la barre du pouce sans défiler.
import { useSyncExternalStore } from 'react';

const QUERY = '(max-height: 800px)';

function subscribe(cb: () => void): () => void {
  const mq = typeof window === 'undefined' ? null : window.matchMedia?.(QUERY);
  mq?.addEventListener?.('change', cb);
  return () => mq?.removeEventListener?.('change', cb);
}

/** Vrai sur un écran bas (même seuil que la variante CSS `[@media(max-height:800px)]`). */
export function useCompact(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => typeof window !== 'undefined' && !!window.matchMedia?.(QUERY).matches,
    () => false,
  );
}
