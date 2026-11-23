// Lecture COMPLÈTE d'une requête Supabase, page par page.
//
// PROBLÈME : PostgREST plafonne chaque réponse (« Max rows », 1000 par défaut
// sur un projet Supabase) et tronque EN SILENCE au-delà — ni erreur, ni indice
// dans la réponse. Toute lecture « tout l'historique » (journal, export, liste
// des exos entraînés, historique d'un exo) perdait donc des lignes passé ce
// seuil, dans un ordre non garanti.
//
// Ici : pagination PAR CURSEUR sur `id` (clé unique de toutes les tables), en
// boucle jusqu'à la page vide : chaque page demande « les lignes d'id supérieur
// au dernier reçu ». Deux choses à ne pas refaire :
//   - une pagination par OFFSET (`.range()`) : une écriture arrivée entre deux
//     pages décale la fenêtre — une ligne supprimée en fait sauter une autre,
//     une ligne insérée en fait relire une. Le curseur, lui, ne dépend que de la
//     dernière ligne reçue ;
// On s'arrête sur une page « courte » (moins de lignes que demandé) : c'est la
// fin, SANS requête de plus. Une page vide en plus coûtait un aller-retour qui,
// coupé, faisait échouer une lecture pourtant complète (Capture sans copie au
// premier montage). HYPOTHÈSE : le plafond « Max rows » du projet est au moins
// égal à `FETCH_PAGE_SIZE` (1000, défaut Supabase, vérifié en prod le
// 2026-11-23 : pages pleines de 1000). S'il était abaissé sous 1000, une page
// courte ne serait plus la fin : remonter alors `FETCH_PAGE_SIZE` au plafond.
//
// CONTRAT DE L'APPELANT : la requête sélectionne `id`, est triée par `id` SEUL
// (`.order('id')`), limitée à `limit`, et filtrée `id > after` quand `after`
// n'est pas nul (`afterId`). L'ordre métier se pose ensuite côté client
// (`inCreationOrder`, ou les tris du domaine).
//
// GARDE DE COMPTE : supabase-js résout le jeton à chaque requête. Si le compte
// connecté change pendant la lecture (Déconnexion puis Connexion), les pages
// suivantes liraient les lignes d'un AUTRE compte avec le curseur du premier.
// Le compte est donc relevé au départ et revérifié après chaque page (donc
// avant la suivante, et à la fin) : s'il a changé, la lecture lève une erreur,
// rien n'est rendu. Cf. lib/session-identity.
//
// LIMITE : chaque page est une requête à part. Ce n'est pas un instantané
// transactionnel — une ligne modifiée pendant la lecture peut être lue avant ou
// après sa modification. Aucune n'est sautée ni doublée.

import { sessionUserId } from './session-identity';

/** Taille de page demandée : le plafond par défaut de PostgREST chez Supabase. */
export const FETCH_PAGE_SIZE = 1000;

/**
 * Garde-fou contre une boucle sans fin (serveur qui ignorerait le curseur et
 * rendrait toujours la même page).
 */
const MAX_PAGES = 1000;

/** Ce que rend une page : la forme `{ data, error }` des builders supabase-js. */
export interface PageResult {
  data: unknown;
  error: unknown;
}

/** Pose le curseur sur une requête déjà triée par `id` : rien pour la première page. */
export function afterId<Q extends { gt(column: 'id', value: string): Q }>(
  query: Q,
  after: string | null,
): Q {
  return after === null ? query : query.gt('id', after);
}

/**
 * Lit toutes les lignes d'une requête en enchaînant les pages. `page` construit
 * et exécute la requête pour un curseur donné (`after` : l'id de la dernière
 * ligne reçue, `null` pour la première page) ; la première erreur est relancée
 * telle quelle (pas de résultat partiel). Le type des lignes est affirmé par
 * l'appelant, comme les `as` déjà posés sur les lectures jointes.
 */
export async function fetchAllRows<T extends { id: string }>(
  page: (after: string | null, limit: number) => PromiseLike<PageResult>,
  pageSize: number = FETCH_PAGE_SIZE,
): Promise<T[]> {
  const rows: T[] = [];
  let after: string | null = null;
  const owner = await sessionUserId();
  for (let pages = 0; pages < MAX_PAGES; pages += 1) {
    const { data, error } = await page(after, pageSize);
    if ((await sessionUserId()) !== owner) {
      throw new Error('Le compte connecté a changé pendant la lecture : résultat abandonné.');
    }
    if (error) throw error;
    const batch = (data ?? []) as T[];
    const last = batch[batch.length - 1];
    if (!last) return rows;
    if (last.id === after) break;
    rows.push(...batch);
    // Page courte = fin de la lecture (cf. en-tête : plafond serveur ≥ pageSize).
    if (batch.length < pageSize) return rows;
    after = last.id;
  }
  throw new Error('Lecture paginée interrompue : la requête ne progresse pas.');
}

/**
 * Remet des lignes dans leur ordre de SAISIE (`created_at`, `id` en départage).
 * La pagination trie par `id`, un UUID sans rapport avec le temps ; les lectures
 * dont un regroupement dépend de l'ordre d'arrivée des lignes repassent par ici.
 */
export function inCreationOrder<T extends { id: string; created_at: string }>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      a.created_at.localeCompare(b.created_at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}
