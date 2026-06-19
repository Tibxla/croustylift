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
    expect(bench.sets[0]).toEqual({ id: 'b1', weightKg: 80, reps: 8, rir: 2 });
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
});

describe('groupIntoLogicalSets', () => {
  it('bilatéral : une ligne = une série logique sur `both`', () => {
    const groups = groupIntoLogicalSets([mkSet('s1', 80, 8, 2), mkSet('s2', 80, 7, 1)]);
    expect(groups).toHaveLength(2);
    expect(groups[0].both?.id).toBe('s1');
    expect(groups[0].left).toBeNull();
    expect(groups[0].right).toBeNull();
  });

  it('unilatéral : la paire G/D forme UNE série logique (left + right)', () => {
    const groups = groupIntoLogicalSets([
      mkSide('l1', 'left', 16, 10, 2),
      mkSide('r1', 'right', 14, 10, 2),
      mkSide('l2', 'left', 16, 9, 1),
      mkSide('r2', 'right', 14, 9, 1),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].left?.id).toBe('l1');
    expect(groups[0].right?.id).toBe('r1');
    expect(groups[0].both).toBeNull();
    expect(groups[1].left?.id).toBe('l2');
    expect(groups[1].right?.id).toBe('r2');
  });

  it('unilatéral incomplet : un seul côté loggé reste une série (l’autre côté null)', () => {
    const groups = groupIntoLogicalSets([mkSide('l1', 'left', 16, 10, 2)]);
    expect(groups).toHaveLength(1);
    expect(groups[0].left?.id).toBe('l1');
    expect(groups[0].right).toBeNull();
  });
});
