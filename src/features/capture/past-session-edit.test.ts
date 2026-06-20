// Édition d'une séance PASSÉE (issue #38) : corriger le réalisé d'un jour
// antérieur — ajouter / modifier / supprimer des séries d'un exo déjà loggé.
//
// Logique PURE : on part des séries telles qu'elles sont en base (avec leur id
// réel), on applique les éditions de l'utilisateur, puis on DÉRIVE par diff la
// liste minimale d'ops d'outbox (cf. ADR 0003 : UUID client, upsert/delete par
// id, idempotent). Aucune écriture concurrente : on réutilise insertSet/deleteSet
// de l'outbox existant. Pas de Supabase, pas de React.
import { describe, it, expect } from 'vitest';
import {
  addSet,
  updateSet,
  removeSet,
  reorderSets,
  diffSetsToOps,
  groupSetsForEdit,
  groupIntoLogicalSets,
  buildExecutionMetricsOp,
  type EditableSet,
  type EditableSetRow,
} from './past-session-edit';
import type { InsertSetOp, DeleteSetOp } from './outbox';
import type { Side } from '../../domain/types';

// --- Fabriques ---------------------------------------------------------------

const mkSet = (id: string, weightKg: number, reps: number, rir: number): EditableSet => ({
  id,
  weightKg,
  reps,
  rir,
});

/** Une ligne unilatérale : comme `mkSet` mais avec son côté (G ou D). */
const mkSide = (
  id: string,
  side: Side,
  weightKg: number,
  reps: number,
  rir: number,
): EditableSet => ({ id, weightKg, reps, rir, side });

/**
 * Une ligne unilatérale CHARGÉE DEPUIS LA BASE : `mkSide` + son `sourceOrder`
 * (le set_order d'origine, ancre du regroupement en série logique, ADR 0005).
 * Simule ce que `groupSetsForEdit` porte ; les lignes neuves (via `mkSide`) n'en
 * ont pas.
 */
const mkAt = (
  id: string,
  side: Side,
  sourceOrder: number,
  weightKg: number,
  reps: number,
  rir: number,
): EditableSet => ({ id, weightKg, reps, rir, side, sourceOrder });

// Trois séries « en base » d'un exo (ids réels, comme renvoyés par le chargement).
const original = (): EditableSet[] => [
  mkSet('s1', 80, 8, 2),
  mkSet('s2', 80, 7, 1),
  mkSet('s3', 77.5, 8, 1),
];

// --- addSet ------------------------------------------------------------------

describe('addSet', () => {
  it('ajoute une série à la fin avec l’id client fourni', () => {
    const next = addSet(original(), mkSet('new-1', 75, 10, 2));
    expect(next.map((s) => s.id)).toEqual(['s1', 's2', 's3', 'new-1']);
    expect(next[3]).toEqual({ id: 'new-1', weightKg: 75, reps: 10, rir: 2 });
  });

  it('ne mute pas la liste d’origine (immutabilité)', () => {
    const sets = original();
    addSet(sets, mkSet('new-1', 75, 10, 2));
    expect(sets).toHaveLength(3);
  });
});

// --- updateSet ---------------------------------------------------------------

describe('updateSet', () => {
  it('modifie les valeurs de la série ciblée par id, à sa position', () => {
    const next = updateSet(original(), 's2', { weightKg: 82.5, reps: 8, rir: 2 });
    expect(next[1]).toEqual({ id: 's2', weightKg: 82.5, reps: 8, rir: 2 });
    expect(next.map((s) => s.id)).toEqual(['s1', 's2', 's3']);
  });

  it('est sans effet si l’id cible est absent', () => {
    const next = updateSet(original(), 'inconnu', { weightKg: 100, reps: 1, rir: 0 });
    expect(next).toEqual(original());
  });

  it('ne mute pas la liste d’origine', () => {
    const sets = original();
    updateSet(sets, 's1', { weightKg: 1, reps: 1, rir: 0 });
    expect(sets[0]).toEqual(mkSet('s1', 80, 8, 2));
  });
});

// --- removeSet ---------------------------------------------------------------

describe('removeSet', () => {
  it('supprime la série ciblée par id', () => {
    const next = removeSet(original(), 's2');
    expect(next.map((s) => s.id)).toEqual(['s1', 's3']);
  });

  it('est sans effet si l’id cible est absent', () => {
    const next = removeSet(original(), 'inconnu');
    expect(next.map((s) => s.id)).toEqual(['s1', 's2', 's3']);
  });

  it('ne mute pas la liste d’origine', () => {
    const sets = original();
    removeSet(sets, 's1');
    expect(sets).toHaveLength(3);
  });
});

// --- reorderSets -------------------------------------------------------------

describe('reorderSets', () => {
  it('attribue order = position + 1 (recompactage 1..N)', () => {
    const ordered = reorderSets([mkSet('a', 1, 1, 1), mkSet('b', 2, 2, 2)]);
    expect(ordered).toEqual([
      { id: 'a', weightKg: 1, reps: 1, rir: 1, order: 1 },
      { id: 'b', weightKg: 2, reps: 2, rir: 2, order: 2 },
    ]);
  });

  it('recompacte après suppression (pas de trou dans les order)', () => {
    const edited = removeSet(original(), 's2'); // reste s1, s3
    const ordered = reorderSets(edited);
    expect(ordered.map((s) => s.order)).toEqual([1, 2]);
    expect(ordered.map((s) => s.id)).toEqual(['s1', 's3']);
  });

  // --- Unilatéral : la paire G/D garde un order COMMUN (ADR 0005) ------------

  it('unilatéral : les deux côtés d’une série partagent le même order', () => {
    // 2 séries unilatérales = 4 lignes, G/D contigus par série.
    const ordered = reorderSets([
      mkSide('l1', 'left', 30, 10, 2),
      mkSide('r1', 'right', 28, 10, 2),
      mkSide('l2', 'left', 30, 9, 1),
      mkSide('r2', 'right', 28, 9, 1),
    ]);
    expect(ordered.map((s) => s.order)).toEqual([1, 1, 2, 2]);
    expect(ordered.map((s) => s.side)).toEqual(['left', 'right', 'left', 'right']);
  });

  it('unilatéral : commencer par la droite ne casse pas l’appariement', () => {
    const ordered = reorderSets([
      mkSide('r1', 'right', 28, 10, 2),
      mkSide('l1', 'left', 30, 10, 2),
      mkSide('r2', 'right', 28, 9, 1),
      mkSide('l2', 'left', 30, 9, 1),
    ]);
    expect(ordered.map((s) => s.order)).toEqual([1, 1, 2, 2]);
  });

  it('unilatéral : supprimer une paire ne laisse pas de trou dans les order', () => {
    let edited: EditableSet[] = [
      mkSide('l1', 'left', 30, 10, 2),
      mkSide('r1', 'right', 28, 10, 2),
      mkSide('l2', 'left', 30, 9, 1),
      mkSide('r2', 'right', 28, 9, 1),
    ];
    // L'UI supprime la série 1 en entier (les deux côtés).
    edited = removeSet(removeSet(edited, 'l1'), 'r1');
    const ordered = reorderSets(edited);
    expect(ordered.map((s) => s.id)).toEqual(['l2', 'r2']);
    expect(ordered.map((s) => s.order)).toEqual([1, 1]);
  });

  it('unilatéral : une série entamée d’un seul côté reste sa propre série', () => {
    // Série 1 complète (G+D), série 2 incomplète (G seul) : 2 rangs distincts.
    const ordered = reorderSets([
      mkSide('l1', 'left', 30, 10, 2),
      mkSide('r1', 'right', 28, 10, 2),
      mkSide('l2', 'left', 30, 9, 1),
    ]);
    expect(ordered.map((s) => s.order)).toEqual([1, 1, 2]);
  });

  // --- Côté ORPHELIN ancré sur `sourceOrder` (bug H3) -----------------------
  // Régression : une série INCOMPLÈTE (un seul côté loggé, ADR 0005) chargée
  // depuis la base apparaît AVANT une série complète au tri par set_order. Sans
  // ancrage sur l'order d'origine, le recompactage par contiguïté fusionnait le
  // côté orphelin (D de S1) avec le premier côté de la série suivante (G de S2),
  // produisant une paire fausse — côté faible / décompte / courbe e1RM faux.

  it('unilatéral : un côté orphelin (série incomplète) n’est pas fusionné avec la série suivante', () => {
    // Base : right@1 (incomplète, D seul), puis left@2 + right@2 (complète).
    // Tri de chargement par (order, côté G<D) -> [r1, l2, r2].
    const ordered = reorderSets([
      mkAt('r1', 'right', 1, 28, 10, 2),
      mkAt('l2', 'left', 2, 30, 9, 1),
      mkAt('r2', 'right', 2, 28, 9, 1),
    ]);
    // r1 (sourceOrder 1) reste seul -> rang 1 ; l2+r2 (sourceOrder 2) -> rang 2.
    expect(ordered.map((s) => s.id)).toEqual(['r1', 'l2', 'r2']);
    expect(ordered.map((s) => s.order)).toEqual([1, 2, 2]);
    // r1 n'est JAMAIS apparié au côté gauche d'une autre série.
    expect(ordered[0]!.side).toBe('right');
  });

  it('unilatéral : deux séries incomplètes du même côté restent deux séries', () => {
    // left@1 (D manque), left@2 (D manque) : sans `sourceOrder`, la contiguïté
    // les sépare déjà ; avec, l'ancre confirme deux rangs distincts.
    const ordered = reorderSets([
      mkAt('l1', 'left', 1, 30, 10, 2),
      mkAt('l2', 'left', 2, 30, 9, 1),
    ]);
    expect(ordered.map((s) => s.order)).toEqual([1, 2]);
  });

  it('unilatéral : l’order d’origine prime sur la contiguïté si la base a des set_order non contigus', () => {
    // Deux paires complètes mais aux set_order 2 et 5 (trous en base après des
    // suppressions antérieures) : recompactées en rangs 1 et 2, paires intactes.
    const ordered = reorderSets([
      mkAt('l1', 'left', 2, 30, 10, 2),
      mkAt('r1', 'right', 2, 28, 10, 2),
      mkAt('l2', 'left', 5, 30, 9, 1),
      mkAt('r2', 'right', 5, 28, 9, 1),
    ]);
    expect(ordered.map((s) => s.order)).toEqual([1, 1, 2, 2]);
    expect(ordered.map((s) => s.side)).toEqual(['left', 'right', 'left', 'right']);
  });

  it('unilatéral : une paire neuve ajoutée après des séries chargées garde la paire collée', () => {
    // l1/r1 chargés (sourceOrder 1), puis l3/r3 ajoutés (pas de sourceOrder).
    const ordered = reorderSets([
      mkAt('l1', 'left', 1, 30, 10, 2),
      mkAt('r1', 'right', 1, 28, 10, 2),
      mkSide('l3', 'left', 30, 8, 1),
      mkSide('r3', 'right', 28, 8, 1),
    ]);
    expect(ordered.map((s) => s.order)).toEqual([1, 1, 2, 2]);
    expect(ordered.map((s) => s.id)).toEqual(['l1', 'r1', 'l3', 'r3']);
  });
});

// --- diffSetsToOps : le coeur (diff -> ops d'outbox) -------------------------

describe('diffSetsToOps', () => {
  const ctx = { executionId: 'exec-1', exerciseId: 'bench-press' };

  it('aucune édition -> aucune op (séance passée intacte)', () => {
    const ops = diffSetsToOps(original(), original(), ctx);
    expect(ops).toEqual([]);
  });

  it('série ajoutée -> un insertSet portant son id client, order = rang final', () => {
    const edited = addSet(original(), mkSet('new-1', 75, 10, 2));
    const ops = diffSetsToOps(original(), edited, ctx);
    expect(ops).toEqual<InsertSetOp[]>([
      {
        type: 'insertSet',
        id: 'new-1',
        executionId: 'exec-1',
        exerciseId: 'bench-press',
        setOrder: 4,
        weightKg: 75,
        reps: 10,
        rir: 2,
      },
    ]);
  });

  it('série modifiée -> un insertSet (upsert par id) avec les nouvelles valeurs', () => {
    const edited = updateSet(original(), 's2', { weightKg: 82.5, reps: 8, rir: 2 });
    const ops = diffSetsToOps(original(), edited, ctx);
    expect(ops).toEqual<InsertSetOp[]>([
      {
        type: 'insertSet',
        id: 's2',
        executionId: 'exec-1',
        exerciseId: 'bench-press',
        setOrder: 2,
        weightKg: 82.5,
        reps: 8,
        rir: 2,
      },
    ]);
  });

  it('série supprimée -> un deleteSet par id, et recompacte l’order des suivantes', () => {
    const edited = removeSet(original(), 's2'); // reste s1 (order 1), s3 (passe order 2)
    const ops = diffSetsToOps(original(), edited, ctx);
    // s2 supprimée ; s3 voit son order changer (3 -> 2) donc ré-affirmée.
    expect(ops).toContainEqual<DeleteSetOp>({ type: 'deleteSet', id: 's2' });
    expect(ops).toContainEqual<InsertSetOp>({
      type: 'insertSet',
      id: 's3',
      executionId: 'exec-1',
      exerciseId: 'bench-press',
      setOrder: 2,
      weightKg: 77.5,
      reps: 8,
      rir: 1,
    });
    // s1 n'a pas bougé (même order, mêmes valeurs) -> pas d'op.
    expect(ops.some((op) => op.type === 'insertSet' && op.id === 's1')).toBe(false);
  });

  it('met les deleteSet AVANT les insertSet (rangs cohérents même si le flush FIFO s’interrompt)', () => {
    // On supprime s1 : s2 -> order 1, s3 -> order 2. Le flush est FIFO et peut
    // couper entre deux ops : si l'insert (s2 @1) partait avant le delete (s1 @1),
    // s1 et s2 partageraient transitoirement le rang 1 en base. Delete d'abord.
    const edited = removeSet(original(), 's1');
    const ops = diffSetsToOps(original(), edited, ctx);
    const firstInsert = ops.findIndex((op) => op.type === 'insertSet');
    const lastDelete = ops.map((op) => op.type).lastIndexOf('deleteSet');
    expect(lastDelete).toBeLessThan(firstInsert);
  });

  it('cumule ajout + modif + suppression en une passe', () => {
    let edited = updateSet(original(), 's1', { weightKg: 85, reps: 8, rir: 2 });
    edited = removeSet(edited, 's3');
    edited = addSet(edited, mkSet('new-1', 70, 12, 1));
    const ops = diffSetsToOps(original(), edited, ctx);

    expect(ops).toContainEqual<DeleteSetOp>({ type: 'deleteSet', id: 's3' });
    expect(ops).toContainEqual<InsertSetOp>({
      type: 'insertSet',
      id: 's1',
      executionId: 'exec-1',
      exerciseId: 'bench-press',
      setOrder: 1,
      weightKg: 85,
      reps: 8,
      rir: 2,
    });
    expect(ops).toContainEqual<InsertSetOp>({
      type: 'insertSet',
      id: 'new-1',
      executionId: 'exec-1',
      exerciseId: 'bench-press',
      setOrder: 3,
      weightKg: 70,
      reps: 12,
      rir: 1,
    });
    // s2 inchangée (mêmes valeurs, même order 2) -> pas d'op.
    expect(ops.some((op) => op.type === 'insertSet' && op.id === 's2')).toBe(false);
  });

  it('idempotence : re-diff du même état édité produit exactement les mêmes ops', () => {
    const edited = addSet(original(), mkSet('new-1', 75, 10, 2));
    const a = diffSetsToOps(original(), edited, ctx);
    const b = diffSetsToOps(original(), edited, ctx);
    expect(a).toEqual(b);
  });

  it('ne touche jamais une autre exécution : les ops portent toutes le bon executionId', () => {
    let edited = addSet(original(), mkSet('new-1', 75, 10, 2));
    edited = removeSet(edited, 's2');
    const ops = diffSetsToOps(original(), edited, ctx);
    for (const op of ops) {
      if (op.type === 'insertSet') {
        expect(op.executionId).toBe('exec-1');
        expect(op.exerciseId).toBe('bench-press');
      }
    }
  });
});

// --- groupSetsForEdit : lignes plates de la base -> exos éditables -----------

describe('groupSetsForEdit', () => {
  const row = (
    id: string,
    exerciseId: string,
    exerciseName: string,
    order: number,
    weightKg: number,
    reps: number,
    rir: number,
  ): EditableSetRow => ({ id, exerciseId, exerciseName, order, weightKg, reps, rir });

  it('regroupe les séries par exo, triées par order, avec leur id réel', () => {
    const exercises = groupSetsForEdit([
      row('b2', 'bench', 'Développé couché', 2, 80, 7, 1),
      row('b1', 'bench', 'Développé couché', 1, 80, 8, 2),
      row('r1', 'row', 'Tirage', 1, 70, 10, 1),
    ]);
    expect(exercises).toHaveLength(2);
    const bench = exercises.find((e) => e.exerciseId === 'bench')!;
    expect(bench.name).toBe('Développé couché');
    expect(bench.sets.map((s) => s.id)).toEqual(['b1', 'b2']);
    // `sourceOrder` reporte le set_order d'origine (ancre du groupage en série
    // logique) ; `side` reste absent en bilatéral.
    expect(bench.sets[0]).toEqual({ id: 'b1', weightKg: 80, reps: 8, rir: 2, sourceOrder: 1 });
  });

  it('trie les exos par nom (locale fr)', () => {
    const exercises = groupSetsForEdit([
      row('z1', 'z', 'Zone', 1, 1, 1, 1),
      row('a1', 'a', 'Abdos', 1, 1, 1, 1),
    ]);
    expect(exercises.map((e) => e.name)).toEqual(['Abdos', 'Zone']);
  });

  it('liste vide -> aucun exo', () => {
    expect(groupSetsForEdit([])).toEqual([]);
  });

  it('unilatéral : porte `side` et garde les côtés contigus (gauche avant droite)', () => {
    const exercises = groupSetsForEdit([
      { id: 'r1', exerciseId: 'db', exerciseName: 'Curl haltère', order: 1, weightKg: 14, reps: 10, rir: 2, side: 'right' },
      { id: 'l1', exerciseId: 'db', exerciseName: 'Curl haltère', order: 1, weightKg: 16, reps: 10, rir: 2, side: 'left' },
    ]);
    const db = exercises.find((e) => e.exerciseId === 'db')!;
    expect(db.sets.map((s) => s.side)).toEqual(['left', 'right']);
    expect(db.sets.map((s) => s.id)).toEqual(['l1', 'r1']);
  });
});

// --- Unilatéral : `side` porté de bout en bout (ADR 0005) -------------------
//
// Le bug corrigé : éditer une séance passée d'un exo unilatéral écrasait `side`
// à null et dé-appariait G/D (côté faible faux, décompte cassé). Ces cas
// vérifient que le diff PRÉSERVE le côté et que la paire garde un order commun.

describe('diffSetsToOps (unilatéral)', () => {
  const ctx = { executionId: 'exec-1', exerciseId: 'db-curl' };

  // Une série unilatérale en base = deux lignes au même order, G puis D.
  const uni = (): EditableSet[] => [
    mkSide('l1', 'left', 16, 10, 2),
    mkSide('r1', 'right', 14, 10, 2),
    mkSide('l2', 'left', 16, 9, 1),
    mkSide('r2', 'right', 14, 9, 1),
  ];

  it('aucune édition -> aucune op (le `side` intact ne déclenche rien)', () => {
    expect(diffSetsToOps(uni(), uni(), ctx)).toEqual([]);
  });

  it('modifier un côté -> un insertSet portant son `side` et le bon order', () => {
    const edited = updateSet(uni(), 'l1', { weightKg: 18, reps: 10, rir: 2 });
    const ops = diffSetsToOps(uni(), edited, ctx);
    expect(ops).toEqual<InsertSetOp[]>([
      {
        type: 'insertSet',
        id: 'l1',
        executionId: 'exec-1',
        exerciseId: 'db-curl',
        setOrder: 1,
        weightKg: 18,
        reps: 10,
        rir: 2,
        side: 'left',
      },
    ]);
    // L'autre côté de la même série n'a pas bougé -> pas d'op (pas de ré-affirmation).
    expect(ops.some((op) => op.type === 'insertSet' && op.id === 'r1')).toBe(false);
  });

  it('supprimer une série entière (les deux côtés) -> deux deleteSet, paire suivante recompactée à order 1', () => {
    // L'UI supprime la série 1 G+D : restent l2/r2 qui passent de l'order 2 à 1.
    const edited = removeSet(removeSet(uni(), 'l1'), 'r1');
    const ops = diffSetsToOps(uni(), edited, ctx);
    expect(ops).toContainEqual<DeleteSetOp>({ type: 'deleteSet', id: 'l1' });
    expect(ops).toContainEqual<DeleteSetOp>({ type: 'deleteSet', id: 'r1' });
    // l2/r2 ré-affirmés au nouvel order 1, chacun avec SON côté préservé.
    expect(ops).toContainEqual<InsertSetOp>({
      type: 'insertSet',
      id: 'l2',
      executionId: 'exec-1',
      exerciseId: 'db-curl',
      setOrder: 1,
      weightKg: 16,
      reps: 9,
      rir: 1,
      side: 'left',
    });
    expect(ops).toContainEqual<InsertSetOp>({
      type: 'insertSet',
      id: 'r2',
      executionId: 'exec-1',
      exerciseId: 'db-curl',
      setOrder: 1,
      weightKg: 14,
      reps: 9,
      rir: 1,
      side: 'right',
    });
  });

  it('ajouter une paire en fin -> deux insertSet au même nouvel order, un par côté', () => {
    let edited = addSet(uni(), mkSide('l3', 'left', 16, 8, 1));
    edited = addSet(edited, mkSide('r3', 'right', 14, 8, 1));
    const ops = diffSetsToOps(uni(), edited, ctx);
    const l3 = ops.find((op) => op.type === 'insertSet' && op.id === 'l3') as InsertSetOp;
    const r3 = ops.find((op) => op.type === 'insertSet' && op.id === 'r3') as InsertSetOp;
    expect(l3.setOrder).toBe(3);
    expect(r3.setOrder).toBe(3);
    expect(l3.side).toBe('left');
    expect(r3.side).toBe('right');
  });

  // Bug H3 dans le diff : une exécution chargée avec une série incomplète (D
  // orphelin @1) puis une série complète (@2). Éditer le côté orphelin ne doit
  // ré-affirmer QUE lui, sans dé-apparier ni ré-affirmer la paire suivante.
  const incompleteUni = (): EditableSet[] =>
    groupSetsForEdit([
      { id: 'r1', exerciseId: 'db', exerciseName: 'Curl', order: 1, weightKg: 28, reps: 10, rir: 2, side: 'right' },
      { id: 'l2', exerciseId: 'db', exerciseName: 'Curl', order: 2, weightKg: 30, reps: 9, rir: 1, side: 'left' },
      { id: 'r2', exerciseId: 'db', exerciseName: 'Curl', order: 2, weightKg: 28, reps: 9, rir: 1, side: 'right' },
    ])[0]!.sets;

  it('série incomplète chargée -> aucune édition ne produit aucune op (appariement stable)', () => {
    const sets = incompleteUni();
    expect(diffSetsToOps(sets, sets, ctx)).toEqual([]);
  });

  it('modifier le côté orphelin -> ré-affirme ce côté seul, à son order 1, sans toucher la paire @2', () => {
    const sets = incompleteUni();
    const edited = updateSet(sets, 'r1', { weightKg: 30, reps: 10, rir: 2 });
    const ops = diffSetsToOps(sets, edited, ctx);
    const r1 = ops.find((op) => op.type === 'insertSet' && op.id === 'r1') as InsertSetOp;
    expect(r1.setOrder).toBe(1);
    expect(r1.side).toBe('right');
    // La paire complète @2 (recompactée order 2) n'a pas bougé -> pas d'op.
    expect(ops.some((op) => op.type === 'insertSet' && (op.id === 'l2' || op.id === 'r2'))).toBe(false);
  });
});

describe('groupIntoLogicalSets', () => {
  it('bilatéral : une ligne = une série logique sur `both`', () => {
    const groups = groupIntoLogicalSets([mkSet('s1', 80, 8, 2), mkSet('s2', 80, 7, 1)]);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.both?.id).toBe('s1');
    expect(groups[0]!.left).toBeNull();
    expect(groups[0]!.right).toBeNull();
  });

  it('unilatéral : la paire G/D forme UNE série logique (left + right)', () => {
    const groups = groupIntoLogicalSets([
      mkSide('l1', 'left', 16, 10, 2),
      mkSide('r1', 'right', 14, 10, 2),
      mkSide('l2', 'left', 16, 9, 1),
      mkSide('r2', 'right', 14, 9, 1),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.left?.id).toBe('l1');
    expect(groups[0]!.right?.id).toBe('r1');
    expect(groups[0]!.both).toBeNull();
    expect(groups[1]!.left?.id).toBe('l2');
    expect(groups[1]!.right?.id).toBe('r2');
  });

  it('unilatéral incomplet : un seul côté loggé reste une série (l’autre côté null)', () => {
    const groups = groupIntoLogicalSets([mkSide('l1', 'left', 16, 10, 2)]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.left?.id).toBe('l1');
    expect(groups[0]!.right).toBeNull();
  });

  // Bug H3 par le VRAI chemin de chargement : une série incomplète (D seul) en
  // base, suivie d'une série complète. Le groupage doit garder D@1 SEUL dans sa
  // série logique et apparier correctement G@2/D@2 — sans le fix, D@1 se
  // retrouvait dans la même série logique que G@2 (paire fausse, côté faible faux).
  it('unilatéral incomplet en base : le côté orphelin garde sa propre série logique', () => {
    const [exercise] = groupSetsForEdit([
      { id: 'r1', exerciseId: 'db', exerciseName: 'Curl haltère', order: 1, weightKg: 28, reps: 10, rir: 2, side: 'right' },
      { id: 'l2', exerciseId: 'db', exerciseName: 'Curl haltère', order: 2, weightKg: 30, reps: 9, rir: 1, side: 'left' },
      { id: 'r2', exerciseId: 'db', exerciseName: 'Curl haltère', order: 2, weightKg: 28, reps: 9, rir: 1, side: 'right' },
    ]);
    const groups = groupIntoLogicalSets(exercise!.sets);
    expect(groups).toHaveLength(2);
    // Série 1 : seulement le côté droit (orphelin), jamais apparié à un gauche.
    expect(groups[0]!.right?.id).toBe('r1');
    expect(groups[0]!.left).toBeNull();
    // Série 2 : la VRAIE paire G/D au même set_order d'origine.
    expect(groups[1]!.left?.id).toBe('l2');
    expect(groups[1]!.right?.id).toBe('r2');
  });
});

// --- Diff des MÉTRIQUES de fin (durée + BPM) d'une séance finie ---------------
//
// Édition durée/BPM d'une séance clôturée (PastSessionEditor). On dérive l'op
// `updateExecution` MINIMALE : seuls les champs réellement changés sont posés
// (un champ omis = colonne inchangée côté DB ; `bpmAvg: null` = BPM retiré).
// Durée toujours non-null (décision produit) ; BPM nullable (retirable).

describe('buildExecutionMetricsOp', () => {
  const exec = 'exec-1';

  it('renvoie null quand rien ne change', () => {
    const op = buildExecutionMetricsOp(
      exec,
      { bpmAvg: 130, durationMin: 60 },
      { bpmAvg: 130, durationMin: 60 },
    );
    expect(op).toBeNull();
  });

  it('ne pose QUE la durée quand seule la durée change', () => {
    const op = buildExecutionMetricsOp(
      exec,
      { bpmAvg: 130, durationMin: 60 },
      { bpmAvg: 130, durationMin: 72 },
    );
    expect(op).toEqual({ type: 'updateExecution', id: exec, durationMin: 72 });
  });

  it('pose le BPM ajouté (null -> valeur), durée inchangée omise', () => {
    const op = buildExecutionMetricsOp(
      exec,
      { bpmAvg: null, durationMin: 60 },
      { bpmAvg: 138, durationMin: 60 },
    );
    expect(op).toEqual({ type: 'updateExecution', id: exec, bpmAvg: 138 });
  });

  it('pose bpmAvg: null EXPLICITE quand le BPM est retiré (valeur -> null)', () => {
    const op = buildExecutionMetricsOp(
      exec,
      { bpmAvg: 138, durationMin: 60 },
      { bpmAvg: null, durationMin: 60 },
    );
    expect(op).toEqual({ type: 'updateExecution', id: exec, bpmAvg: null });
  });

  it('pose les deux champs quand durée ET BPM changent', () => {
    const op = buildExecutionMetricsOp(
      exec,
      { bpmAvg: 130, durationMin: 60 },
      { bpmAvg: 145, durationMin: 75 },
    );
    expect(op).toEqual({
      type: 'updateExecution',
      id: exec,
      durationMin: 75,
      bpmAvg: 145,
    });
  });

  it('pose la durée quand l’originale était null (séance close sans chrono)', () => {
    const op = buildExecutionMetricsOp(
      exec,
      { bpmAvg: null, durationMin: null },
      { bpmAvg: null, durationMin: 60 },
    );
    expect(op).toEqual({ type: 'updateExecution', id: exec, durationMin: 60 });
  });
});
