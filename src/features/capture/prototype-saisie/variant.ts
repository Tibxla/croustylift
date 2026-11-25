// PROTOTYPE JETABLE (branche prototype/salle-saisie) · choix de la variante de
// l'écran de saisie et petite messagerie des bouchons. Rien de ceci ne part en
// production : tout est éteint sans `VITE_PROTOTYPE=1` au build.
import { useSyncExternalStore } from 'react';

export const PROTO = import.meta.env.VITE_PROTOTYPE === '1';

export const VARIANTS = [
  { key: 'actuel', name: 'Écran actuel' },
  { key: 'A', name: 'Sections (tour 1)' },
  { key: 'A1', name: 'Allégée' },
  { key: 'A2', name: 'Côte à côte' },
  { key: 'A3', name: 'Pied léger' },
] as const;
export type VariantKey = (typeof VARIANTS)[number]['key'];

const KEY = 'croustylift:proto-saisie:variant';
const EVENT = 'proto-saisie:variant';

function norm(v: string | null): VariantKey | null {
  if (!v) return null;
  const hit = VARIANTS.find((x) => x.key.toLowerCase() === v.toLowerCase());
  return hit ? hit.key : null;
}

/** Le paramètre d'URL d'abord ; sans lui, le dernier choix fait à la barre (une
 *  app lancée depuis l'écran d'accueil repart de son adresse de départ et perd le
 *  paramètre). Rien de choisi : l'écran actuel. */
function read(): VariantKey {
  if (!PROTO) return 'actuel';
  const fromUrl = norm(new URLSearchParams(window.location.search).get('variant'));
  if (fromUrl) return fromUrl;
  return norm(window.localStorage.getItem(KEY)) ?? 'actuel';
}

export function setVariant(v: VariantKey): void {
  const url = new URL(window.location.href);
  if (v === 'actuel') {
    url.searchParams.delete('variant');
    window.localStorage.removeItem(KEY);
  } else {
    url.searchParams.set('variant', v);
    window.localStorage.setItem(KEY, v);
  }
  window.history.replaceState(window.history.state, '', url);
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  window.addEventListener('popstate', cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener('popstate', cb);
  };
}

export function useVariant(): VariantKey {
  return useSyncExternalStore(subscribe, read, () => 'actuel' as const);
}

// --- Messages des bouchons (ce qui SERAIT enregistré) ------------------------

let said: { text: string; at: number } | null = null;
const SAY = 'proto-saisie:say';

/** Affiche dans la barre de bascule ce qu'un geste aurait écrit en base. */
export function protoSay(text: string): void {
  said = { text, at: Date.now() };
  window.dispatchEvent(new Event(SAY));
}

export function useSaid(): { text: string; at: number } | null {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener(SAY, cb);
      return () => window.removeEventListener(SAY, cb);
    },
    () => said,
    () => null,
  );
}
