// Le pied de l'instrument de la Salle joué comme l'écran le joue : ce que disent
// « Logger » et « Annuler » est ce que le moteur écrit (réducteur, vraie file).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PerformedSet } from '../../domain/types';
import { slotOfOrder } from '../../domain/unilateral';
import { upperA } from './fixtures';
import { clearQueue, enqueueAll, readQueue, type OutboxOp } from './outbox';
import { applySetGesture } from './apply-set-gesture';
import { footUndo, logLabel, logRank } from './salle-foot';
import { undoLastSet } from './set-gestures';
import { captureReducer, getProgress, initialState, type CaptureAction, type CaptureState } from './state';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));

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

const CURL = 'biceps-curl';
const BENCH = 'bench-press';
const ps = (order: number, side: 'left' | 'right', reps = 10): PerformedSet => ({ order, weightKg: 12, reps, rir: 2, side });

function withSets(exerciseId: string, sets: PerformedSet[], setIds: (string | null)[]): CaptureState {
  return {
    ...initialState(upperA, '2026-11-25'),
    executionId: 'exec-1',
    activeExerciseId: exerciseId,
    progress: { [exerciseId]: { sets, setIds, skipped: false } },
  };
}

function io() {
  const calls: string[] = [];
  return {
    calls,
    dispatch: vi.fn((action: CaptureAction) => calls.push(`dispatch:${action.type}`)),
    ensureExecution: vi.fn(() => calls.push('exécution')),
    enqueueGesture: vi.fn((ops: readonly OutboxOp[]) => {
      calls.push(`file:${ops.length}`);
      if (ops.length > 0) enqueueAll(ops);
    }),
  };
}

const queued = () => readQueue().map(({ _seq, _owner, _uid, _at, ...op }) => op);

beforeEach(() => {
  (globalThis as unknown as { localStorage: Storage }).localStorage = new MemoryStorage() as unknown as Storage;
  clearQueue();
});

describe('Annuler, dans le pied', () => {
  it('rien de loggé : pas d’Annuler, et le geste ne fait rien', () => {
    const state = withSets(BENCH, [], []);
    expect(footUndo(getProgress(state, BENCH))).toBeNull();
    expect(undoLastSet(state, BENCH)).toBeNull();
  });

  it('bilatéral : il nomme la dernière série, et c’est elle que le moteur retire et efface en base', () => {
    const sets: PerformedSet[] = [
      { order: 1, weightKg: 100, reps: 8, rir: 1 },
      { order: 2, weightKg: 100, reps: 7, rir: 1 },
    ];
    const state = withSets(BENCH, sets, ['s1', 's2']);
    expect(footUndo(getProgress(state, BENCH))).toEqual({ aria: 'Annuler la série 2', word: 'série 2' });

    const deps = io();
    const next = applySetGesture(state, undoLastSet(state, BENCH), deps);
    expect(deps.calls).toEqual(['dispatch:undo-last-set', 'file:1']);
    expect(queued()).toEqual([{ type: 'deleteSet', id: 's2', exerciseIds: [BENCH] }]);
    expect(getProgress(next, BENCH)).toEqual({ sets: [sets[0]], setIds: ['s1'], skipped: false });
  });

  it('unilatéral : il nomme le dernier CÔTÉ loggé, le seul que le moteur retire', () => {
    const state = withSets(CURL, [ps(1, 'left'), ps(1, 'right'), ps(2, 'left', 9)], ['l1', 'r1', 'l2']);
    expect(footUndo(getProgress(state, CURL))).toEqual({ aria: 'Annuler le côté gauche de la série 2', word: 'gauche' });

    const next = applySetGesture(state, undoLastSet(state, CURL), io());
    expect(queued()).toEqual([{ type: 'deleteSet', id: 'l2', exerciseIds: [CURL] }]);
    expect(getProgress(next, CURL).setIds).toEqual(['l1', 'r1']);
  });

  it('une série sans id (cache d’ancien format) s’annule en local, sans rien enfiler', () => {
    const state = withSets(BENCH, [{ order: 1, weightKg: 100, reps: 8, rir: 1 }], [null]);
    const deps = io();
    const next = applySetGesture(state, undoLastSet(state, BENCH), deps);
    expect(deps.calls).toEqual(['dispatch:undo-last-set', 'file:0']);
    expect(readQueue()).toEqual([]);
    expect(getProgress(next, BENCH).sets).toEqual([]);
  });
});

describe('Logger, dans le pied : il annonce la série que le réducteur écrit', () => {
  const logged = (state: CaptureState, exerciseId: string, side?: 'left' | 'right') =>
    captureReducer(state, { type: 'log-set', exerciseId, setId: 'neuve', set: { weightKg: 14, reps: 8, rir: 1, side } });

  it('bilatéral : « Logger la série 3 » écrit la 3ᵉ série ; au-delà du plan, « une de plus »', () => {
    const state = withSets(BENCH, [ps(1, 'left'), ps(2, 'left')].map(({ side: _s, ...rest }) => rest), ['s1', 's2']);
    const rank = logRank(getProgress(state, BENCH), null);
    expect(logLabel(null, rank, 4)).toBe('Logger la série 3');
    expect(getProgress(logged(state, BENCH), BENCH).sets).toHaveLength(3);
    expect(logLabel(null, 5, 4)).toBe('Logger une de plus');
  });

  it('unilatéral, trois gauches puis droite choisie : le rang dit est celui de la case écrite', () => {
    const state = withSets(CURL, [ps(1, 'left'), ps(2, 'left'), ps(3, 'left')], ['l1', 'l2', 'l3']);
    const rank = logRank(getProgress(state, CURL), 'right');
    expect(logLabel('right', rank, 3)).toBe(`Logger droite · série ${rank}`);
    const after = getProgress(logged(state, CURL, 'right'), CURL).sets;
    const written = after[after.length - 1]!;
    expect(slotOfOrder(after, written.order) + 1).toBe(rank);
  });
});

describe('Sommaire et Exo suivant passent par le réducteur', () => {
  it('« ‹ Sommaire » (et le glissé du bord) ramène au Sommaire ; « Exo suivant › » ouvre l’exo proposé', () => {
    const state = withSets(BENCH, [], []);
    expect(captureReducer(state, { type: 'back-to-picker' }).activeExerciseId).toBeNull();
    expect(captureReducer(state, { type: 'open-exercise', exerciseId: CURL }).activeExerciseId).toBe(CURL);
  });
});
