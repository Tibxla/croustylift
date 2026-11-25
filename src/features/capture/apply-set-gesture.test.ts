// Le geste « changer le côté » joué comme l'écran le joue (apply-set-gesture.ts),
// sur la vraie file : l'action part une fois au réducteur, l'unique écriture du
// côté s'enfile une fois, en une unité, après la ré-affirmation de l'exécution.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PerformedSet } from '../../domain/types';
import { upperA } from './fixtures';
import { clearQueue, enqueueAll, readQueue, type OutboxOp } from './outbox';
import { applySetGesture } from './apply-set-gesture';
import { changeSetSide, switchableSide } from './set-gestures';
import { getProgress, initialState, type CaptureAction, type CaptureState } from './state';

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

const CURL = 'curl';
const ps = (order: number, side: 'left' | 'right', reps = 10): PerformedSet => ({ order, weightKg: 12, reps, rir: 2, side });

/** Série 1 complète, série 2 saisie à gauche seulement. */
function unilateral(): CaptureState {
  return {
    ...initialState(upperA, '2026-11-25'),
    executionId: 'exec-1',
    progress: { [CURL]: { sets: [ps(1, 'left'), ps(1, 'right'), ps(2, 'left', 9)], setIds: ['l1', 'r1', 'l2'], skipped: false } },
  };
}

function io() {
  const calls: string[] = [];
  const dispatch = vi.fn((action: CaptureAction) => calls.push(`dispatch:${action.type}`));
  const ensureExecution = vi.fn(() => calls.push('exécution'));
  const enqueueGesture = vi.fn((ops: readonly OutboxOp[]) => {
    calls.push(`file:${ops.length}`);
    enqueueAll(ops);
  });
  return { calls, dispatch, ensureExecution, enqueueGesture };
}

beforeEach(() => {
  (globalThis as unknown as { localStorage: Storage }).localStorage = new MemoryStorage() as unknown as Storage;
  clearQueue();
});

describe('switchableSide (ce que la feuille propose)', () => {
  it('l’autre côté du rang est libre : c’est lui', () => {
    expect(switchableSide(getProgress(unilateral(), CURL), 'l2')).toBe('right');
  });

  it('l’autre côté est pris, ligne inconnue, exo bilatéral : rien', () => {
    expect(switchableSide(getProgress(unilateral(), CURL), 'l1')).toBeNull();
    expect(switchableSide(getProgress(unilateral(), CURL), 'r1')).toBeNull();
    expect(switchableSide(getProgress(unilateral(), CURL), 'inconnue')).toBeNull();
    const bilateral = { sets: [{ order: 1, weightKg: 80, reps: 8, rir: 2 }], setIds: ['s1'], skipped: false };
    expect(switchableSide(bilateral, 's1')).toBeNull();
  });
});

describe('applySetGesture · changer le côté', () => {
  it('une action, une écriture du côté seul, enfilées une fois et dans cet ordre', () => {
    const state = unilateral();
    const deps = io();
    const next = applySetGesture(state, changeSetSide(state, CURL, 'l2', 'right'), deps);

    expect(deps.calls).toEqual(['dispatch:change-set-side', 'exécution', 'file:1']);
    expect(deps.dispatch).toHaveBeenCalledWith({ type: 'change-set-side', exerciseId: CURL, setId: 'l2', side: 'right' });
    expect(readQueue().map(({ _seq, _owner, _uid, _at, ...op }) => op)).toEqual([
      { type: 'patchSet', id: 'l2', executionId: 'exec-1', exerciseId: CURL, setOrder: 2, weightKg: 12, reps: 9, rir: 2, side: 'right', only: 'side' },
    ]);
    // Rang, valeurs et id intacts ; seule la ligne change de côté.
    expect(getProgress(next, CURL)).toEqual({
      sets: [ps(1, 'left'), ps(1, 'right'), ps(2, 'right', 9)],
      setIds: ['l1', 'r1', 'l2'],
      skipped: false,
    });
  });

  it('autre côté pris : ni action, ni écriture, l’état ne bouge pas', () => {
    const state = unilateral();
    const deps = io();
    expect(applySetGesture(state, changeSetSide(state, CURL, 'l1', 'right'), deps)).toBe(state);
    expect(deps.calls).toEqual([]);
    expect(readQueue()).toEqual([]);
  });
});
