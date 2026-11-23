// PROTOTYPE JETABLE · socle E. Contrat du shell pour toutes les surfaces :
// navigation (pile de pages par surface) et état partagé (réglages, compte,
// séance en cours). Tout vit en mémoire, rien n'est persisté.
//
// DÉCLARER UNE SURFACE ET SES SOUS-PAGES (dans e/<surface>.tsx, sans toucher App.tsx)
//
//   export function Analyse() {
//     return <Pages pages={{
//       index: () => <AnalyseIndex />,               // page racine, obligatoire
//       exo: (p) => <AnalyseExo id={p.id!} />,      // sous-page, params en chaînes
//     }} />;
//   }
//   function AnalyseIndex() {
//     const nav = useNav();
//     return <Row title="Développé couché" onClick={() => nav.push('exo', { id: 'bench' })} />;
//   }
//   function AnalyseExo({ id }: { id: string }) {
//     const nav = useNav();
//     return <ScreenHeader title={id} back={{ label: 'Analyse', onClick: nav.back }} />;
//   }
//
// NAVIGUER
//   nav.push(page, params?)        empile une sous-page dans la surface courante
//   nav.back()                     dépile (sans effet à la racine)
//   nav.reset(page?, params?)      remplace la pile de la surface courante
//   nav.go(surface, page?, params?) change de surface ; chaque surface garde sa
//                                  pile, sauf si `page` est donné (pile = racine + page).
//   nav.surface, nav.route.page, nav.route.params, nav.depth
//
// ÉTAT PARTAGÉ : `const { settings, setSettings, account, setAccount, seance } = useProto();`
//   settings.sig         couleur de signal courante (aussi en CSS : var(--sig))
//   settings.stepKg      pas de la règle de poids, libre (0,25 à 10 kg par 0,25)
//   settings.reduceMotion, settings.rulerTapAnim (commande du prototype)
//   account.phase        'connecte' | 'deconnecte' | 'premier-lancement'
//   account.email, account.pendingSync, account.offline
//   seance               voir e/seance.ts (Exécution en cours)
import { createContext, Fragment, useContext, type ReactNode } from 'react';
import type { SeanceStore } from './seance';

export type SurfaceId = 'salle' | 'analyse' | 'seances' | 'exercices' | 'reglages' | 'compte';

/** Surfaces de la barre de navigation, dans l'ordre. Le compte n'y est pas :
 *  il ne s'affiche que déconnecté (ou au premier lancement). */
export const SURFACES: { id: Exclude<SurfaceId, 'compte'>; label: string }[] = [
  { id: 'salle', label: 'Salle' },
  { id: 'analyse', label: 'Analyse' },
  { id: 'seances', label: 'Séances' },
  { id: 'exercices', label: 'Exos' },
  { id: 'reglages', label: 'Réglages' },
];

export interface Route {
  page: string;
  params: Record<string, string>;
}

export interface Nav {
  surface: SurfaceId;
  route: Route;
  /** 0 à la racine de la surface. */
  depth: number;
  go: (surface: SurfaceId, page?: string, params?: Record<string, string>) => void;
  push: (page: string, params?: Record<string, string>) => void;
  back: () => void;
  reset: (page?: string, params?: Record<string, string>) => void;
}

export interface Settings {
  /** Couleur de signal (CSS). Toujours lue via var(--sig) dans le rendu. */
  sig: string;
  /** Nom affiché : « Jaune », « Autre couleur »… */
  sigName: string;
  /** Teinte OKLCH si teinte libre, null pour une prédéfinie. */
  sigHue: number | null;
  stepKg: number;
  reduceMotion: boolean;
  /** Commande du prototype : la règle de poids glisse jusqu'au cran touché
   *  (190 ms) au lieu d'y sauter. Désactivée par défaut, pour comparer. */
  rulerTapAnim: boolean;
}

export interface Account {
  phase: 'connecte' | 'deconnecte' | 'premier-lancement';
  email: string;
  /** Écritures locales qui attendent la synchro (outbox). */
  pendingSync: number;
  offline: boolean;
}

export interface Proto {
  settings: Settings;
  setSettings: (patch: Partial<Settings>) => void;
  account: Account;
  setAccount: (patch: Partial<Account>) => void;
  seance: SeanceStore;
}

export const NavContext = createContext<Nav | null>(null);
export const ProtoContext = createContext<Proto | null>(null);

export function useNav(): Nav {
  const n = useContext(NavContext);
  if (!n) throw new Error('useNav hors du shell E');
  return n;
}

export function useProto(): Proto {
  const p = useContext(ProtoContext);
  if (!p) throw new Error('useProto hors du shell E');
  return p;
}

/** Aiguillage des pages d'une surface. `index` est la racine ; une page inconnue
 *  retombe sur `index`. Chaque page est remontée à neuf quand la route change. */
export function Pages({ pages }: { pages: { index: (params: Record<string, string>) => ReactNode } & Record<string, (params: Record<string, string>) => ReactNode> }) {
  const { route, depth } = useNav();
  const render = pages[route.page] ?? pages.index;
  return <Fragment key={`${depth}:${route.page}:${JSON.stringify(route.params)}`}>{render(route.params)}</Fragment>;
}
