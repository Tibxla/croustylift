// Édition d'une séance PASSÉE (issue #38) : corriger le réalisé d'un jour
// antérieur — ajouter / modifier / supprimer les séries d'un exo déjà loggé.
//
// La Capture du jour est append-only (on logge série après série). Corriger une
// séance passée demande l'inverse : éditer EN PLACE une liste de séries déjà
// persistées, chacune portant son id réel. On modélise donc l'exo comme une
// liste d'`EditableSet` (id + valeurs), qu'on transforme par des helpers PURS
// (add / update / remove), puis on DÉRIVE par diff la liste minimale d'ops
// d'outbox à rejouer (cf. ADR 0003 : UUID client, upsert/delete par id,
// idempotent). On NE crée PAS de second chemin d'écriture : les ops produites
// sont exactement les `InsertSetOp` / `DeleteSetOp` de l'outbox de la capture.
//
// L'`order` n'est PAS porté par l'`EditableSet` pendant l'édition : il est
// RECOMPACTÉ à partir de la position dans la liste au moment d'écrire. Ainsi
// supprimer la série du milieu ne laisse jamais de trou dans les rangs.
//
// UNILATÉRAL (issue #38, ADR 0005) : une série d'un exo unilatéral tient sur
// DEUX lignes (un côté gauche, un côté droite) au MÊME `order`. Chaque ligne est
// un `EditableSet` portant son `side` ; les deux côtés d'une même série restent
// CONTIGUS dans la liste (le chargement les trie ainsi). Le recompactage groupe
// donc par SÉRIE LOGIQUE, pas par ligne : la paire G/D garde un `order` commun,
// le rang n'avance qu'au passage à la série logique suivante. Sans ce groupage,
// recompacter en 1..N par ligne dé-apparierait G/D et corromprait le côté faible.
import type { InsertSetOp, DeleteSetOp, OutboxOp } from './outbox';
import type { Side } from '../../domain/types';

/** Une série en cours d'édition : son id (réel si en base, client si neuve) + ses valeurs. */
export interface EditableSet {
  /**
   * Id de la ligne `performed_sets`. Pour une série déjà en base, c'est son id
   * RÉEL (chargé depuis Supabase) → l'upsert/delete par id vise la bonne ligne.
   * Pour une série ajoutée pendant l'édition, c'est un UUID client neuf (cf. ADR
   * 0003) → l'insert ne collisionne pas et le rejeu reste idempotent.
   */
  id: string;
  weightKg: number;
  reps: number;
  rir: number;
  /**
   * Côté pour un exo UNILATÉRAL (ADR 0005) : 'left'/'right'. Deux lignes d'une
   * même série partagent le même `order` recompacté et diffèrent par `side`.
   * Absent (`undefined`) pour un exo bilatéral (une série = une ligne). Porté de
   * bout en bout (chargement → diff → outbox) pour ne jamais dé-apparier G/D.
   */
  side?: Side;
}

/** Une série recompactée, avec son rang d'ordre (1..N) figé pour l'écriture. */
export interface OrderedEditableSet extends EditableSet {
  /** Rang d'ordre dans l'exo (à partir de 1), dérivé de la position. */
  order: number;
}

/** Les valeurs modifiables d'une série (tout sauf son id). */
export type SetValues = Pick<EditableSet, 'weightKg' | 'reps' | 'rir'>;

/** Le contexte d'écriture : à quelle exécution / exo ces séries appartiennent. */
export interface EditContext {
  /** Id de l'exécution passée éditée (FK des séries). Jamais changé par l'édition. */
  executionId: string;
  /** Id de l'exo dont on édite les séries. */
  exerciseId: string;
}

/** Une ligne plate `performed_sets` lue de la base, prête à grouper pour l'édition. */
export interface EditableSetRow extends EditableSet {
  exerciseId: string;
  exerciseName: string;
  /** Rang d'ordre tel qu'en base (sert au tri ; recompacté à l'écriture). */
  order: number;
}

/** Les séries éditables d'un exo dans l'exécution passée, dans l'ordre. */
export interface EditableExercise {
  exerciseId: string;
  name: string;
  /** Séries triées par order croissant, chacune avec son id réel. */
  sets: EditableSet[];
}

/** Rang de tri d'un côté : gauche (0) avant droite (1) à `order` égal. */
function sideRank(side: Side | undefined): number {
  return side === 'right' ? 1 : 0;
}

/**
 * Regroupe des lignes plates `(série, exo)` d'une exécution passée en exos
 * éditables : un exo par exerciseId, ses séries triées par order croissant puis
 * par côté (gauche avant droite, ADR 0005) pour que les deux lignes d'une série
 * unilatérale restent CONTIGUËS — le recompactage en dépend. L'order n'est plus
 * porté ensuite (il est recompacté à l'écriture), mais le `side` l'est, de bout
 * en bout. Exos triés par nom (locale fr) comme dans le journal. Pure (pas de
 * réseau) : la couche data ne fait que l'alimenter. Garde l'id RÉEL de chaque
 * série pour que l'édition vise la bonne ligne.
 */
export function groupSetsForEdit(rows: EditableSetRow[]): EditableExercise[] {
  const byExercise = new Map<string, { name: string; rows: EditableSetRow[] }>();
  for (const row of rows) {
    let group = byExercise.get(row.exerciseId);
    if (!group) {
      group = { name: row.exerciseName, rows: [] };
      byExercise.set(row.exerciseId, group);
    }
    group.rows.push(row);
  }

  const exercises: EditableExercise[] = [];
  for (const [exerciseId, group] of byExercise) {
    const sets = group.rows
      .slice()
      .sort((a, b) => a.order - b.order || sideRank(a.side) - sideRank(b.side))
      .map((r) => ({ id: r.id, weightKg: r.weightKg, reps: r.reps, rir: r.rir, side: r.side }));
    exercises.push({ exerciseId, name: group.name, sets });
  }

  exercises.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  return exercises;
}

/**
 * Ajoute une série à la FIN de la liste, avec l'id client fourni par le caller
 * (pour que l'état et l'op d'outbox partagent le même id, cf. ADR 0003).
 * Immutable.
 */
export function addSet(sets: EditableSet[], set: EditableSet): EditableSet[] {
  return [...sets, { ...set }];
}

/**
 * Modifie les valeurs (poids / reps / RIR) de la série ciblée par id, à sa
 * position. Sans effet si l'id est absent. Immutable.
 */
export function updateSet(
  sets: EditableSet[],
  id: string,
  values: SetValues,
): EditableSet[] {
  return sets.map((s) => (s.id === id ? { ...s, ...values } : s));
}

/** Supprime la série ciblée par id. Sans effet si l'id est absent. Immutable. */
export function removeSet(sets: EditableSet[], id: string): EditableSet[] {
  return sets.filter((s) => s.id !== id);
}

/**
 * Fige les rangs d'ordre par SÉRIE LOGIQUE (pas par ligne). À appeler juste
 * avant de comparer / d'écrire : c'est ce qui garantit des rangs contigus après
 * une suppression au milieu, SANS dé-apparier les côtés d'une série unilatérale.
 *
 *   - BILATÉRAL (ligne sans `side`) : une ligne = une série, le rang avance à
 *     chaque ligne — comportement strictement inchangé (1, 2, 3…).
 *   - UNILATÉRAL : les deux côtés (G/D) d'une même série sont CONTIGUS (le
 *     chargement les trie ainsi) et GARDENT un `order` commun. Le rang n'avance
 *     qu'au passage à la série logique SUIVANTE, détectée quand on rencontre un
 *     côté DÉJÀ vu dans la série courante (ou une ligne bilatérale).
 *
 * Le regroupement s'appuie sur la contiguïté G/D et sur `side` (le seul indice
 * porté ici), pas sur l'order d'origine : c'est l'invariant que `groupSetsForEdit`
 * et l'UI d'édition maintiennent (toujours une PAIRE complète, jamais réordonnée
 * côté par côté). Immutable.
 */
export function reorderSets(sets: EditableSet[]): OrderedEditableSet[] {
  const ordered: OrderedEditableSet[] = [];
  let order = 0;
  let sidesInCurrent: Side[] = [];

  for (const s of sets) {
    // Nouvelle série logique si : ligne bilatérale, première ligne, ou côté déjà
    // présent dans la série courante (les deux côtés d'une paire sont distincts).
    const startsNewSet =
      s.side === undefined || order === 0 || sidesInCurrent.includes(s.side);
    if (startsNewSet) {
      order += 1;
      sidesInCurrent = [];
    }
    if (s.side !== undefined) sidesInCurrent.push(s.side);
    ordered.push({ ...s, order });
  }

  return ordered;
}

/** Une série LOGIQUE : son rang + ses lignes (1 si bilatéral, 2 côtés si unilatéral). */
export interface LogicalSet {
  /** Rang d'ordre (1..N) de la série, partagé par ses deux côtés en unilatéral. */
  order: number;
  /** Le côté gauche (unilatéral), ou `null` s'il manque / si bilatéral. */
  left: EditableSet | null;
  /** Le côté droite (unilatéral), ou `null` s'il manque / si bilatéral. */
  right: EditableSet | null;
  /** La ligne unique d'une série BILATÉRALE, ou `null` si unilatérale. */
  both: EditableSet | null;
}

/**
 * Regroupe des lignes éditables en SÉRIES LOGIQUES pour l'affichage et le
 * décompte : une série bilatérale tient sur `both`, une série unilatérale sur
 * `left`/`right` (mêmes paires que `reorderSets`, même rang). Garde l'ordre des
 * séries. Pur — sert l'UI d'édition (un bloc par série) et le chiffrage de la
 * suppression (compter les séries, pas les lignes). N'invente jamais un côté
 * manquant : une paire incomplète reste affichée telle quelle (côté à `null`).
 */
export function groupIntoLogicalSets(sets: EditableSet[]): LogicalSet[] {
  const byOrder = new Map<number, LogicalSet>();
  for (const s of reorderSets(sets)) {
    let group = byOrder.get(s.order);
    if (!group) {
      group = { order: s.order, left: null, right: null, both: null };
      byOrder.set(s.order, group);
    }
    if (s.side === 'left') group.left = s;
    else if (s.side === 'right') group.right = s;
    else group.both = s;
  }
  return [...byOrder.values()].sort((a, b) => a.order - b.order);
}

/**
 * Dérive la liste MINIMALE d'ops d'outbox pour passer de l'état `original`
 * (séries telles qu'en base) à l'état `edited` (après éditions de l'user) :
 *
 *   - série présente dans `original` mais absente d'`edited`  -> `deleteSet`
 *   - série présente dans `edited` mais absente d'`original`  -> `insertSet` (neuve)
 *   - série présente dans les deux mais dont une valeur OU l'order change
 *                                                            -> `insertSet` (upsert par id)
 *   - série identique (mêmes valeurs ET même order)          -> aucune op
 *
 * Les `insertSet` portent l'`order` RECOMPACTÉ (1..N) de l'état édité, jamais
 * l'ancien. Les `deleteSet` sont placés AVANT les `insertSet` : comme le flush
 * est FIFO et peut s'interrompre entre deux ops (coupure réseau), libérer
 * d'abord les rangs supprimés évite qu'une série conservée glissée sur un rang
 * tout juste libéré le partage TRANSITOIREMENT avec la série qu'on s'apprête à
 * supprimer (rangs cohérents à chaque étape intermédiaire, pas seulement à la
 * fin). Pure, sans réseau ni mutation.
 */
export function diffSetsToOps(
  original: EditableSet[],
  edited: EditableSet[],
  ctx: EditContext,
): OutboxOp[] {
  const orderedEdited = reorderSets(edited);
  // `original` est recompacté de la MÊME façon (par série logique) pour comparer
  // des orders comparables : sinon, sur un exo unilatéral, l'order par série de
  // l'édité ne collerait jamais à un order par ligne de l'origine et chaque côté
  // droit serait à tort ré-affirmé.
  const originalById = new Map(reorderSets(original).map((s) => [s.id, s]));
  const editedIds = new Set(edited.map((s) => s.id));

  const deletes: DeleteSetOp[] = [];
  const inserts: InsertSetOp[] = [];

  // Suppressions : tout id d'origine absent de l'état édité.
  for (const s of original) {
    if (!editedIds.has(s.id)) {
      deletes.push({ type: 'deleteSet', id: s.id });
    }
  }

  // Insertions / mises à jour : série neuve, ou série existante qui a changé
  // (une valeur, son côté, ou son rang). On rejoue par upsert (idempotent par id).
  for (const s of orderedEdited) {
    const before = originalById.get(s.id);
    const unchanged =
      before !== undefined &&
      before.weightKg === s.weightKg &&
      before.reps === s.reps &&
      before.rir === s.rir &&
      before.side === s.side &&
      before.order === s.order;
    if (unchanged) continue;
    inserts.push({
      type: 'insertSet',
      id: s.id,
      executionId: ctx.executionId,
      exerciseId: ctx.exerciseId,
      setOrder: s.order,
      weightKg: s.weightKg,
      reps: s.reps,
      rir: s.rir,
      // `side` porté de bout en bout (ADR 0005) : `undefined` pour le bilatéral
      // (l'outbox/`upsertSet` l'écrit `null`), 'left'/'right' pour l'unilatéral.
      side: s.side,
    });
  }

  // Deletes d'abord (libère les rangs), puis inserts (occupe les rangs).
  return [...deletes, ...inserts];
}
