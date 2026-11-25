// Le crochet React des lectures d'écran au calme (cf. dated-read.ts) : lit la
// vue, la suit quand la revalidation la remplace, relit au retour du réseau, et
// dit quand la date de la copie doit s'afficher.
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { loadDated, mountView, watchDated, type DatedState } from './dated-read';
import { useSurfaceActive } from '../shell/navigation';

/** Au-delà, une copie montrée en ligne sans relecture arrivée se date à l'écran
 *  (réseau de salle qui répond mal sans être coupé). */
export const COPY_LATE_MS = 3000;

function subscribeOnline(cb: () => void): () => void {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
}

/** L'appareil se sait-il en ligne ? (`navigator.onLine`, suivi en direct.) */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => typeof navigator === 'undefined' || navigator.onLine !== false,
    () => true,
  );
}

/**
 * La vue réellement suivie : aucune tant que la surface de l'écran est cachée.
 * Une surface quittée reste montée (shell/surface-memory.ts) ; sans cela, une
 * Analyse cachée relirait tout le Journal après chaque série loggée en salle
 * (acquittement d'un flush, `mountView`) ou au retour du réseau, ce que
 * dated-read.ts interdit. La vue garde ce qu'elle montrait ; au retour sur
 * l'onglet, la clé revient et la vue se relit comme à une ouverture (copie
 * d'abord, puis la revalidation), sans repasser par « chargement ».
 */
export function liveViewKey(key: string | null, surfaceActive: boolean): string | null {
  return surfaceActive ? key : null;
}

/**
 * Lit la vue `key` (rien tant que `key` est `null`, ni tant que la surface de
 * l'écran est cachée, cf. `liveViewKey`). `reload` repasse par
 * « chargement » (Réessayer) ; `refresh` relit en gardant l'affichage (après une
 * écriture, que l'appelant a déjà fait marquer périmée). `fetcher` doit être
 * stable (module, `useCallback`).
 *
 * `showDate` : la valeur montrée est une copie et l'écran doit le dire avec sa
 * date, soit parce que l'appareil est hors ligne, soit parce qu'aucune relecture
 * n'est arrivée en `COPY_LATE_MS`. En ligne, une relecture rapide remplace la
 * copie sans que la date ait clignoté.
 */
export function useDatedLoad<T>(viewKey: string | null, fetcher: () => Promise<T>) {
  const key = liveViewKey(viewKey, useSurfaceActive());
  const online = useOnline();
  const [state, setState] = useState<DatedState<T>>({ phase: 'loading' });
  const [tick, setTick] = useState(0);
  const [lateAt, setLateAt] = useState<number | null>(null);

  useEffect(() => {
    if (key === null) return;
    let active = true;
    const stop = watchDated<T>(key, (next) => {
      if (active) setState(next);
    });
    void loadDated(key, fetcher, { offline: !online }).then((next) => {
      if (active) setState(next);
    });
    return () => {
      active = false;
      stop();
    };
  }, [key, fetcher, online, tick]);

  // Monté, l'écran est relu quand une écriture acquittée fausse sa vue
  // (`refreshMountedViews`, après un flush).
  useEffect(() => (key === null ? undefined : mountView(key, () => setTick((k) => k + 1))), [key]);

  const copyAt = state.phase === 'ready' && state.copy ? state.at : null;
  // Relancé à chaque relecture (`tick`) : « Réessayer » sur la même copie
  // redonne son délai à la revalidation.
  useEffect(() => {
    if (copyAt === null) return;
    const timer = window.setTimeout(() => setLateAt(copyAt), COPY_LATE_MS);
    return () => window.clearTimeout(timer);
  }, [copyAt, tick]);

  const reload = useCallback(() => {
    setState({ phase: 'loading' });
    // « Réessayer » redonne à la relecture son délai avant de dater la copie.
    setLateAt(null);
    setTick((k) => k + 1);
  }, []);
  const refresh = useCallback(() => {
    setLateAt(null);
    setTick((k) => k + 1);
  }, []);
  const showDate = copyAt !== null && (!online || lateAt === copyAt);
  return { state, reload, refresh, online, showDate };
}
