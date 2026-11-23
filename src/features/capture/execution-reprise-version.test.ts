// Reprise d'une séance dont le plan a été retouché en plein entraînement.
//
// L'exécution garde la version de séance sous laquelle elle est née (v1,
// `upsertExecution` est une insertion seule). La Capture, elle, recharge la
// version courante (v2). Le bug : la réhydratation cherchait l'exécution du jour
// PAR VERSION, ne trouvait donc plus celle que l'appareil tient en cours, et ne
// reprenait que son état local. Une série ajoutée entre-temps depuis le journal
// restait invisible : la série suivante réutilisait son rang (1, 2, 3, 3).
//
// On pilote le vrai `loadTodayExecution` et la vraie fusion (`mergeProgress`) ;
// seul le réseau est bouchonné (faux serveur filtrant derrière `lib/supabase`).
import { describe, it, expect, beforeEach, vi } from 'vitest';

type Row = Record<string, unknown>;

const server = vi.hoisted(() => ({
  executions: [] as Record<string, unknown>[],
  performed_sets: [] as Record<string, unknown>[],
}));

vi.mock('../../lib/supabase', () => {
  const from = (table: string) => {
    if (table === 'dated_notes') {
      const query = {
        select: () => query,
        eq: () => query,
        order: () => Promise.resolve({ data: [], error: null }),
      };
      return query;
    }
    if (table !== 'executions' && table !== 'performed_sets') {
      throw new Error(`table inattendue dans ce test : ${table}`);
    }
    const filters: ((row: Row) => boolean)[] = [];
    const rows = () => server[table].filter((row) => filters.every((f) => f(row)));
    const query = {
      select: () => query,
      eq: (column: string, value: unknown) => (filters.push((r) => r[column] === value), query),
      is: (column: string, value: unknown) => (filters.push((r) => (r[column] ?? null) === value), query),
      // `performed_sets` s'arrête à `order` (attendu tel quel) ; `executions` enchaîne.
      order: () =>
        table === 'performed_sets' ? Promise.resolve({ data: rows(), error: null }) : query,
      limit: () => query,
      maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
    };
    return query;
  };
  return { supabase: { from } };
});

import { loadTodayExecution } from './data';
import { clearQueue, enqueue } from './outbox';
import { captureReducer, getProgress, hydratedState, initialState, mergeProgress, nextSetOrder } from './state';
import { upperA } from './fixtures';
import { saveLocalAccount } from '../../lib/local-account';

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(k: string): string | null {
    return this.store.has(k) ? (this.store.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.store.set(k, String(v));
  }
  removeItem(k: string): void {
    this.store.delete(k);
  }
  clear(): void {
    this.store.clear();
  }
  get length(): number {
    return this.store.size;
  }
  key(i: number): string | null {
    return [...this.store.keys()][i] ?? null;
  }
}

const DATE = '2026-11-23';
const EXO = upperA.exercises[0]!.exerciseId;

const serie = (id: string, order: number): Row => ({
  id,
  execution_id: 'exec-1',
  exercise_id: EXO,
  weight_kg: 80,
  reps: 8,
  rir: 2,
  set_order: order,
  side: null,
});

/** L'état local de l'appareil : la séance entamée sous v1, deux séries loggées. */
function etatLocal() {
  let state = { ...initialState(upperA, DATE), executionId: 'exec-1' };
  for (const setId of ['set-1', 'set-2']) {
    state = captureReducer(state, {
      type: 'log-set',
      exerciseId: EXO,
      setId,
      set: { weightKg: 80, reps: 8, rir: 2 },
    });
  }
  return state;
}

/** Le rang que prendrait la prochaine série, comme la Capture le dérive au montage. */
async function rangSuivant(localExecutionId: string | null): Promise<number> {
  const restored = etatLocal();
  const today = await loadTodayExecution('v2', DATE, localExecutionId);
  const fromBase = hydratedState(
    upperA,
    today?.progress ?? {},
    today?.datedNotes ?? {},
    DATE,
    today?.executionId ?? 'exec-neuve',
  );
  const merged = mergeProgress(fromBase, restored);
  expect(merged.executionId).toBe('exec-1');
  return nextSetOrder(getProgress(merged, EXO), undefined);
}

beforeEach(() => {
  (globalThis as unknown as { localStorage: Storage }).localStorage =
    new MemoryStorage() as unknown as Storage;
  saveLocalAccount({ userId: 'user-1', email: 'toi@exemple.com' });
  clearQueue();
  // En base : l'exécution est restée en v1, et porte TROIS séries (la 3ᵉ ajoutée
  // depuis le journal, que l'état local de la Capture ne connaît pas).
  server.executions = [
    {
      id: 'exec-1',
      seance_version_id: 'v1',
      performed_on: DATE,
      started_at: '2026-11-23T18:00:00.000Z',
      created_at: '2026-11-23T18:01:00.000Z',
      closed_at: null,
      duration_min: null,
    },
  ];
  server.performed_sets = [serie('set-1', 1), serie('set-2', 2), serie('set-journal', 3)];
});

describe('reprise après retouche du plan en pleine séance', () => {
  it('l’exécution tenue par l’appareil est relue par son id, même restée en v1 : rang 4', async () => {
    expect(await rangSuivant('exec-1')).toBe(4);
    expect(server.executions[0]?.seance_version_id).toBe('v1');
  });

  it('sans id local, la recherche reste par version : rien sous v2', async () => {
    expect(await loadTodayExecution('v2', DATE)).toBeNull();
    expect((await loadTodayExecution('v1', DATE))?.executionId).toBe('exec-1');
  });

  it('l’id local prime sur une autre exécution ouverte du jour sous la version courante', async () => {
    server.executions.push({
      id: 'exec-autre',
      seance_version_id: 'v2',
      performed_on: DATE,
      started_at: null,
      created_at: '2026-11-23T19:00:00.000Z',
      closed_at: null,
      duration_min: null,
    });
    expect((await loadTodayExecution('v2', DATE, 'exec-1'))?.executionId).toBe('exec-1');
  });

  it('exécution locale déjà close en base : pas reprise', async () => {
    server.executions[0]!.closed_at = '2026-11-23T19:02:00.000Z';
    expect(await loadTodayExecution('v2', DATE, 'exec-1')).toBeNull();
  });

  it('exécution locale que la file clôt ou supprime : pas reprise (même garde)', async () => {
    enqueue({ type: 'deleteExecution', id: 'exec-1' });
    expect(await loadTodayExecution('v2', DATE, 'exec-1')).toBeNull();
  });
});

// Série annulée dont la suppression attend encore (audit sync, constat 8, variante).
//
// L'annulation retire la série de l'état local et enfile un `deleteSet`. Tant
// qu'il n'est pas acquitté, la base porte encore la série. La fusion garde la
// liste la plus longue : au remontage (changement d'onglet, reprise) la série
// annulée revenait à l'écran et faussait le rang de la suivante.
describe('série annulée dont la suppression attend encore', () => {
  /** L'état local après l'annulation de la 2ᵉ série : il n'en reste qu'une. */
  function etatApresAnnulation() {
    return captureReducer(etatLocal(), { type: 'undo-last-set', exerciseId: EXO });
  }

  async function reprise() {
    const today = await loadTodayExecution('v1', DATE, 'exec-1');
    const fromBase = hydratedState(upperA, today?.progress ?? {}, {}, DATE, today?.executionId);
    return getProgress(mergeProgress(fromBase, etatApresAnnulation()), EXO);
  }

  beforeEach(() => {
    server.performed_sets = [serie('set-1', 1), serie('set-2', 2)];
  });

  it('la série annulée ne revient pas à l’écran, et le rang suivant est le sien', async () => {
    enqueue({ type: 'deleteSet', id: 'set-2', exerciseIds: [EXO] });

    const progress = await reprise();

    expect(progress.setIds).toEqual(['set-1']);
    expect(nextSetOrder(progress, undefined)).toBe(2);
  });

  it('sans état local (stockage vidé), la série annulée ne revient pas non plus', async () => {
    enqueue({ type: 'deleteSet', id: 'set-2', exerciseIds: [EXO] });

    const today = await loadTodayExecution('v1', DATE, 'exec-1');

    expect(today?.progress[EXO]?.setIds).toEqual(['set-1']);
  });

  it('un exo dont toutes les séries sont annulées disparaît du réalisé relu', async () => {
    enqueue({ type: 'deleteSet', id: 'set-1' });
    enqueue({ type: 'deleteSet', id: 'set-2' });

    const today = await loadTodayExecution('v1', DATE, 'exec-1');

    expect(today?.progress[EXO]).toBeUndefined();
  });

  it('sans suppression en attente, le réalisé de la base est repris tel quel', async () => {
    const today = await loadTodayExecution('v1', DATE, 'exec-1');

    expect(today?.progress[EXO]?.setIds).toEqual(['set-1', 'set-2']);
  });
});
