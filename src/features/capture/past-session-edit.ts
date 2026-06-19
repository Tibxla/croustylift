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
//
// L'appartenance d'une ligne à sa série logique s'ancre sur le `sourceOrder`
// (le `set_order` D'ORIGINE en base) quand il est connu, PAS sur la seule
// contiguïté de côtés. Une série unilatérale peut être INCOMPLÈTE (un seul côté
// loggé — autorisé, on peut commencer par la droite et laisser un côté) : si on
// regroupait par « nouveau côté = même série », un côté orphelin (ex. `right@1`)
// serait fusionné avec le côté d'une AUTRE série (`left@2`), produisant une paire
// fausse (D de S1 + G de S2) — côté faible / décompte / courbe e1RM faux
// durablement. Les deux côtés d'une vraie série partagent déjà le même
// `set_order` (invariant ADR 0005) : c'est lui qui définit la série logique. Les
// séries AJOUTÉES pendant l'édition n'ont pas de `sourceOrder` (lignes neuves) ;
// elles retombent sur le groupage par contiguïté + côté (la paire G/D que l'UI
// insère reste collée).
import type { InsertSetOp, DeleteSetOp, OutboxOp, UpdateExecutionOp } from './outbox';
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
  /**
   * Le `set_order` D'ORIGINE en base de cette ligne (issue #38, ADR 0005), porté
   * depuis le chargement. Sert UNIQUEMENT à regrouper les côtés d'une série
   * logique sans se fier à la contiguïté : les deux côtés d'une même série
   * partagent ce `sourceOrder` (invariant ADR 0005), donc un côté ORPHELIN
   * (série incomplète) n'est jamais fusionné avec le côté d'une autre série. Ce
   * n'est PAS le rang écrit : `reorderSets` recompacte en 1..N à part. Absent
   * (`undefined`) pour une série AJOUTÉE pendant l'édition (pas encore en base) ;
   * ces lignes neuves retombent sur le groupage par contiguïté + côté.
   */
  sourceOrder?: number;
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
 * unilatérale restent CONTIGUËS. Le rang écrit n'est plus porté ensuite (il est
 * recompacté à l'écriture), mais on GARDE l'order d'origine dans `sourceOrder`
 * (et le `side`) : c'est lui qui ancre le regroupement des côtés d'une série
 * logique, sans dépendre de la seule contiguïté (sinon un côté orphelin d'une
 * série incomplète serait fusionné avec une autre série). Exos triés par nom
 * (locale fr) comme dans le journal. Pure (pas de réseau) : la couche data ne
 * fait que l'alimenter. Garde l'id RÉEL de chaque série pour que l'édition vise
 * la bonne ligne.
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
      .map((r) => ({
        id: r.id,
        weightKg: r.weightKg,
        reps: r.reps,
        rir: r.rir,
        side: r.side,
        // Order d'origine en base : ancre du regroupement des côtés en série logique.
        sourceOrder: r.order,
      }));
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
 *   - UNILATÉRAL : les deux côtés (G/D) d'une même série partagent leur
 *     `sourceOrder` (le `set_order` d'origine, invariant ADR 0005) et GARDENT un
 *     `order` recompacté commun. Le rang n'avance qu'au passage à la série
 *     logique SUIVANTE, détectée par CHANGEMENT de `sourceOrder` — pas par la
 *     seule contiguïté de côtés. C'est ce qui protège un côté ORPHELIN (série
 *     incomplète, un seul côté loggé) : `right@1` suivi de `left@2`,`right@2`
 *     reste trois lignes sur DEUX séries logiques (le `right@1` orphelin n'est
 *     jamais fusionné avec le `left@2`), au lieu d'apparier à tort D de S1 + G
 *     de S2 — ce qui fausserait côté faible / décompte / courbe e1RM durablement.
 *
 * Les séries AJOUTÉES pendant l'édition n'ont pas de `sourceOrder` (pas encore en
 * base) : pour elles, le groupage retombe sur la contiguïté + côté (nouvelle
 * série au côté DÉJÀ vu dans la série neuve courante). L'UI insère toujours une
 * PAIRE G/D contiguë, donc ce fallback reste sûr. Immutable.
 */
export function reorderSets(sets: EditableSet[]): OrderedEditableSet[] {
  const ordered: OrderedEditableSet[] = [];
  let order = 0;
  // L'ancre de la série logique en cours : son `sourceOrder` si elle vient de la
  // base, `undefined` si elle est composée de lignes neuves (pas de sourceOrder).
  // `order === 0` distingue « aucune série en cours » de « série en cours neuve ».
  let currentSourceOrder: number | undefined;
  let sidesInCurrent: Side[] = [];

  for (const s of sets) {
    const startsNewSet =
      // Une ligne bilatérale est toujours sa propre série (un set = une ligne).
      s.side === undefined ||
      // Première ligne rencontrée : ouvre la première série.
      order === 0 ||
      // Ligne unilatérale issue de la base : nouvelle série dès que son
      // `sourceOrder` diffère de l'ancre courante (changement de set_order
      // d'origine) — y compris quand la série courante était neuve (sans ancre).
      (s.sourceOrder !== undefined && s.sourceOrder !== currentSourceOrder) ||
      // Ligne unilatérale neuve (pas de `sourceOrder`) : nouvelle série si la
      // série courante était ancrée sur la base, ou si ce côté y est déjà vu.
      (s.sourceOrder === undefined &&
        (currentSourceOrder !== undefined || sidesInCurrent.includes(s.side)));
    if (startsNewSet) {
      order += 1;
      sidesInCurrent = [];
      currentSourceOrder = s.sourceOrder;
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

// --- Diff des MÉTRIQUES de fin (durée + BPM) d'une séance finie ---------------
//
// Éditer la durée et le BPM moyen d'une séance CLÔTURÉE (PastSessionEditor) :
// on dérive l'op `updateExecution` MINIMALE, ne posant QUE les champs réellement
// changés. Un champ omis laisse la colonne intacte côté DB (`updateExecution`
// dans data.ts) ; `bpmAvg: null` EXPLICITE retire le BPM. La durée est toujours
// non-null côté éditeur (décision produit), le BPM est nullable (retirable).
// L'op réutilise EXACTEMENT le chemin d'écriture de la clôture (idempotent par id,
// ADR 0003/0009) — aucun second chemin. `null` renvoyé si rien n'a bougé (pas d'op).

/**
 * Dérive l'op `updateExecution` minimale pour passer des métriques `original`
 * (telles qu'en base) aux métriques `edited` (après édition). Ne pose QUE les
 * champs changés : la durée si elle diffère, le BPM si il diffère (y compris
 * `null` explicite quand il est retiré). `null` si durée ET BPM sont inchangés.
 * Pure, sans réseau ni mutation. On NE touche jamais `closedAt` : la séance reste
 * clôturée, on ne corrige que ses métriques.
 */
export function buildExecutionMetricsOp(
  executionId: string,
  original: { bpmAvg: number | null; durationMin: number | null },
  edited: { bpmAvg: number | null; durationMin: number },
): UpdateExecutionOp | null {
  const op: UpdateExecutionOp = { type: 'updateExecution', id: executionId };
  let changed = false;
  if (edited.durationMin !== original.durationMin) {
    op.durationMin = edited.durationMin;
    changed = true;
  }
  if (edited.bpmAvg !== original.bpmAvg) {
    // `null` EXPLICITE quand le BPM est retiré : la couche data n'efface la
    // colonne que sur un `null` posé (un champ `undefined` la laisserait intacte).
    op.bpmAvg = edited.bpmAvg;
    changed = true;
  }
  return changed ? op : null;
}
