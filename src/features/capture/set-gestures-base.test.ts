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

const server = vi.hoisted(() => ({
  rows: [] as Row[],
  log: [] as string[],
  /** Appelé pendant qu'un upsert est « sur le réseau ». */
  duringUpsert: null as ((row: { id: string }) => void) | null,
}));

vi.mock('../../lib/supabase', () => {
  const from = (table: string) => {
    if (table !== 'performed_sets') throw new Error(`table inattendue dans ce test : ${table}`);
    return {
      upsert: (row: Row) => {
        server.duringUpsert?.(row);
        // La base refuse une charge hors de sa colonne (numeric(6,2)).
        if (row.weight_kg > 9999.99) {
          server.log.push(`refus:${row.id}`);
          return Promise.resolve({ error: { code: '22003', message: 'numeric field overflow' } });
        }
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
import {
  clearQueue,
  enqueue,
  enqueueAll,
  flush,
  hasUnpersistedOps,
  listRefused,
  readQuarantine,
  readQueue,
  retryRefused,
} from './outbox';
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
  server.duringUpsert = null;
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
    expect(readQueue().map((op) => op.type)).toEqual(['deleteSet', 'patchSet', 'patchSet']);
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
    expect(persisted()).toEqual(['deleteSet:s1', 'patchSet:s2:rank', 'patchSet:s3:rank']);
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

// Une série dont l'insertion a été REFUSÉE par la base (quarantaine), puis
// corrigée ou supprimée. Le refus ne doit ni disparaître avant que son
// remplaçant soit en lieu sûr, ni rester « renvoyable » une fois dépassé.
describe('écriture refusée, puis corrigée ou supprimée', () => {
  const quarantined = () => readQuarantine().map((q) => `${q.op.type}:${q.op.id}:${(q.op as { weightKg?: number }).weightKg ?? ''}`);
  /** Une quatrième série saisie avec une charge que la base refuse. */
  const withRefusedS4 = async (): Promise<CaptureState> => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    enqueue({ type: 'insertSet', id: 's4', executionId: 'exec-1', exerciseId: BENCH, setOrder: 4, weightKg: 123456, reps: 8, rir: 2 });
    await flush(syncFns);
    expect(quarantined()).toEqual(['insertSet:s4:123456']);
    const state = tab();
    const bench = state.progress[BENCH]!;
    return {
      ...state,
      progress: {
        [BENCH]: {
          ...bench,
          sets: [...bench.sets, { weightKg: 123456, reps: 8, rir: 2, order: 4 }],
          setIds: [...bench.setIds, 's4'],
        },
      },
    };
  };

  it('enfiler un geste ne touche jamais à la quarantaine (elle ne change que sous le verrou du flush)', async () => {
    const state = await withRefusedS4();
    const writes: string[] = [];
    const setItem = localStorage.setItem.bind(localStorage);
    localStorage.setItem = (k: string, v: string) => {
      writes.push(k);
      setItem(k, v);
    };
    enqueueAll(correctSet(state, BENCH, 's4', { weightKg: 100, reps: 8, rir: 2 })!.ops);
    expect(writes).toEqual(['croustylift:outbox']);
    expect(quarantined()).toEqual(['insertSet:s4:123456']);
  });

  it('stockage plein : le refus reste tant que la correction ne tient qu’en mémoire', async () => {
    const state = await withRefusedS4();
    const setItem = localStorage.setItem.bind(localStorage);
    localStorage.setItem = (k: string, v: string) => {
      if (k === 'croustylift:outbox') throw new Error('QuotaExceededError');
      setItem(k, v);
    };
    enqueueAll(correctSet(state, BENCH, 's4', { weightKg: 100, reps: 8, rir: 2 })!.ops);
    expect(hasUnpersistedOps()).toBe(true);
    // Page fermée maintenant : la correction est perdue, mais la saisie refusée
    // est toujours là, renvoyable.
    expect(quarantined()).toEqual(['insertSet:s4:123456']);
  });

  it('la correction reconstitue la série refusée : envoyée entière, puis le refus est levé', async () => {
    const state = await withRefusedS4();
    enqueueAll(correctSet(state, BENCH, 's4', { weightKg: 100, reps: 8, rir: 2 })!.ops);
    await flush(syncFns);
    // Une écriture partielle n'aurait touché aucune ligne (la série n'est pas en base).
    expect(base()).toEqual(['s1:80kg@1', 's2:80kg@2', 's3:80kg@3', 's4:100kg@4']);
    expect(quarantined()).toEqual([]);
    expect(readQueue()).toEqual([]);
  });

  it('correction toujours refusée : c’est la version corrigée qui reste renvoyable, une seule fois', async () => {
    const state = await withRefusedS4();
    enqueueAll(correctSet(state, BENCH, 's4', { weightKg: 9999.99, reps: 8, rir: 2 })!.ops);
    // La base refuse aussi celle-ci (colonne trop étroite simulée plus bas).
    server.duringUpsert = (row) => {
      (row as Row).weight_kg = 123457;
    };
    await flush(syncFns);
    expect(readQuarantine()).toHaveLength(1);
    expect(readQueue()).toEqual([]);
  });

  it('série refusée puis supprimée : le refus est levé une fois la suppression acquittée', async () => {
    const state = await withRefusedS4();
    enqueueAll(deleteSet(state, BENCH, 's4')!.ops);
    expect(quarantined()).toEqual(['insertSet:s4:123456']);
    await flush(syncFns);
    expect(quarantined()).toEqual([]);
    expect(base()).toEqual(['s1:80kg@1', 's2:80kg@2', 's3:80kg@3']);
  });
});

describe('refus qui arrive APRÈS le geste suivant (insertion encore en vol)', () => {
  const insertS4 = (weightKg: number) =>
    ({ type: 'insertSet', id: 's4', executionId: 'exec-1', exerciseId: BENCH, setOrder: 4, weightKg, reps: 8, rir: 2 }) as const;
  const s4State = (weightKg: number): CaptureState => {
    const state = tab();
    const bench = state.progress[BENCH]!;
    return {
      ...state,
      progress: {
        [BENCH]: { ...bench, sets: [...bench.sets, { weightKg, reps: 8, rir: 2, order: 4 }], setIds: [...bench.setIds, 's4'] },
      },
    };
  };
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('correction enfilée pendant l’envoi de l’insertion, qui est ensuite refusée : la série arrive corrigée, rien ne reste renvoyable', async () => {
    enqueue(insertS4(123456));
    let once = true;
    server.duringUpsert = (row) => {
      if (!once || row.id !== 's4') return;
      once = false;
      // L'utilisateur corrige pendant que l'insertion est sur le réseau.
      enqueueAll(correctSet(s4State(123456), BENCH, 's4', { weightKg: 100, reps: 8, rir: 2 })!.ops);
    };
    await flush(syncFns);
    expect(base()).toContain('s4:100kg@4');
    expect(listRefused()).toEqual([]);
    expect(readQueue()).toEqual([]);
  });

  it('suppression enfilée pendant l’envoi de l’insertion refusée : rien en base, rien à renvoyer', async () => {
    enqueue(insertS4(123456));
    let once = true;
    server.duringUpsert = (row) => {
      if (!once || row.id !== 's4') return;
      once = false;
      enqueueAll(deleteSet(s4State(123456), BENCH, 's4')!.ops);
    };
    await flush(syncFns);
    expect(base()).toEqual(['s1:80kg@1', 's2:80kg@2', 's3:80kg@3']);
    // Avant : l'insertion refusée restait en quarantaine, et « renvoyer »
    // pouvait recréer la série supprimée une fois la cause du refus levée.
    expect(listRefused()).toEqual([]);
  });

  it('remplacée par une réécriture complète plus récente (éditeur de séance passée) : l’ancienne ne reste pas renvoyable', async () => {
    enqueue(insertS4(123456));
    let once = true;
    server.duringUpsert = (row) => {
      if (!once || row.id !== 's4') return;
      once = false;
      enqueue(insertS4(100));
    };
    await flush(syncFns);
    expect(base()).toContain('s4:100kg@4');
    expect(listRefused()).toEqual([]);
  });

  it('tant que le geste suivant n’est pas acquitté (réseau coupé), l’ancienne valeur n’est pas renvoyable', async () => {
    // Le refus arrive, puis le réseau tombe avant l'envoi de la suite.
    const cut = (): never => {
      throw new TypeError('Failed to fetch');
    };
    // 1. Une réécriture complète attend derrière : l'insertion refusée est dépassée.
    enqueue(insertS4(123456));
    enqueue(insertS4(100));
    await flush({ ...syncFns, insertSet: async (op) => (op.weightKg > 9999.99 ? syncFns.insertSet(op) : cut()) });
    expect(listRefused()).toEqual([]);
    expect(readQueue().map((op) => (op as { weightKg?: number }).weightKg)).toEqual([100]);
    clearQueue();

    // 2. Une suppression attend derrière : rien à renvoyer non plus.
    enqueue(insertS4(123456));
    enqueueAll(deleteSet(s4State(123456), BENCH, 's4')!.ops);
    await flush({ ...syncFns, deleteSet: cut });
    expect(listRefused()).toEqual([]);
    clearQueue();

    // 3. Une correction (écriture partielle) attend derrière : le refus reste
    //    en quarantaine, elle en a besoin pour reconstituer la série, mais il
    //    n'est pas renvoyable tant qu'elle est en file.
    enqueue(insertS4(123456));
    enqueueAll(correctSet(s4State(123456), BENCH, 's4', { weightKg: 100, reps: 8, rir: 2 })!.ops);
    let sentOnce = false;
    await flush({
      ...syncFns,
      insertSet: async (op) => {
        if (sentOnce) return cut();
        sentOnce = true;
        return syncFns.insertSet(op);
      },
    });
    const refused = listRefused();
    expect(refused.map((r) => r.op.id)).toEqual(['s4']);
    expect(retryRefused(refused[0]!.refusalId)).toBe(false);
    expect(readQueue()).toHaveLength(1);
    // Le réseau revient : la série part entière et corrigée, le refus tombe.
    await flush(syncFns);
    expect(base()).toContain('s4:100kg@4');
    expect(listRefused()).toEqual([]);
  });

  it('un refus sans rien derrière reste renvoyable, comme avant', async () => {
    enqueue(insertS4(123456));
    await flush(syncFns);
    const refused = listRefused();
    expect(refused.map((r) => r.op.id)).toEqual(['s4']);
    expect(retryRefused(refused[0]!.refusalId)).toBe(true);
  });
});
