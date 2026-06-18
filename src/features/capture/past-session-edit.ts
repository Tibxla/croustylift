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
// RECOMPACTÉ (1..N) à partir de la position dans la liste au moment d'écrire.
// Ainsi supprimer la série du milieu ne laisse jamais de trou dans les rangs.
import type { InsertSetOp, DeleteSetOp, OutboxOp } from './outbox';

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

/**
 * Regroupe des lignes plates `(série, exo)` d'une exécution passée en exos
 * éditables : un exo par exerciseId, ses séries triées par order croissant
 * (l'order n'est plus porté ensuite — il est recompacté à l'écriture), exos
 * triés par nom (locale fr) comme dans le journal. Pure (pas de réseau) : la
 * couche data ne fait que l'alimenter. Garde l'id RÉEL de chaque série pour que
 * l'édition vise la bonne ligne.
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
      .sort((a, b) => a.order - b.order)
      .map((r) => ({ id: r.id, weightKg: r.weightKg, reps: r.reps, rir: r.rir }));
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
 * Fige les rangs d'ordre à partir de la position (1..N). À appeler juste avant
 * de comparer / d'écrire : c'est ce qui garantit des rangs contigus après une
 * suppression au milieu. Immutable.
 */
export function reorderSets(sets: EditableSet[]): OrderedEditableSet[] {
  return sets.map((s, i) => ({ ...s, order: i + 1 }));
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
  const originalById = new Map(original.map((s) => [s.id, s]));
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
  // (une valeur ou son rang). On rejoue par upsert (idempotent par id).
  for (const s of orderedEdited) {
    const before = originalById.get(s.id);
    const unchanged =
      before !== undefined &&
      before.weightKg === s.weightKg &&
      before.reps === s.reps &&
      before.rir === s.rir &&
      // `before` n'a pas d'order explicite : on le compare au rang qu'il avait
      // dans `original` (sa position d'origine), recompacté de la même façon.
      originalOrderOf(original, s.id) === s.order;
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
    });
  }

  // Deletes d'abord (libère les rangs), puis inserts (occupe les rangs).
  return [...deletes, ...inserts];
}

/** Rang (1..N) qu'avait la série `id` dans la liste d'origine, ou -1 si absente. */
function originalOrderOf(original: EditableSet[], id: string): number {
  const idx = original.findIndex((s) => s.id === id);
  return idx === -1 ? -1 : idx + 1;
}
