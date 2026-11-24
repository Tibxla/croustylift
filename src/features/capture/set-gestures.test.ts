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
  type InsertSetOp,
  type OutboxOp,
  type SyncFns,
} from './outbox';
import { computeSetBadges } from './set-badges';
import { correctSet, deleteSet, ranksAfterDeletion } from './set-gestures';
import {
  captureReducer,
  getProgress,
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
      { type: 'insertSet', id: 's2', executionId: 'exec-1', exerciseId: BENCH, setOrder: 2, weightKg: 77.5, reps: 9, rir: 2 },
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
      { type: 'insertSet', id: 'r1', executionId: 'exec-1', exerciseId: 'curl', setOrder: 1, weightKg: 12, reps: 10, rir: 1, side: 'right' },
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
    expect(base.sent).toEqual(['upsert:s1:80x8@1', 'upsert:s1:85x6@1']);
    expect(base.rows.get('s1')).toMatchObject({ weightKg: 85, reps: 6, rir: 1, setOrder: 1 });
    expect(readQueue()).toEqual([]);
  });

  it('deux corrections de suite : la dernière gagne en base', async () => {
    const first = play(started(), correctSet(started(), BENCH, 's1', { weightKg: 85, reps: 6, rir: 1 })!);
    const second = play(first, correctSet(first, BENCH, 's1', { weightKg: 82.5, reps: 7, rir: 1 })!);
    expect(getProgress(second, BENCH).sets[0]).toEqual(ps(82.5, 7, 1, 1));
    const base = fakeBase();
    await flush(base.fns);
    expect(base.rows.get('s1')).toMatchObject({ weightKg: 82.5, reps: 7 });
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

    // La correction remplace l'écriture refusée : plus rien en quarantaine pour
    // cette série (« renvoyer » réécrirait l'ancienne valeur, et la Déconnexion
    // resterait retenue par une saisie qui n'a plus d'objet).
    play(started(), correctSet(started(), BENCH, 's1', { weightKg: 85, reps: 6, rir: 1 })!);
    expect(readQuarantine()).toEqual([]);
    const base = fakeBase();
    await flush(base.fns);
    expect(base.rows.get('s1')).toMatchObject({ weightKg: 85 });
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
    expect(ranksAfterDeletion(sets, 2).map((s) => s.order)).toEqual([1, 2, 3]);
    expect(ranksAfterDeletion(sets, 2).map((s) => s.reps)).toEqual([8, 6, 8]);
  });

  it('la règle par défaut est la remontée', () => {
    expect(ranksAfterDeletion(sets, 2)).toEqual(ranksAfterDeletion(sets, 2, 'compact'));
  });

  it('trou (l’autre règle, un argument à changer) : les rangs restants ne bougent pas', () => {
    expect(ranksAfterDeletion(sets, 2, 'gap').map((s) => s.order)).toEqual([1, 3, 4]);
  });

  it('unilatéral : la série entière part, gauche et droite, et les deux côtés des suivantes remontent ensemble', () => {
    const uni = [ps(12, 10, 2, 1, 'left'), ps(12, 10, 2, 1, 'right'), ps(12, 9, 2, 2, 'left'), ps(12, 9, 2, 2, 'right'), ps(12, 8, 1, 3, 'left')];
    expect(ranksAfterDeletion(uni, 1).map((s) => `${s.order}${s.side}`)).toEqual(['1left', '1right', '2left']);
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
      { type: 'insertSet', id: 's2', executionId: 'exec-1', exerciseId: BENCH, setOrder: 1, weightKg: 80, reps: 7, rir: 1 },
      { type: 'insertSet', id: 's3', executionId: 'exec-1', exerciseId: BENCH, setOrder: 2, weightKg: 80, reps: 6, rir: 0 },
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
    expect(gesture.ops.filter((op) => op.type === 'insertSet')).toEqual([
      { type: 'insertSet', id: 'l2', executionId: 'exec-1', exerciseId: 'curl', setOrder: 1, weightKg: 12, reps: 9, rir: 1, side: 'left' },
      { type: 'insertSet', id: 'r2', executionId: 'exec-1', exerciseId: 'curl', setOrder: 1, weightKg: 12, reps: 9, rir: 1, side: 'right' },
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
    expect(base.sent.indexOf('delete:s2')).toBeLessThan(base.sent.indexOf('upsert:s3:80x6@2'));
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
