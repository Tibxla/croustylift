// Quitter la séance, joué jusqu'à la base à travers la vraie file. Deux
// « onglets » = deux états de capture sur la même file et la même base. La base
// est simulée : exécutions, séries, et la suppression conditionnelle (0025).
import { beforeEach, describe, expect, it } from 'vitest';
import { upperA } from './fixtures';
import { clearQueue, enqueueAll, flush, purgeByExecution, readQueue, type OutboxOp, type SyncFns } from './outbox';
import { leaveSession, type LeaveSessionPlan } from './session-gestures';
import { captureReducer, initialState, type CaptureState } from './state';

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(k: string): string | null {
    return this.store.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.store.set(k, String(v));
  }
  removeItem(k: string): void {
    this.store.delete(k);
  }
  get length(): number {
    return this.store.size;
  }
  key(i: number): string | null {
    return [...this.store.keys()][i] ?? null;
  }
}

const EXEC = 'exec-1';
const BENCH = 'bench-press';

/** La base : exécutions (ouvertes ou closes) et séries, avec la cascade. */
function fakeBase() {
  const executions = new Map<string, { closed: boolean }>();
  const sets = new Map<string, string>();
  const ok = async () => {};
  const fns = {
    upsertExecution: async (op: { id: string }) => {
      if (!executions.has(op.id)) executions.set(op.id, { closed: false });
    },
    insertSet: async (op: { id: string; executionId: string }) => {
      if (!executions.has(op.executionId)) throw { code: '23503', message: 'clé étrangère' };
      sets.set(op.id, op.executionId);
    },
    patchSet: ok,
    deleteSet: async (op: { id: string }) => void sets.delete(op.id),
    updateExecution: ok,
    upsertDatedNote: ok,
    deleteDatedNote: ok,
    upsertExerciseNote: ok,
    deleteExerciseNote: ok,
    deleteExecution: async (op: { id: string }) => {
      executions.delete(op.id);
      for (const [id, executionId] of sets) if (executionId === op.id) sets.delete(id);
    },
    deleteExecutionIfEmpty: async (op: { id: string }) => {
      const execution = executions.get(op.id);
      if (!execution || execution.closed) return;
      if ([...sets.values()].includes(op.id)) return;
      executions.delete(op.id);
    },
  } as unknown as SyncFns;
  return { fns, executions, sets };
}

const fresh = (): CaptureState => ({ ...initialState(upperA, '2026-11-25'), executionId: EXEC });
const setOp = (id: string): OutboxOp => ({
  type: 'insertSet',
  id,
  executionId: EXEC,
  exerciseId: BENCH,
  setOrder: 1,
  weightKg: 80,
  reps: 8,
  rir: 2,
});
const born: OutboxOp = { type: 'upsertExecution', id: EXEC, seanceVersionId: 'v1', performedOn: '2026-11-25' };

/** L'onglet A a loggé puis supprimé sa seule série : tableau vide, exécution née. */
function emptied(): CaptureState {
  const logged = captureReducer(fresh(), {
    type: 'log-set',
    exerciseId: BENCH,
    setId: 'a1',
    set: { weightKg: 80, reps: 8, rir: 2 },
  });
  return captureReducer(logged, { type: 'undo-last-set', exerciseId: BENCH });
}

/** Ce que l'écran déroule pour un plan (cf. en-tête de session-gestures.ts). */
function quit(plan: LeaveSessionPlan): void {
  if (plan.purge) purgeByExecution(plan.executionId);
  enqueueAll(plan.ops);
}

beforeEach(() => {
  (globalThis as unknown as { localStorage: Storage }).localStorage = new MemoryStorage() as unknown as Storage;
  clearQueue();
});

describe('changer de séance quand un autre onglet a saisi dans la même exécution', () => {
  it('saisie de B encore en file, visible au moment du plan : A doit confirmer (« annuler »)', () => {
    enqueueAll([setOp('b1')]);
    const plan = leaveSession(emptied(), { executionStarted: true, pendingOps: readQueue() });
    expect(plan.kind).toBe('cancel');
    expect(plan.needsConfirmation).toBe(true);
  });

  it('série loggée puis annulée ICI, encore en file : ce n’est pas une saisie à perdre', () => {
    enqueueAll([born, setOp('a1'), { type: 'deleteSet', id: 'a1' }]);
    const plan = leaveSession(emptied(), { executionStarted: true, pendingOps: readQueue() });
    expect(plan.kind).toBe('change');
  });

  it('saisie de B enfilée APRÈS le plan : « changer » ne purge rien, la série de B arrive en base et y reste', async () => {
    const base = fakeBase();
    base.executions.set(EXEC, { closed: false });
    const plan = leaveSession(emptied(), { executionStarted: true, pendingOps: readQueue() });
    expect(plan.kind).toBe('change');
    enqueueAll([setOp('b1')]);
    quit(plan);
    await flush(base.fns);
    expect([...base.sets.keys()]).toEqual(['b1']);
    expect(base.executions.has(EXEC)).toBe(true);
  });

  it('saisie de B acquittée juste avant : la suppression conditionnelle laisse l’exécution et sa série', async () => {
    const base = fakeBase();
    base.executions.set(EXEC, { closed: false });
    base.sets.set('b1', EXEC);
    quit(leaveSession(emptied(), { executionStarted: true }));
    await flush(base.fns);
    expect([...base.sets.keys()]).toEqual(['b1']);
    expect(base.executions.has(EXEC)).toBe(true);
  });

  it('personne d’autre : l’exécution née et vide est bien supprimée, écritures en file comprises', async () => {
    const base = fakeBase();
    enqueueAll([born, setOp('a1'), { type: 'deleteSet', id: 'a1' }]);
    quit(leaveSession(emptied(), { executionStarted: true, pendingOps: readQueue() }));
    await flush(base.fns);
    expect(base.executions.size).toBe(0);
    expect(base.sets.size).toBe(0);
    expect(readQueue()).toEqual([]);
  });

  it('une exécution close n’est jamais supprimée par « changer »', async () => {
    const base = fakeBase();
    base.executions.set(EXEC, { closed: true });
    quit(leaveSession(emptied(), { executionStarted: true }));
    await flush(base.fns);
    expect(base.executions.has(EXEC)).toBe(true);
  });

  it('« annuler », confirmé : purge et suppression sans condition, comme avant', async () => {
    const base = fakeBase();
    base.executions.set(EXEC, { closed: false });
    base.sets.set('a1', EXEC);
    const logged = captureReducer(fresh(), {
      type: 'log-set',
      exerciseId: BENCH,
      setId: 'a1',
      set: { weightKg: 80, reps: 8, rir: 2 },
    });
    const plan = leaveSession(logged, { executionStarted: true });
    expect(plan).toMatchObject({ kind: 'cancel', purge: true });
    expect(plan.ops.map((op) => op.type)).toEqual(['deleteExecution']);
    quit(plan);
    await flush(base.fns);
    expect(base.executions.size).toBe(0);
    expect(base.sets.size).toBe(0);
  });
});

// Série loggée, annulée, acquittements reçus, puis la Salle est remontée hors
// ligne : le cache rend l'id de l'exécution, zéro série, zéro note, file vide.
// Plus rien ne dit à l'écran que l'exécution existe en base.
describe('exécution vidée, restée ouverte en base, naissance oubliée au remontage', () => {
  it('« changer » demande quand même sa suppression : elle est vide, elle part', async () => {
    const base = fakeBase();
    base.executions.set(EXEC, { closed: false });
    const plan = leaveSession(fresh(), { executionStarted: false, pendingOps: readQueue() });
    expect(plan.kind).toBe('change');
    quit(plan);
    await flush(base.fns);
    expect(base.executions.size).toBe(0);
  });

  it('la même demande sur une exécution jamais née : sans effet', async () => {
    const base = fakeBase();
    quit(leaveSession(fresh(), { executionStarted: false }));
    await flush(base.fns);
    expect(base.executions.size).toBe(0);
    expect(readQueue()).toEqual([]);
  });

  it('si une série y est arrivée d’ailleurs entre-temps, elle reste', async () => {
    const base = fakeBase();
    base.executions.set(EXEC, { closed: false });
    base.sets.set('b1', EXEC);
    quit(leaveSession(fresh(), { executionStarted: false }));
    await flush(base.fns);
    expect(base.executions.has(EXEC)).toBe(true);
    expect([...base.sets.keys()]).toEqual(['b1']);
  });

  it('« annuler » (un exo ajouté, aucune série), confirmé : l’exécution vidée part aussi', async () => {
    const base = fakeBase();
    base.executions.set(EXEC, { closed: false });
    const state = captureReducer(fresh(), {
      type: 'edit-layout',
      edit: { kind: 'added', exerciseId: 'curl', name: 'Curl', unilateral: false, primaryMuscles: [] },
    });
    const plan = leaveSession(state, { executionStarted: false });
    expect(plan.kind).toBe('cancel');
    quit(plan);
    await flush(base.fns);
    expect(base.executions.size).toBe(0);
  });
});
