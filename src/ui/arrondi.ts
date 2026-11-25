// PROTOTYPE JETABLE (branche prototype/salle-saisie) · traitement d'arrondi de
// toute l'app, choisi par `?arrondi=R1|R2|R3` et la barre de bascule. Sans
// paramètre ni choix mémorisé : l'actuel (filets, rayons de 6 et 10 px).
//
// Le choix vit sur `<html data-arrondi="R1">`, posé avant le premier rendu
// (main.tsx), comme le signal : la connexion et le premier lancement en héritent
// aussi. Tout le rendu suit en CSS (index.css, bloc « Arrondis ») par des
// variables de rayon, de surface et d'espacement, et par les classes d'accroche
// du kit (`ui-list`, `ui-row`, `ui-plate`…) : aucun composant ne lit ce choix.
// C'est ce qui permettra d'en faire un réglage ensuite.
import { useSyncExternalStore } from 'react';

const PROTO = import.meta.env.VITE_PROTOTYPE === '1';

export const ARRONDIS = [
  { key: 'actuel', name: 'Filets (actuel)' },
  { key: 'R1', name: 'Groupes arrondis' },
  { key: 'R2', name: 'Bulles' },
  { key: 'R3', name: 'Doux' },
] as const;
export type ArrondiKey = (typeof ARRONDIS)[number]['key'];

const KEY = 'croustylift:proto:arrondi';
const EVENT = 'proto:arrondi';

function norm(v: string | null): ArrondiKey | null {
  if (!v) return null;
  const hit = ARRONDIS.find((x) => x.key.toLowerCase() === v.toLowerCase());
  return hit ? hit.key : null;
}

/** Le paramètre d'URL d'abord ; sans lui, le dernier choix fait à la barre. */
function read(): ArrondiKey {
  if (!PROTO) return 'actuel';
  const fromUrl = norm(new URLSearchParams(window.location.search).get('arrondi'));
  if (fromUrl) return fromUrl;
  return norm(window.localStorage.getItem(KEY)) ?? 'actuel';
}

function apply(v: ArrondiKey): void {
  if (v === 'actuel') delete document.documentElement.dataset.arrondi;
  else document.documentElement.dataset.arrondi = v;
}

/** Au démarrage, avant le premier rendu (main.tsx). */
export function applyArrondi(): void {
  const v = read();
  apply(v);
  // Un choix venu de l'URL se mémorise : l'app installée repart sans paramètre.
  if (PROTO && v !== 'actuel') window.localStorage.setItem(KEY, v);
}

export function setArrondi(v: ArrondiKey): void {
  const url = new URL(window.location.href);
  if (v === 'actuel') {
    url.searchParams.delete('arrondi');
    window.localStorage.removeItem(KEY);
  } else {
    url.searchParams.set('arrondi', v);
    window.localStorage.setItem(KEY, v);
  }
  window.history.replaceState(window.history.state, '', url);
  apply(v);
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}

export function useArrondi(): ArrondiKey {
  return useSyncExternalStore(subscribe, read, () => 'actuel' as const);
}
