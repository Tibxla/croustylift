// Gestes sur les séries de la séance en cours : la fonction pure rend l'action
// du réducteur et les écritures à enfiler. Ici, corriger une série.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PerformedSet } from '../../domain/types';
import { estimateE1rm } from '../../domain/e1rm';
import { upperA } from './fixtures';
import { applyPendingSets } from './data';
import {
  clearQueue,
  enqueue,
  flush,
  readQuarantine,
  readQueue,
  storageFailing,
  type InsertSetOp,
  type OutboxOp,
  type SyncFns,
} from './outbox';
import { computeSetBadges } from './set-badges';
import { correctSet, deleteSet, logicalSetRows, ranksAfterDeletion } from './set-gestures';
import { deletionPreview } from './set-ranks';
import {
  captureReducer,
  getProgress,
  mutationMark,
  initialState,
  loadPersisted,
  persist,
  reconcileProgress,
  type CaptureState,
} from './state';

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

const DATE = '2026-11-25';
const BENCH = 'bench-press';
const ps = (weightKg: number, reps: number, rir: number, order: number, side?: 'left' | 'right'): PerformedSet => ({
  weightKg,
  reps,
  rir,
  order,
  ...(side ? { side } : {}),
});

/** Une séance en cours : trois séries de développé couché, ids s1 à s3. */
function started(): CaptureState {
  return {
    ...initialState(upperA, DATE),
    executionId: 'exec-1',
    progress: {
      [BENCH]: { sets: [ps(80, 8, 2, 1), ps(80, 7, 1, 2), ps(80, 6, 0, 3)], setIds: ['s1', 's2', 's3'], skipped: false },
    },
  };
}

/** Applique un geste comme le fera l'écran : action au réducteur, ops en file. */
function play(state: CaptureState, gesture: { action: Parameters<typeof captureReducer>[1]; ops: OutboxOp[] }) {
  gesture.ops.forEach((op) => enqueue(op));
  return captureReducer(state, gesture.action);
}

/** Fausse base : applique les écritures de séries, note l'ordre d'arrivée. */
function fakeBase() {
  const rows = new Map<string, { setOrder: number; weightKg: number; reps: number; rir: number; side?: string }>();
  const sent: string[] = [];
  const ok = async () => {};
  const fns = {
    upsertExecution: ok,
    insertSet: async (op: { id: string; setOrder: number; weightKg: number; reps: number; rir: number; side?: string }) => {
      sent.push(`upsert:${op.id}:${op.weightKg}x${op.reps}@${op.setOrder}`);
      rows.set(op.id, { setOrder: op.setOrder, weightKg: op.weightKg, reps: op.reps, rir: op.rir, side: op.side });
    },
    // Écriture partielle : un `update`, jamais une création (cf. `patchSet`, data.ts).
    patchSet: async (op: { id: string; only: 'values' | 'rank'; setOrder: number; weightKg: number; reps: number; rir: number }) => {
      sent.push(`patch:${op.id}:${op.only === 'values' ? `${op.weightKg}x${op.reps}` : `@${op.setOrder}`}`);
      const known = rows.get(op.id);
      if (!known) return;
      if (op.only === 'values') Object.assign(known, { weightKg: op.weightKg, reps: op.reps, rir: op.rir });
      else known.setOrder = op.setOrder;
    },
    deleteSet: async (op: { id: string }) => {
      sent.push(`delete:${op.id}`);
      rows.delete(op.id);
    },
    updateExecution: ok,
    upsertDatedNote: ok,
    deleteDatedNote: ok,
    upsertExerciseNote: ok,
    deleteExerciseNote: ok,
    deleteExecution: ok,
    deleteExecutionIfEmpty: ok,
  } as unknown as SyncFns;
  return { fns, rows, sent };
}

beforeEach(() => {
  (globalThis as unknown as { localStorage: Storage }).localStorage = new MemoryStorage() as unknown as Storage;
  clearQueue();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('correctSet', () => {
  it('corrige n’importe quelle série de l’exo, pas seulement la dernière : mêmes id, rang et place', () => {
    const state = started();
    const gesture = correctSet(state, BENCH, 's1', { weightKg: 82.5, reps: 8, rir: 1 });
    expect(gesture).not.toBeNull();
    const next = captureReducer(state, gesture!.action);
    expect(getProgress(next, BENCH).sets).toEqual([ps(82.5, 8, 1, 1), ps(80, 7, 1, 2), ps(80, 6, 0, 3)]);
    expect(getProgress(next, BENCH).setIds).toEqual(['s1', 's2', 's3']);
  });

  it('l’écriture est une réaffirmation de la ligne par son id (upsert), au même rang', () => {
    const gesture = correctSet(started(), BENCH, 's2', { weightKg: 77.5, reps: 9, rir: 2 });
    expect(gesture!.ops).toEqual([
      { type: 'patchSet', id: 's2', executionId: 'exec-1', exerciseId: BENCH, setOrder: 2, weightKg: 77.5, reps: 9, rir: 2, only: 'values' },
    ]);
  });

  it('unilatéral : un seul côté est corrigé, l’autre et le rang ne bougent pas', () => {
    const state: CaptureState = {
      ...started(),
      progress: {
        curl: {
          sets: [ps(12, 10, 2, 1, 'left'), ps(12, 9, 2, 1, 'right'), ps(12, 9, 1, 2, 'left')],
          setIds: ['l1', 'r1', 'l2'],
          skipped: false,
        },
      },
    };
    const gesture = correctSet(state, 'curl', 'r1', { weightKg: 12, reps: 10, rir: 1 })!;
    expect(gesture.ops).toEqual([
      { type: 'patchSet', id: 'r1', executionId: 'exec-1', exerciseId: 'curl', setOrder: 1, weightKg: 12, reps: 10, rir: 1, side: 'right', only: 'values' },
    ]);
    expect(getProgress(captureReducer(state, gesture.action), 'curl').sets).toEqual([
      ps(12, 10, 2, 1, 'left'),
      ps(12, 10, 1, 1, 'right'),
      ps(12, 9, 1, 2, 'left'),
    ]);
  });

  it('valeurs bornées comme au log : rien d’invalide ne part vers la base', () => {
    const gesture = correctSet(started(), BENCH, 's1', { weightKg: 123456, reps: 0, rir: -3 })!;
    expect(gesture.ops[0]).toMatchObject({ weightKg: 9999.99, reps: 1, rir: 0 });
  });

  it('rien à faire : valeurs identiques, série inconnue, série sans id (cache d’ancien format)', () => {
    expect(correctSet(started(), BENCH, 's1', { weightKg: 80, reps: 8, rir: 2 })).toBeNull();
    expect(correctSet(started(), BENCH, 'inconnue', { weightKg: 90, reps: 5, rir: 0 })).toBeNull();
    expect(correctSet(started(), 'squat', 's1', { weightKg: 90, reps: 5, rir: 0 })).toBeNull();
    const sansId: CaptureState = {
      ...started(),
      progress: { [BENCH]: { sets: [ps(80, 8, 2, 1)], setIds: [null], skipped: false } },
    };
    expect(correctSet(sansId, BENCH, 's1', { weightKg: 90, reps: 5, rir: 0 })).toBeNull();
  });

  it('une action sans série correspondante laisse l’état tel quel', () => {
    const state = started();
    const next = captureReducer(state, {
      type: 'correct-set',
      exerciseId: BENCH,
      setId: 'inconnue',
      values: { weightKg: 90, reps: 5, rir: 0 },
    });
    expect(next).toBe(state);
  });

  it('corriger une série ne lève pas le « passé » de l’exo et ne touche pas aux autres exos', () => {
    const state: CaptureState = {
      ...started(),
      progress: { ...started().progress, squat: { sets: [ps(100, 5, 2, 1)], setIds: ['q1'], skipped: false } },
    };
    const next = captureReducer(state, correctSet(state, BENCH, 's3', { weightKg: 80, reps: 7, rir: 0 })!.action);
    expect(next.progress.squat).toBe(state.progress.squat);
  });

  it('la correction survit au rechargement (état persisté)', () => {
    const state = started();
    const next = captureReducer(state, correctSet(state, BENCH, 's1', { weightKg: 85, reps: 6, rir: 1 })!.action);
    persist(next);
    expect(getProgress(loadPersisted(upperA, DATE)!, BENCH).sets[0]).toEqual(ps(85, 6, 1, 1));
  });
});

describe('correctSet et la file d’écritures', () => {
  const insert = (id: string, setOrder: number, weightKg = 80, reps = 8): OutboxOp => ({
    type: 'insertSet',
    id,
    executionId: 'exec-1',
    exerciseId: BENCH,
    setOrder,
    weightKg,
    reps,
    rir: 2,
  });

  it('hors ligne : le log puis sa correction tiennent tous deux en file et partent dans l’ordre', async () => {
    enqueue({ type: 'upsertExecution', id: 'exec-1', seanceVersionId: 'v1', performedOn: DATE });
    enqueue(insert('s1', 1));
    play(started(), correctSet(started(), BENCH, 's1', { weightKg: 85, reps: 6, rir: 1 })!);
    expect(readQueue().filter((op) => op.id === 's1')).toHaveLength(2);

    const base = fakeBase();
    await flush(base.fns);
    expect(base.sent).toEqual(['upsert:s1:80x8@1', 'patch:s1:85x6']);
    expect(base.rows.get('s1')).toMatchObject({ weightKg: 85, reps: 6, rir: 1, setOrder: 1 });
    expect(readQueue()).toEqual([]);
  });

  it('deux corrections de suite : la dernière gagne en base', async () => {
    const first = play(started(), correctSet(started(), BENCH, 's1', { weightKg: 85, reps: 6, rir: 1 })!);
    const second = play(first, correctSet(first, BENCH, 's1', { weightKg: 82.5, reps: 7, rir: 1 })!);
    expect(getProgress(second, BENCH).sets[0]).toEqual(ps(82.5, 7, 1, 1));
    const base = fakeBase();
    base.rows.set('s1', { setOrder: 1, weightKg: 80, reps: 8, rir: 2 });
    await flush(base.fns);
    expect(base.rows.get('s1')).toMatchObject({ weightKg: 82.5, reps: 7, setOrder: 1 });
  });

  it('l’insertion d’origine refusée par la base (quarantaine) est relevée par la correction', async () => {
    enqueue(insert('s1', 1, 123456));
    const refusing = fakeBase();
    refusing.fns.insertSet = async () => {
      throw { code: '22003', message: 'numeric field overflow' };
    };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await flush(refusing.fns);
    expect(readQuarantine().map((q) => q.op.id)).toEqual(['s1']);

    // La correction remplace l'écriture refusée, mais le refus n'est levé qu'une
    // fois la correction ACQUITTÉE : d'ici là il reste la seule copie durable.
    play(started(), correctSet(started(), BENCH, 's1', { weightKg: 85, reps: 6, rir: 1 })!);
    expect(readQuarantine().map((q) => q.op.id)).toEqual(['s1']);
    const base = fakeBase();
    await flush(base.fns);
    expect(base.rows.get('s1')).toMatchObject({ weightKg: 85 });
    // Plus rien en quarantaine pour cette série (« renvoyer » réécrirait
    // l'ancienne valeur, et la Déconnexion resterait retenue pour rien).
    expect(readQuarantine()).toEqual([]);
  });
});

describe('correctSet, Référence et badges', () => {
  it('le badge de la série corrigée est recalculé (battue, égalée, record)', () => {
    const reference = [ps(80, 8, 2, 1), ps(80, 8, 2, 2), ps(80, 8, 2, 3)];
    const record = {
      bestE1rm: estimateE1rm(80, 8, 2),
      bestE1rmSet: { weightKg: 80, reps: 8 },
      bestWeightReps: { weightKg: 80, reps: 8 },
    };
    const state = started();
    const before = computeSetBadges(getProgress(state, BENCH).sets, reference, record);
    expect(before[0]).toEqual({ axis: 'reference', verdict: 'egalise' });
    expect(before[1]).toBeNull();

    // La série 2, saisie trop bas, est corrigée au-dessus de la référence et du record.
    const next = captureReducer(state, correctSet(state, BENCH, 's2', { weightKg: 85, reps: 8, rir: 2 })!.action);
    const after = computeSetBadges(getProgress(next, BENCH).sets, reference, record);
    expect(after[1]).toEqual({ axis: 'record', record: 'both' });
    expect(after[0]).toEqual(before[0]);
  });

  it('Référence fusionnée : la correction encore en file remplace la valeur lue, sans doubler la ligne', () => {
    const rows = [
      {
        id: 's1',
        weight_kg: 80,
        reps: 8,
        rir: 2,
        set_order: 1,
        side: null,
        execution_id: 'exec-1',
        executions: { performed_on: DATE, created_at: '2026-11-25T18:00:00Z', seance_version_id: 'v1' },
      },
    ];
    const gesture = correctSet(started(), BENCH, 's1', { weightKg: 85, reps: 6, rir: 1 })!;
    const merged = applyPendingSets(rows, gesture.ops, BENCH);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ id: 's1', weight_kg: 85, reps: 6, rir: 1, set_order: 1 });
  });
});

describe('correction et réponse tardive de la base', () => {
  const base = { [BENCH]: { sets: [ps(80, 8, 2, 1), ps(80, 7, 1, 2), ps(80, 6, 0, 3)], setIds: ['s1', 's2', 's3'] } };

  it('correction encore en file à l’arrivée : rejouée sur la réponse', () => {
    const state = started();
    const gesture = correctSet(state, BENCH, 's1', { weightKg: 85, reps: 6, rir: 1 })!;
    const corrected = captureReducer(state, gesture.action);
    const next = captureReducer(corrected, {
      type: 'reconcile-progress',
      base,
      pendingSetIds: ['s1'],
      knownAtDeparture: ['s1', 's2', 's3'],
      queuedOps: gesture.ops,
    });
    expect(getProgress(next, BENCH).sets[0]).toEqual(ps(85, 6, 1, 1));
  });

  it('correction faite PUIS acquittée pendant le trajet (file vide à l’arrivée) : la réponse, partie avant, ne la défait pas', () => {
    const departure = started().progress;
    const corrected = captureReducer(started(), correctSet(started(), BENCH, 's1', { weightKg: 85, reps: 6, rir: 1 })!.action);
    const next = captureReducer(corrected, {
      type: 'reconcile-progress',
      base,
      pendingSetIds: [],
      knownAtDeparture: ['s1', 's2', 's3'],
      departure,
      queuedOps: [],
    });
    expect(getProgress(next, BENCH).sets[0]).toEqual(ps(85, 6, 1, 1));
    // Les séries non touchées pendant le trajet suivent toujours la base.
    expect(getProgress(next, BENCH).sets[1]).toEqual(ps(80, 7, 1, 2));
  });

  it('série inchangée depuis le départ : la base fait foi (correction venue d’un autre appareil)', () => {
    const departure = started().progress;
    const elsewhere = { [BENCH]: { sets: [ps(90, 5, 1, 1), ps(80, 7, 1, 2), ps(80, 6, 0, 3)], setIds: ['s1', 's2', 's3'] } };
    const progress = reconcileProgress(started().progress, elsewhere, {
      pendingSetIds: [],
      knownAtDeparture: ['s1', 's2', 's3'],
      departure,
    });
    expect(progress[BENCH]?.sets[0]).toEqual(ps(90, 5, 1, 1));
  });
});

// --- Supprimer n'importe quelle série ----------------------------------------

describe('ranksAfterDeletion (LA règle des rangs après une suppression)', () => {
  const sets = [ps(80, 8, 2, 1), ps(80, 7, 1, 2), ps(80, 6, 0, 3), ps(75, 8, 1, 4)];

  it('remontée (règle retenue) : les séries suivantes prennent le rang du dessus, sans trou', () => {
    expect(ranksAfterDeletion(sets, [1]).map((s) => s.order)).toEqual([1, 2, 3]);
    expect(ranksAfterDeletion(sets, [1]).map((s) => s.reps)).toEqual([8, 6, 8]);
  });

  it('la règle par défaut est la remontée', () => {
    expect(ranksAfterDeletion(sets, [1])).toEqual(ranksAfterDeletion(sets, [1], 'compact'));
  });

  it('trou (l’autre règle, un argument à changer) : les rangs restants ne bougent pas', () => {
    expect(ranksAfterDeletion(sets, [1], 'gap').map((s) => s.order)).toEqual([1, 3, 4]);
  });

  it('unilatéral : la série entière part, gauche et droite, et les deux côtés des suivantes remontent ensemble', () => {
    const uni = [ps(12, 10, 2, 1, 'left'), ps(12, 10, 2, 1, 'right'), ps(12, 9, 2, 2, 'left'), ps(12, 9, 2, 2, 'right'), ps(12, 8, 1, 3, 'left')];
    expect(logicalSetRows(uni, 1)).toEqual([0, 1]);
    expect(ranksAfterDeletion(uni, logicalSetRows(uni, 1)).map((s) => `${s.order}${s.side}`)).toEqual(['1left', '1right', '2left']);
  });

  it('un rang encore occupé après la suppression ne fait rien remonter (sinon une nouvelle collision)', () => {
    // A1, B2, C2, D3 : supprimer B laisse C au rang 2, D reste au rang 3.
    const twin = [ps(80, 8, 2, 1), ps(80, 7, 1, 2), ps(82.5, 7, 1, 2), ps(80, 6, 0, 3)];
    expect(ranksAfterDeletion(twin, [1]).map((s) => `${s.order}:${s.weightKg}`)).toEqual(['1:80', '2:82.5', '3:80']);
  });
});

describe('logicalSetRows (les lignes d’une série logique)', () => {
  it('bilatéral : la seule ligne visée, même si une autre partage son rang', () => {
    const twin = [ps(80, 8, 2, 1), ps(80, 7, 1, 2), ps(82.5, 7, 1, 2)];
    expect(logicalSetRows(twin, 1)).toEqual([1]);
    expect(logicalSetRows(twin, 2)).toEqual([2]);
  });

  it('unilatéral : la paire gauche et droite du rang, quel que soit le côté touché', () => {
    const uni = [ps(12, 10, 2, 1, 'right'), ps(12, 10, 2, 1, 'left'), ps(12, 9, 2, 2, 'left')];
    expect(logicalSetRows(uni, 0)).toEqual([0, 1]);
    expect(logicalSetRows(uni, 1)).toEqual([0, 1]);
  });

  it('unilatéral, un seul côté au rang : la seule ligne', () => {
    const lefts = [ps(12, 10, 2, 1, 'left'), ps(12, 9, 2, 2, 'left'), ps(12, 8, 2, 3, 'left')];
    expect(logicalSetRows(lefts, 1)).toEqual([1]);
  });

  it('unilatéral ambigu (deux gauches et une droite au même rang) : la seule ligne visée', () => {
    const odd = [ps(12, 10, 2, 1, 'left'), ps(12, 11, 2, 1, 'left'), ps(12, 10, 2, 1, 'right')];
    expect(logicalSetRows(odd, 0)).toEqual([0]);
    expect(logicalSetRows(odd, 2)).toEqual([2]);
  });
});

// Ce que la confirmation de suppression annonce : elle lit la même règle que le
// geste, sinon elle promettait « gauche et droite » ou « les suivantes
// remontent » quand rien de tel n'arrive.
describe('deletionPreview (ce que dit la confirmation)', () => {
  it('paire unilatérale : les deux côtés partent, les suivantes remontent', () => {
    const uni = [ps(12, 10, 2, 1, 'left'), ps(12, 10, 2, 1, 'right'), ps(12, 9, 2, 2, 'left'), ps(12, 9, 2, 2, 'right')];
    expect(deletionPreview(uni, 0)).toEqual({ bothSides: true, movedRanks: 1 });
  });

  it('unilatéral ambigu : un seul côté part, le rang reste occupé, rien ne remonte', () => {
    const odd = [ps(12, 10, 2, 1, 'left'), ps(12, 11, 2, 1, 'left'), ps(12, 10, 2, 1, 'right'), ps(12, 9, 2, 2, 'left')];
    expect(deletionPreview(odd, 1)).toEqual({ bothSides: false, movedRanks: 0 });
  });

  it('deux lignes bilatérales au même rang : rien ne remonte', () => {
    const twin = [ps(80, 8, 2, 1), ps(80, 7, 1, 2), ps(82.5, 7, 1, 2), ps(80, 6, 0, 3)];
    expect(deletionPreview(twin, 1)).toEqual({ bothSides: false, movedRanks: 0 });
    expect(deletionPreview(twin, 0)).toEqual({ bothSides: false, movedRanks: 2 });
  });
});

// Deux onglets ajoutent chacun une série depuis le même état : deux lignes
// bilatérales au même rang, que la base accepte (aucune unicité sur le rang).
// Après reprise, la bande en montre deux cases. Supprimer l'une enfilait un
// `deleteSet` pour CHAQUE ligne du rang : la série gardée partait aussi.
describe('deleteSet après la reprise de deux lignes au même rang', () => {
  /** S1, puis S2 saisie dans deux onglets (s2a, s2b), puis S3 : la séance reprise. */
  function resumedTwins(): CaptureState {
    return {
      ...started(),
      progress: {
        [BENCH]: {
          sets: [ps(80, 8, 2, 1), ps(80, 7, 1, 2), ps(82.5, 7, 1, 2), ps(80, 6, 0, 3)],
          setIds: ['s1', 's2a', 's2b', 's3'],
          skipped: false,
        },
      },
    };
  }

  it('ne supprime que la ligne touchée ; le rang reste occupé, rien ne remonte', () => {
    const state = resumedTwins();
    const gesture = deleteSet(state, BENCH, 's2a')!;
    expect(gesture.ops).toEqual([{ type: 'deleteSet', id: 's2a', exerciseIds: [BENCH] }]);
    const next = captureReducer(state, gesture.action);
    expect(getProgress(next, BENCH).setIds).toEqual(['s1', 's2b', 's3']);
    expect(getProgress(next, BENCH).sets).toEqual([ps(80, 8, 2, 1), ps(82.5, 7, 1, 2), ps(80, 6, 0, 3)]);
  });

  it('l’autre ligne du rang survit en base', async () => {
    const base = fakeBase();
    for (const [id, order, kg] of [['s1', 1, 80], ['s2a', 2, 80], ['s2b', 2, 82.5], ['s3', 3, 80]] as const) {
      base.rows.set(id, { setOrder: order, weightKg: kg, reps: 7, rir: 1 });
    }
    play(resumedTwins(), deleteSet(resumedTwins(), BENCH, 's2b')!);
    await flush(base.fns);
    expect([...base.rows.entries()].map(([id, row]) => `${id}@${row.setOrder}`)).toEqual(['s1@1', 's2a@2', 's3@3']);
    expect(base.sent).toEqual(['delete:s2b']);
  });

  it('unilatéral, trois gauches de suite (une série par rang) : seule la touchée part, la suivante remonte', () => {
    const state: CaptureState = {
      ...started(),
      progress: {
        curl: {
          sets: [ps(12, 10, 2, 1, 'left'), ps(12, 9, 2, 2, 'left'), ps(12, 8, 2, 3, 'left')],
          setIds: ['l1', 'l2', 'l3'],
          skipped: false,
        },
      },
    };
    const gesture = deleteSet(state, 'curl', 'l2')!;
    expect(gesture.ops.map((op) => `${op.type}:${op.id}`)).toEqual(['deleteSet:l2', 'patchSet:l3']);
    const next = captureReducer(state, gesture.action);
    expect(getProgress(next, 'curl').setIds).toEqual(['l1', 'l3']);
    expect(getProgress(next, 'curl').sets.map((s) => s.order)).toEqual([1, 2]);
  });

  it('unilatéral ambigu (deux gauches et une droite au même rang) : seule la ligne touchée part', () => {
    const state: CaptureState = {
      ...started(),
      progress: {
        curl: {
          sets: [ps(12, 10, 2, 1, 'left'), ps(12, 11, 2, 1, 'left'), ps(12, 10, 2, 1, 'right'), ps(12, 9, 2, 2, 'left')],
          setIds: ['la', 'lb', 'r1', 'l2'],
          skipped: false,
        },
      },
    };
    const gesture = deleteSet(state, 'curl', 'lb')!;
    expect(gesture.ops).toEqual([{ type: 'deleteSet', id: 'lb', exerciseIds: ['curl'] }]);
    expect(getProgress(captureReducer(state, gesture.action), 'curl').setIds).toEqual(['la', 'r1', 'l2']);
  });
});

describe('deleteSet', () => {
  it('supprime n’importe quelle série ; les suivantes remontent d’un rang', () => {
    const state = started();
    const gesture = deleteSet(state, BENCH, 's1')!;
    const next = captureReducer(state, gesture.action);
    expect(getProgress(next, BENCH).setIds).toEqual(['s2', 's3']);
    expect(getProgress(next, BENCH).sets).toEqual([ps(80, 7, 1, 1), ps(80, 6, 0, 2)]);
  });

  it('écritures : la suppression d’abord, puis chaque série remontée réécrite à son nouveau rang', () => {
    const gesture = deleteSet(started(), BENCH, 's1')!;
    expect(gesture.ops).toEqual([
      { type: 'deleteSet', id: 's1', exerciseIds: [BENCH] },
      { type: 'patchSet', id: 's2', executionId: 'exec-1', exerciseId: BENCH, setOrder: 1, weightKg: 80, reps: 7, rir: 1, only: 'rank' },
      { type: 'patchSet', id: 's3', executionId: 'exec-1', exerciseId: BENCH, setOrder: 2, weightKg: 80, reps: 6, rir: 0, only: 'rank' },
    ]);
  });

  it('la dernière série : une seule suppression, rien à renuméroter', () => {
    expect(deleteSet(started(), BENCH, 's3')!.ops).toEqual([{ type: 'deleteSet', id: 's3', exerciseIds: [BENCH] }]);
  });

  it('la série suivante loggée prend le rang juste après, sans trou', () => {
    let state = started();
    state = captureReducer(state, deleteSet(state, BENCH, 's2')!.action);
    state = captureReducer(state, { type: 'log-set', exerciseId: BENCH, setId: 's4', set: { weightKg: 80, reps: 5, rir: 0 } });
    expect(getProgress(state, BENCH).sets.map((s) => s.order)).toEqual([1, 2, 3]);
  });

  it('unilatéral : toucher un côté supprime la série entière, gauche et droite', () => {
    const state: CaptureState = {
      ...started(),
      progress: {
        curl: {
          sets: [ps(12, 10, 2, 1, 'left'), ps(12, 10, 2, 1, 'right'), ps(12, 9, 1, 2, 'left'), ps(12, 9, 1, 2, 'right')],
          setIds: ['l1', 'r1', 'l2', 'r2'],
          skipped: false,
        },
      },
    };
    const gesture = deleteSet(state, 'curl', 'r1')!;
    expect(gesture.ops.filter((op) => op.type === 'deleteSet').map((op) => op.id)).toEqual(['l1', 'r1']);
    expect(gesture.ops.filter((op) => op.type === 'patchSet')).toEqual([
      { type: 'patchSet', id: 'l2', executionId: 'exec-1', exerciseId: 'curl', setOrder: 1, weightKg: 12, reps: 9, rir: 1, side: 'left', only: 'rank' },
      { type: 'patchSet', id: 'r2', executionId: 'exec-1', exerciseId: 'curl', setOrder: 1, weightKg: 12, reps: 9, rir: 1, side: 'right', only: 'rank' },
    ]);
    const next = captureReducer(state, gesture.action);
    expect(getProgress(next, 'curl').setIds).toEqual(['l2', 'r2']);
    expect(getProgress(next, 'curl').sets.map((s) => `${s.order}${s.side}`)).toEqual(['1left', '1right']);
  });

  it('supprimer la seule série : l’exo n’a plus de série, sa marque « passé » ne change pas', () => {
    const state: CaptureState = {
      ...started(),
      progress: { [BENCH]: { sets: [ps(80, 8, 2, 1)], setIds: ['s1'], skipped: true } },
    };
    const next = captureReducer(state, deleteSet(state, BENCH, 's1')!.action);
    expect(getProgress(next, BENCH)).toEqual({ sets: [], setIds: [], skipped: true });
  });

  it('rien à faire : série inconnue, ou série sans id', () => {
    expect(deleteSet(started(), BENCH, 'inconnue')).toBeNull();
    expect(deleteSet(started(), 'squat', 's1')).toBeNull();
  });

  it('une ligne sans id au même rang part de l’écran sans écriture ; une suivante sans id remonte sans écriture', () => {
    const state: CaptureState = {
      ...started(),
      progress: { [BENCH]: { sets: [ps(80, 8, 2, 1), ps(80, 7, 1, 2)], setIds: ['s1', null], skipped: false } },
    };
    const gesture = deleteSet(state, BENCH, 's1')!;
    expect(gesture.ops).toEqual([{ type: 'deleteSet', id: 's1', exerciseIds: [BENCH] }]);
    expect(getProgress(captureReducer(state, gesture.action), BENCH).sets).toEqual([ps(80, 7, 1, 1)]);
  });

  it('survit au rechargement (état persisté)', () => {
    const state = started();
    persist(captureReducer(state, deleteSet(state, BENCH, 's1')!.action));
    expect(getProgress(loadPersisted(upperA, DATE)!, BENCH).setIds).toEqual(['s2', 's3']);
  });

  it('hors ligne : tout part dans l’ordre, la base finit sans trou ni ligne en trop', async () => {
    enqueue({ type: 'upsertExecution', id: 'exec-1', seanceVersionId: 'v1', performedOn: DATE });
    const state = started();
    getProgress(state, BENCH).sets.forEach((set, i) =>
      enqueue({ type: 'insertSet', id: `s${i + 1}`, executionId: 'exec-1', exerciseId: BENCH, setOrder: set.order, weightKg: set.weightKg, reps: set.reps, rir: set.rir }),
    );
    play(state, deleteSet(state, BENCH, 's2')!);
    const base = fakeBase();
    await flush(base.fns);
    expect([...base.rows.entries()].map(([id, row]) => `${id}@${row.setOrder}`)).toEqual(['s1@1', 's3@2']);
    // La suppression est partie AVANT la renumérotation : à aucun moment deux
    // séries gardées ne partagent un rang.
    expect(base.sent.indexOf('delete:s2')).toBeLessThan(base.sent.indexOf('patch:s3:@2'));
  });

  it('la série supprimée avait été refusée par la base : plus rien en quarantaine pour elle', async () => {
    enqueue({ type: 'insertSet', id: 's3', executionId: 'exec-1', exerciseId: BENCH, setOrder: 3, weightKg: 123456, reps: 6, rir: 0 });
    const refusing = fakeBase();
    refusing.fns.insertSet = async () => {
      throw { code: '22003', message: 'numeric field overflow' };
    };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await flush(refusing.fns);
    expect(readQuarantine()).toHaveLength(1);
    play(started(), deleteSet(started(), BENCH, 's3')!);
    await flush(fakeBase().fns);
    expect(readQuarantine()).toEqual([]);
  });

  it('badges recalculés : la série remontée se compare à la référence de son nouveau rang', () => {
    const reference = [ps(80, 7, 1, 1), ps(90, 8, 2, 2), ps(80, 6, 0, 3)];
    const state = started();
    // Avant : s2 (80×7 @1) au rang 2 face à 90×8, en deçà.
    expect(computeSetBadges(getProgress(state, BENCH).sets, reference, null)[1]).toBeNull();
    const next = captureReducer(state, deleteSet(state, BENCH, 's1')!.action);
    // Après : s2 est au rang 1, face à 80×7 @1 : égalée.
    expect(computeSetBadges(getProgress(next, BENCH).sets, reference, null)[0]).toEqual({ axis: 'reference', verdict: 'egalise' });
  });
});

describe('suppression et réponse tardive de la base', () => {
  const base = { [BENCH]: { sets: [ps(80, 8, 2, 1), ps(80, 7, 1, 2), ps(80, 6, 0, 3)], setIds: ['s1', 's2', 's3'] } };
  const insert = (id: string, setOrder: number, reps: number): InsertSetOp => ({
    type: 'insertSet',
    id,
    executionId: 'exec-1',
    exerciseId: BENCH,
    setOrder,
    weightKg: 80,
    reps,
    rir: 2,
  });

  it('suppression et renumérotation ACQUITTÉES pendant le trajet : la réponse ne ramène ni la série ni les anciens rangs', () => {
    const departure = started().progress;
    const after = captureReducer(started(), deleteSet(started(), BENCH, 's1')!.action);
    const next = captureReducer(after, {
      type: 'reconcile-progress',
      base,
      pendingSetIds: [],
      knownAtDeparture: ['s1', 's2', 's3'],
      departure,
      queuedOps: [],
    });
    expect(getProgress(next, BENCH).setIds).toEqual(['s2', 's3']);
    expect(getProgress(next, BENCH).sets.map((s) => s.order)).toEqual([1, 2]);
  });

  it('série annulée pendant le trajet alors que son insertion était en file au départ : elle ne ressuscite pas', () => {
    // L'insertion de s3 attendait au départ de la lecture ; s3 est supprimée
    // pendant le trajet, insertion et suppression acquittées avant le retour.
    const departure = started().progress;
    const after = captureReducer(started(), deleteSet(started(), BENCH, 's3')!.action);
    const next = captureReducer(after, {
      type: 'reconcile-progress',
      base: { [BENCH]: { sets: base[BENCH].sets.slice(0, 2), setIds: ['s1', 's2'] } },
      pendingSetIds: ['s3'],
      knownAtDeparture: ['s1', 's2', 's3'],
      departure,
      queuedOps: [insert('s3', 3, 6)],
    });
    expect(getProgress(next, BENCH).setIds).toEqual(['s1', 's2']);
  });

  it('une ancienne écriture relevée au départ ne défait pas une renumérotation faite depuis', () => {
    const departure = started().progress;
    const after = captureReducer(started(), deleteSet(started(), BENCH, 's1')!.action);
    const next = captureReducer(after, {
      type: 'reconcile-progress',
      base,
      pendingSetIds: ['s2'],
      knownAtDeparture: ['s1', 's2', 's3'],
      departure,
      // s2 était en file au départ, à son ancien rang 2.
      queuedOps: [insert('s2', 2, 7)],
    });
    expect(getProgress(next, BENCH).sets.map((s) => s.order)).toEqual([1, 2]);
    expect(getProgress(next, BENCH).setIds).toEqual(['s2', 's3']);
  });

  it('une écriture venue d’ailleurs sur une série NON touchée ici reste rejouée (Journal, autre onglet)', () => {
    const departure = started().progress;
    const next = captureReducer(started(), {
      type: 'reconcile-progress',
      base,
      pendingSetIds: ['s2'],
      knownAtDeparture: ['s1', 's2', 's3'],
      departure,
      queuedOps: [{ ...insert('s2', 2, 7), weightKg: 85, rir: 1 }],
    });
    expect(getProgress(next, BENCH).sets[1]).toEqual(ps(85, 7, 1, 2));
  });
});

// La réponse d'une lecture lente est livrée APRÈS que le serveur a acquitté des
// gestes faits pendant son trajet : aucun relevé de la file ne les montre plus,
// et l'état du départ ne connaît pas une série née entre-temps. Le tableau suit
// donc lui-même ses mutations locales, par id, suppressions comprises.
describe('réponse livrée après l’acquittement de gestes faits pendant son trajet', () => {
  /** Au départ de la lecture : une seule série. */
  const atDeparture = (): CaptureState => ({
    ...started(),
    progress: { [BENCH]: { sets: [ps(80, 8, 2, 1)], setIds: ['s1'], skipped: false } },
  });
  const logS2 = (state: CaptureState) =>
    captureReducer(state, { type: 'log-set', exerciseId: BENCH, setId: 's2', set: { weightKg: 80, reps: 7, rir: 1 } });
  /** La réponse : la lecture a vu S2 (insérée pendant son trajet), telle que loggée. */
  const late = (departure: CaptureState) => ({
    type: 'reconcile-progress' as const,
    base: { [BENCH]: { sets: [ps(80, 8, 2, 1), ps(80, 7, 1, 2)], setIds: ['s1', 's2'] } },
    pendingSetIds: [],
    knownAtDeparture: ['s1'],
    departure: departure.progress,
    queuedOps: [],
  });

  it('série née pendant le trajet, puis SUPPRIMÉE et acquittée : la réponse, qui la porte, ne la ressuscite pas', () => {
    let state = logS2(atDeparture());
    state = captureReducer(state, deleteSet(state, BENCH, 's2')!.action);
    const next = captureReducer(state, late(atDeparture()));
    expect(getProgress(next, BENCH).setIds).toEqual(['s1']);
  });

  it('pareil pour « Annuler la série » juste après le log', () => {
    let state = logS2(atDeparture());
    state = captureReducer(state, { type: 'undo-last-set', exerciseId: BENCH });
    expect(getProgress(captureReducer(state, late(atDeparture())), BENCH).setIds).toEqual(['s1']);
  });

  it('série née pendant le trajet, puis CORRIGÉE et acquittée : la réponse, qui porte l’ancienne valeur, ne masque pas la correction', () => {
    let state = logS2(atDeparture());
    state = captureReducer(state, correctSet(state, BENCH, 's2', { weightKg: 85, reps: 7, rir: 1 })!.action);
    const next = captureReducer(state, late(atDeparture()));
    expect(getProgress(next, BENCH).sets[1]).toEqual(ps(85, 7, 1, 2));
  });

  it('remontée de rang acquittée pendant le trajet : les rangs locaux tiennent, la série supprimée ne revient pas', () => {
    let state = logS2(atDeparture());
    state = captureReducer(state, deleteSet(state, BENCH, 's1')!.action);
    const next = captureReducer(state, late(atDeparture()));
    expect(getProgress(next, BENCH).setIds).toEqual(['s2']);
    expect(getProgress(next, BENCH).sets[0]).toEqual(ps(80, 7, 1, 1));
  });

  it('une ancienne écriture relevée dans la file ne rejoue pas une série supprimée ou corrigée ici', () => {
    let state = logS2(atDeparture());
    state = captureReducer(state, correctSet(state, BENCH, 's2', { weightKg: 85, reps: 7, rir: 1 })!.action);
    const stale = { type: 'insertSet', id: 's2', executionId: 'exec-1', exerciseId: BENCH, setOrder: 2, weightKg: 80, reps: 7, rir: 1 } as const;
    const next = captureReducer(state, { ...late(atDeparture()), queuedOps: [stale] });
    expect(getProgress(next, BENCH).sets[1]).toEqual(ps(85, 7, 1, 2));
  });

  it('série corrigée ici mais supprimée ailleurs (le Journal) : la réponse ne la porte pas, elle sort', () => {
    // Une correction n'écrit que des valeurs : en base, elle n'a rien recréé.
    let state = started();
    state = captureReducer(state, correctSet(state, BENCH, 's3', { weightKg: 85, reps: 6, rir: 0 })!.action);
    const next = captureReducer(state, {
      type: 'reconcile-progress',
      base: { [BENCH]: { sets: [ps(80, 8, 2, 1), ps(80, 7, 1, 2)], setIds: ['s1', 's2'] } },
      pendingSetIds: [],
      knownAtDeparture: ['s1', 's2', 's3'],
      departure: started().progress,
      queuedOps: [],
    });
    expect(getProgress(next, BENCH).setIds).toEqual(['s1', 's2']);
  });

  it('correction faite AVANT le départ d’une lecture neuve : la base, recorrigée ailleurs depuis, fait foi', () => {
    let state = logS2(atDeparture());
    state = captureReducer(state, correctSet(state, BENCH, 's2', { weightKg: 85, reps: 7, rir: 1 })!.action);
    // La lecture part maintenant : elle relève le compteur et l'état courant.
    const next = captureReducer(state, {
      type: 'reconcile-progress',
      base: { [BENCH]: { sets: [ps(80, 8, 2, 1), ps(90, 7, 1, 2)], setIds: ['s1', 's2'] } },
      pendingSetIds: [],
      knownAtDeparture: ['s1', 's2'],
      departure: state.progress,
      departureMark: mutationMark(state),
      queuedOps: [],
    });
    expect(getProgress(next, BENCH).sets[1]).toEqual(ps(90, 7, 1, 2));
  });

  it('série supprimée APRÈS le relevé d’une lecture neuve : elle ne revient pas', () => {
    let state = logS2(atDeparture());
    const mark = mutationMark(state);
    const departure = state.progress;
    state = captureReducer(state, deleteSet(state, BENCH, 's2')!.action);
    const next = captureReducer(state, { ...late(atDeparture()), departure, departureMark: mark, knownAtDeparture: ['s1', 's2'] });
    expect(getProgress(next, BENCH).setIds).toEqual(['s1']);
  });

  it('le suivi ne survit pas au rechargement : un état relu repart sans mutation locale', () => {
    let state = logS2(atDeparture());
    state = captureReducer(state, deleteSet(state, BENCH, 's2')!.action);
    expect(Object.keys(state.sinceLoad?.removed ?? {})).toEqual(['s2']);
    persist(state);
    expect(loadPersisted(upperA, DATE)!.sinceLoad).toBeUndefined();
  });
});

// Stockage de l'appareil plein : la file ne s'écrit plus, elle tient en mémoire
// (repli de l'outbox). Les gestes doivent partir comme d'habitude.
describe('gestes sur les séries sous stockage plein', () => {
  it('correction puis suppression tenues en mémoire : envoyées dans l’ordre, la base finit juste', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Séance déjà en base : trois séries, plus rien en file.
    const base = fakeBase();
    for (const [id, order, reps] of [['s1', 1, 8], ['s2', 2, 7], ['s3', 3, 6]] as const) {
      base.rows.set(id, { setOrder: order, weightKg: 80, reps, rir: 2 });
    }
    const setItem = localStorage.setItem.bind(localStorage);
    localStorage.setItem = (k: string, v: string) => {
      if (k === 'croustylift:outbox') throw new Error('QuotaExceededError');
      setItem(k, v);
    };

    let state = started();
    state = play(state, correctSet(state, BENCH, 's3', { weightKg: 82.5, reps: 6, rir: 0 })!);
    state = play(state, deleteSet(state, BENCH, 's1')!);
    expect(storageFailing()).toBe(true);
    expect(localStorage.getItem('croustylift:outbox')).toBeNull();
    expect(readQueue().map((op) => `${op.type}:${op.id}`)).toEqual([
      'patchSet:s3',
      'deleteSet:s1',
      'patchSet:s2',
      'patchSet:s3',
    ]);

    await flush(base.fns);
    expect(readQueue()).toEqual([]);
    expect([...base.rows.entries()].map(([id, row]) => `${id}:${row.weightKg}x${row.reps}@${row.setOrder}`)).toEqual([
      's2:80x7@1',
      's3:82.5x6@2',
    ]);
    // La suppression est partie avant les réécritures de rang.
    expect(base.sent.indexOf('delete:s1')).toBeLessThan(base.sent.indexOf('patch:s2:@1'));
    expect(getProgress(state, BENCH).sets).toEqual([ps(80, 7, 1, 1), ps(82.5, 6, 0, 2)]);
  });
});
