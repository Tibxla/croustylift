// Les gestes sur les séries joués jusqu'à la base, à travers la vraie file et
// les vraies fonctions de synchro : seule la table `performed_sets` est simulée.
// Deux « onglets » = deux états de capture sur la même file et la même base.
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface Row {
  id: string;
  execution_id: string;
  exercise_id: string;
  set_order: number;
  weight_kg: number;
  reps: number;
  rir: number;
  side: string | null;
}

const server = vi.hoisted(() => ({ rows: [] as Row[], log: [] as string[] }));

vi.mock('../../lib/supabase', () => {
  const from = (table: string) => {
    if (table !== 'performed_sets') throw new Error(`table inattendue dans ce test : ${table}`);
    return {
      upsert: (row: Row) => {
        const known = server.rows.find((r) => r.id === row.id);
        if (known) Object.assign(known, row);
        else server.rows.push({ ...row });
        server.log.push(`upsert:${row.id}`);
        return Promise.resolve({ error: null });
      },
      update: (patch: Partial<Row>) => ({
        eq: (_column: string, id: string) => ({
          select: () => {
            const touched = server.rows.filter((r) => r.id === id);
            touched.forEach((r) => Object.assign(r, patch));
            server.log.push(`update:${id}:${Object.keys(patch).sort().join('+')}`);
            return Promise.resolve({ data: touched.map((r) => ({ id: r.id })), error: null });
          },
        }),
      }),
      delete: () => ({
        eq: (_column: string, id: string) => ({
          select: () => {
            const touched = server.rows.filter((r) => r.id === id);
            server.rows = server.rows.filter((r) => r.id !== id);
            server.log.push(`delete:${id}`);
            return Promise.resolve({ data: touched.map((r) => ({ id: r.id })), error: null });
          },
        }),
      }),
    };
  };
  return { supabase: { from } };
});

import { upperA } from './fixtures';
import { clearQueue, enqueue, enqueueAll, flush, hasUnpersistedOps, readQueue } from './outbox';
import { correctSet, deleteSet, type SetGesture } from './set-gestures';
import { captureReducer, initialState, type CaptureState } from './state';
import { syncFns } from './sync';

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

const BENCH = 'bench-press';
const row = (id: string, set_order: number, weight_kg = 80): Row => ({
  id,
  execution_id: 'exec-1',
  exercise_id: BENCH,
  set_order,
  weight_kg,
  reps: 8,
  rir: 2,
  side: null,
});
/** Un onglet : son état de capture, tel que la base le lui a rendu. */
const tab = (): CaptureState => ({
  ...initialState(upperA, '2026-11-25'),
  executionId: 'exec-1',
  progress: {
    [BENCH]: {
      sets: [1, 2, 3].map((order) => ({ weightKg: 80, reps: 8, rir: 2, order })),
      setIds: ['s1', 's2', 's3'],
      skipped: false,
    },
  },
});
const play = (state: CaptureState, gesture: SetGesture | null): CaptureState => {
  enqueueAll(gesture!.ops);
  return captureReducer(state, gesture!.action);
};
const base = () => server.rows.map((r) => `${r.id}:${r.weight_kg}kg@${r.set_order}`).sort();

beforeEach(() => {
  (globalThis as unknown as { localStorage: Storage }).localStorage = new MemoryStorage() as unknown as Storage;
  clearQueue();
  server.rows = [row('s1', 1), row('s2', 2), row('s3', 3)];
  server.log = [];
});

describe('deux onglets : une correction et une suppression de la même séance', () => {
  it('A corrige S2, puis B supprime S1 : la correction survit, S2 remonte au rang 1', async () => {
    play(tab(), correctSet(tab(), BENCH, 's2', { weightKg: 90, reps: 8, rir: 2 }));
    // B ne sait rien de la correction de A : pour lui, S2 est à 80 kg.
    play(tab(), deleteSet(tab(), BENCH, 's1'));
    await flush(syncFns);
    expect(base()).toEqual(['s2:90kg@1', 's3:80kg@2']);
  });

  it('dans l’autre ordre : B supprime S1, puis A corrige S2 : même résultat, S2 reste au rang 1', async () => {
    play(tab(), deleteSet(tab(), BENCH, 's1'));
    // A ne sait rien de la suppression de B : pour lui, S2 est au rang 2.
    play(tab(), correctSet(tab(), BENCH, 's2', { weightKg: 90, reps: 8, rir: 2 }));
    await flush(syncFns);
    expect(base()).toEqual(['s2:90kg@1', 's3:80kg@2']);
  });

  it('une remontée de rang n’écrit que le rang, une correction que les valeurs', async () => {
    play(tab(), deleteSet(tab(), BENCH, 's1'));
    play(tab(), correctSet(tab(), BENCH, 's3', { weightKg: 85, reps: 7, rir: 1 }));
    await flush(syncFns);
    expect(server.log).toEqual([
      'delete:s1',
      'update:s2:set_order',
      'update:s3:set_order',
      'update:s3:reps+rir+weight_kg',
    ]);
  });

  it('corriger une série supprimée ailleurs entre-temps ne la recrée pas', async () => {
    play(tab(), deleteSet(tab(), BENCH, 's3'));
    play(tab(), correctSet(tab(), BENCH, 's3', { weightKg: 90, reps: 8, rir: 2 }));
    await flush(syncFns);
    expect(base()).toEqual(['s1:80kg@1', 's2:80kg@2']);
  });

  it('remonter le rang d’une série supprimée ailleurs ne la recrée pas non plus', async () => {
    // A supprime S1 (S2 et S3 remontent) ; B avait supprimé S3 juste avant.
    play(tab(), deleteSet(tab(), BENCH, 's3'));
    play(tab(), deleteSet(tab(), BENCH, 's1'));
    await flush(syncFns);
    expect(base()).toEqual(['s2:80kg@1']);
  });
});

// Un geste est une UNITÉ dans la file. Enfilées une à une, ses écritures
// pouvaient être coupées par un stockage presque plein : la suppression écrite
// sur l'appareil, les remontées de rang en mémoire seulement. Page fermée hors
// ligne, la suppression partait seule et la série restante gardait le rang 2.
describe('quota atteint au milieu d’un geste', () => {
  const persisted = () =>
    (JSON.parse(localStorage.getItem('croustylift:outbox') ?? '[]') as { type: string; id: string; only?: string }[]).map(
      (op) => `${op.type}:${op.id}${op.only ? `:${op.only}` : ''}`,
    );
  /** Le stockage n'accepte la file que jusqu'à `max` caractères. */
  const capOutbox = (max: number) => {
    const setItem = localStorage.setItem.bind(localStorage);
    localStorage.setItem = (k: string, v: string) => {
      if (k === 'croustylift:outbox' && v.length > max) throw new Error('QuotaExceededError');
      setItem(k, v);
    };
  };

  it('la place pour la suppression seule : RIEN du geste n’est écrit sur l’appareil, tout tient en mémoire', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const gesture = deleteSet(tab(), BENCH, 's1')!;
    // Assez pour le seul `deleteSet`, pas pour les deux remontées qui le suivent.
    capOutbox(JSON.stringify([gesture.ops[0]]).length + 200);
    enqueueAll(gesture.ops);
    expect(persisted()).toEqual([]);
    expect(readQueue().map((op) => op.type)).toEqual(['deleteSet', 'insertSet', 'insertSet']);
    expect(hasUnpersistedOps()).toBe(true);
    vi.restoreAllMocks();
  });

  it('le défaut, sans unité : enfilées une à une, la suppression est écrite seule', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const gesture = deleteSet(tab(), BENCH, 's1')!;
    capOutbox(JSON.stringify([gesture.ops[0]]).length + 200);
    gesture.ops.forEach((op) => enqueue(op));
    expect(persisted()).toEqual(['deleteSet:s1']);
    vi.restoreAllMocks();
  });

  it('assez de place : le geste entier est écrit d’un coup, dans l’ordre', async () => {
    enqueueAll(deleteSet(tab(), BENCH, 's1')!.ops);
    expect(persisted()).toEqual(['deleteSet:s1', 'insertSet:s2:rank', 'insertSet:s3:rank']);
    await flush(syncFns);
    expect(base()).toEqual(['s2:80kg@1', 's3:80kg@2']);
  });

  it('un geste sans écriture n’enfile rien', () => {
    expect(enqueueAll([])).toEqual([]);
    expect(readQueue()).toEqual([]);
  });

  it('chaque écriture du geste a son identité d’enfilement, rendue dans l’ordre', () => {
    const uids = enqueueAll(deleteSet(tab(), BENCH, 's1')!.ops);
    expect(uids).toHaveLength(3);
    expect(new Set(uids).size).toBe(3);
    expect(readQueue().map((op) => op._uid)).toEqual(uids);
  });
});
