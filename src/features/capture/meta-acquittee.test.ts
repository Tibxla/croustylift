// « Quelle séance ? » après la suppression ACQUITTÉE d'une exécution, quand le
// réseau tombe juste après : la ligne ne doit pas reprendre la date de
// l'exécution supprimée (ni sur l'écran, ni au remontage), et une lecture partie
// AVANT la suppression ne doit pas être acceptée. Le masque tient jusqu'à ce
// qu'une lecture partie après l'acquittement soit acceptée.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FlushResult, OutboxOp } from './outbox';

const { flushMock } = vi.hoisted(() => ({
  flushMock: vi.fn<(...args: unknown[]) => Promise<FlushResult>>(),
}));
vi.mock('./outbox', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./outbox')>();
  return { ...actual, flush: flushMock };
});
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('./data', () => ({
  deleteExecutionById: vi.fn(async () => undefined),
  deleteExecutionIfEmpty: vi.fn(async () => 'deleted'),
  deleteSetById: vi.fn(),
  patchSet: vi.fn(),
  exercisesHoldingRows: vi.fn(() => []),
  refreshExerciseRows: vi.fn(async () => undefined),
  updateExecution: vi.fn(),
  upsertExecution: vi.fn(async () => undefined),
  upsertSet: vi.fn(),
}));
vi.mock('../notes/data', () => ({
  upsertDatedNote: vi.fn(),
  deleteDatedNoteById: vi.fn(),
  deleteDatedNoteByCouple: vi.fn(),
  upsertExerciseNoteRow: vi.fn(),
  deleteExerciseNoteByExercise: vi.fn(),
}));

import { flushOutbox, syncFns } from './sync';
import { clearQueue, enqueue, readOwnQueue } from './outbox';
import { clearReadCache } from '../../lib/read-cache';
import { saveLocalAccount } from '../../lib/local-account';
import { watchSeancesMeta } from './seance-meta-load';
import { mergePendingExecutions, peekSeancesMeta, readAckedExecutions, type StoredMap } from './seance-meta';

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

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const meta = (lastOn: string, lastExecutionId: string): StoredMap => ({
  a: { lastOn, lastExecutionId, exerciseCount: 4, versionIds: ['v1'] },
});
/** Ce que la ligne de la séance `a` affiche : la copie, la file, les acquittées. */
const shown = () => mergePendingExecutions(peekSeancesMeta(), [...readOwnQueue(), ...readAckedExecutions()]).a;

/** Une passe qui acquitte les ops en file, puis les retire de la file. */
function acknowledgeQueue() {
  flushMock.mockImplementationOnce(async () => {
    const ops = readOwnQueue();
    for (const op of ops) {
      if (op.type === 'deleteExecution') await syncFns.deleteExecution(op);
      if (op.type === 'upsertExecution') await syncFns.upsertExecution(op);
    }
    clearQueue();
    return { remaining: 0, flushed: ops.length };
  });
}

const DELETE: OutboxOp = { type: 'deleteExecution', id: 'exec-supprimee', exerciseIds: [] };

beforeEach(() => {
  (globalThis as unknown as { localStorage: Storage }).localStorage = new MemoryStorage() as unknown as Storage;
  clearReadCache();
  clearQueue();
  saveLocalAccount({ userId: 'user-1', email: 'toi@exemple.com' });
  flushMock.mockReset();
});

describe('méta après une suppression acquittée', () => {
  it('panne réseau juste après l’acquittement : la date supprimée ne revient pas, même au remontage ; elle part avec une lecture d’après', async () => {
    const first = watchSeancesMeta(['a'], () => {}, { fetcher: async () => meta('2026-11-20', 'exec-supprimee') });
    await settle();
    first.stop();
    enqueue(DELETE);
    expect(shown()).toBeNull();

    acknowledgeQueue();
    await flushOutbox();
    // Le réseau tombe : la relecture échoue.
    const down = watchSeancesMeta(['a'], () => {}, { fetcher: () => Promise.reject(new Error('hors ligne')) });
    await settle();
    expect(shown()).toBeNull();
    down.stop();

    // Remontage, toujours sans réseau : le masque est dans le stockage.
    const again = watchSeancesMeta(['a'], () => {}, { fetcher: () => Promise.reject(new Error('hors ligne')) });
    await settle();
    expect(shown()).toBeNull();
    again.stop();

    // Le réseau revient : une lecture partie après l'acquittement est acceptée.
    const back = watchSeancesMeta(['a'], () => {}, { fetcher: async () => meta('2026-11-18', 'exec-precedente') });
    await settle();
    expect(shown()).toEqual({ lastOn: '2026-11-18', exerciseCount: 4 });
    expect(readAckedExecutions()).toEqual([]);
    back.stop();
  });

  it('une lecture partie AVANT la suppression, qui répond après, n’est pas acceptée', async () => {
    const first = watchSeancesMeta(['a'], () => {}, { fetcher: async () => meta('2026-11-20', 'exec-supprimee') });
    await settle();
    first.stop();
    let answer: (m: StoredMap) => void = () => {};
    const seen: StoredMap[] = [];
    const watch = watchSeancesMeta(['a'], (m) => seen.push(m), { fetcher: () => new Promise<StoredMap>((ok) => (answer = ok)) });
    enqueue(DELETE);
    acknowledgeQueue();
    await flushOutbox();
    answer(meta('2026-11-20', 'exec-supprimee'));
    await settle();
    // Seule l'amorce (la copie) a été montrée ; la réponse d'avant est jetée.
    expect(seen).toHaveLength(1);
    expect(shown()).toBeNull();
    watch.stop();
  });

  it('une exécution acquittée (séance faite) garde sa date tant qu’aucune relecture ne l’a apportée', async () => {
    const first = watchSeancesMeta(['a'], () => {}, { fetcher: async () => meta('2026-11-20', 'exec-precedente') });
    await settle();
    first.stop();
    enqueue({ type: 'upsertExecution', id: 'exec-du-jour', seanceVersionId: 'v1', performedOn: '2026-11-24' });
    acknowledgeQueue();
    await flushOutbox();
    expect(shown()?.lastOn).toBe('2026-11-24');
  });
});
