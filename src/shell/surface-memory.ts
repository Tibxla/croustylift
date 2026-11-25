// Retour à l'endroit quitté entre les onglets : quelles surfaces restent
// montées, et où chacune avait laissé le défilement. Logique pure, sans React ni
// DOM ; `App.tsx` en tire le rendu et le défilement.
//
// POURQUOI GARDER MONTÉ : changer d'onglet démontait l'écran quitté. On perdait
// la série réglée et non loggée de la Salle, la page ouverte de Séances (et le
// brouillon de l'éditeur, que la garde de sortie proposait de jeter), la fiche
// et le filtre des Exos, la page d'un exo de l'Analyse. Une surface visitée
// reste donc montée, cachée (`inert`, hors de la mise en page), et réapparaît
// telle quelle : état React compris, brouillons compris.
//
// Le défilement est celui de la FENÊTRE, partagé par toutes les surfaces : il
// est noté au départ de chacune et rendu au retour.
//
// Deux exceptions :
//   - une surface dont la frontière d'erreur a attrapé un plantage (ou dont le
//     fichier n'a pas pu se charger) ne survit pas au changement d'onglet : elle
//     est démontée, et remontée à neuf au retour, comme avant ;
//   - une intention ponctuelle en attente pour la surface visée (« Voir au
//     Journal », shell/navigation.ts) prime sur la vue mémorisée : la surface
//     s'ouvre en haut, et c'est elle qui applique l'intention.
//
// Rien n'est stocké : la mémoire vit dans l'app authentifiée et part avec elle
// (déconnexion, changement de compte). La Salle retrouve sa vue après un
// rechargement par son propre état persisté (features/capture/state.ts).
import type { SurfaceName } from '../pwa/update';

export interface SurfaceMemory {
  /** La surface affichée. */
  current: SurfaceName;
  /** Les surfaces montées (affichée comprise), dans l'ordre de première visite. */
  mounted: readonly SurfaceName[];
  /** Génération de chaque surface : change quand elle est démontée sur erreur, pour la remonter à neuf. */
  epochs: Readonly<Partial<Record<SurfaceName, number>>>;
  /** Défilement de la fenêtre à la sortie de chaque surface. */
  scrolls: Readonly<Partial<Record<SurfaceName, number>>>;
}

/** L'app s'ouvre sur `first`, seule montée. */
export function openMemory(first: SurfaceName): SurfaceMemory {
  return { current: first, mounted: [first], epochs: {}, scrolls: {} };
}

/** La clé React de la surface : la même tant qu'elle n'a pas été remontée. */
export function surfaceKey(memory: SurfaceMemory, surface: SurfaceName): string {
  return `${surface}:${memory.epochs[surface] ?? 0}`;
}

export interface SurfaceSwitch {
  /** La surface demandée. */
  to: SurfaceName;
  /** Le défilement de la fenêtre au moment du départ. */
  scrollY: number;
  /** Les surfaces dont la frontière d'erreur tient un plantage. */
  failed: readonly SurfaceName[];
  /** Une intention ponctuelle attend la surface demandée. */
  intent: boolean;
}

/**
 * Passe sur `to`. Rend la nouvelle mémoire et le défilement à poser une fois la
 * surface affichée : celui qu'elle avait laissé, 0 à la première visite, après
 * un plantage, sous une intention, ou sur un tap de l'onglet déjà affiché (qui
 * ramène en haut, comme avant).
 */
export function switchMemory(
  memory: SurfaceMemory,
  { to, scrollY, failed, intent }: SurfaceSwitch,
): { memory: SurfaceMemory; scrollTo: number } {
  if (to === memory.current) return { memory, scrollTo: 0 };

  const scrolls: Partial<Record<SurfaceName, number>> = { ...memory.scrolls, [memory.current]: scrollY };
  const epochs: Partial<Record<SurfaceName, number>> = { ...memory.epochs };
  let mounted = [...memory.mounted];
  for (const surface of failed) {
    if (!mounted.includes(surface)) continue;
    mounted = mounted.filter((s) => s !== surface);
    epochs[surface] = (epochs[surface] ?? 0) + 1;
    delete scrolls[surface];
  }
  if (intent) delete scrolls[to];
  if (!mounted.includes(to)) mounted.push(to);

  return {
    memory: { current: to, mounted, epochs, scrolls },
    scrollTo: scrolls[to] ?? 0,
  };
}

/**
 * Se déconnecter démonte tout : un brouillon tenu par un écran caché (éditeur de
 * séance, correction d'une séance passée, fiche ou note d'exo) serait perdu sans
 * que rien à l'écran ne le montre. Avant, on ne pouvait pas atteindre les
 * Réglages sans passer par la garde de sortie de l'éditeur. Les écrans qui en
 * portent un le déclarent par un blocage de rechargement préfixé `brouillon-`
 * (`useReloadBlockWhile`) : on le relit ici. Rend la raison du refus, ou `null`.
 */
export function draftSignOutRefusal(blockers: readonly string[]): string | null {
  if (!blockers.some((b) => b.startsWith('brouillon-'))) return null;
  return 'un brouillon n’est pas enregistré dans un autre onglet (séance, correction, exo ou note) : enregistre-le ou abandonne-le avant de te déconnecter.';
}

/**
 * La déconnexion gardée : refusée (rejet portant la raison) tant qu'un brouillon
 * est ouvert, MÊME forcée. Le forçage (« Me déconnecter et perdre ces saisies »)
 * ne vise que les écritures retenues de la file, déjà nommées sur son lien ; un
 * brouillon ne s'y voit pas, et partirait sans un mot.
 */
export async function guardSignOut<O>(
  signOut: (options: O) => Promise<void>,
  blockers: readonly string[],
  options: O,
): Promise<void> {
  const refusal = draftSignOutRefusal(blockers);
  if (refusal) throw new Error(refusal);
  await signOut(options);
}
