// Les copies d'écran de l'Analyse face à une écriture du réalisé acquittée
// (sync.ts, lib/dated-read). Le Journal monté relit sa vue au retour du réseau
// EN PARALLÈLE du flush : si sa lecture atteint la base avant le DELETE, elle
// rapporte encore la séance supprimée. L'acquittement doit périmer la vue montée
// et la faire relire ; un écran fermé, lui, n'est ni relu ni périmé (relu à son
// ouverture, copie d'abord : cf. l'en-tête de dated-read).
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FlushResult, OutboxOp } from './outbox';

const { flushMock } = vi.hoisted(() => ({
  flushMock: vi.fn<(...args: unknown[]) => Promise<FlushResult>>(),
}));
vi.mock('./outbox', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./outbox')>();
  return { ...actual, flush: flushMock };
});
vi.mock('./data', () => ({
  deleteExecutionById: vi.fn(async () => undefined),
  deleteExecutionIfEmpty: vi.fn(async () => 'deleted'),
  deleteSetById: vi.fn(async () => undefined),
  patchSet: vi.fn(async () => undefined),
  exercisesHoldingRows: vi.fn(() => []),
  refreshExerciseRows: vi.fn(async () => undefined),
  updateExecution: vi.fn(async () => undefined),
  upsertExecution: vi.fn(async () => undefined),
  upsertSet: vi.fn(async () => undefined),
}));
vi.mock('../notes/data', () => ({
  upsertDatedNote: vi.fn(),
  deleteDatedNoteById: vi.fn(),
  deleteDatedNoteByCouple: vi.fn(),
  upsertExerciseNoteRow: vi.fn(),
  deleteExerciseNoteByExercise: vi.fn(),
}));

import { flushOutbox, syncFns } from './sync';
import { clearReadCache, peekFreshRead, peekRead } from '../../lib/read-cache';
import { saveLocalAccount } from '../../lib/local-account';
import { ACK_CHANNEL, closeAckChannel, JOURNAL_VIEW, loadDated, mountView, watchDated, type DatedState } from '../../lib/dated-read';

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

/**
 * Une passe qui acquitte `ops` par les vraies fonctions de sync, et le dit
 * (`settled`, registre) : c'est de là que sync.ts tire les effets d'un acquittement.
 */
function acknowledging(ops: OutboxOp[]) {
  flushMock.mockImplementationOnce(async () => {
    for (const op of ops) {
      if (op.type === 'deleteExecution') await syncFns.deleteExecution(op);
    }
    return {
      remaining: 0,
      flushed: ops.length,
      settled: ops.map((op, i) => ({ uid: `u${i}`, op, fate: 'acked' as const, touches: [] })),
    };
  });
}

const DELETE: OutboxOp = { type: 'deleteExecution', id: 'exec-supprimee', exerciseIds: ['ex-1'] };

beforeEach(() => {
  (globalThis as unknown as { localStorage: Storage }).localStorage = new MemoryStorage() as unknown as Storage;
  clearReadCache();
  saveLocalAccount({ userId: 'user-1', email: 'toi@exemple.com' });
  flushMock.mockReset();
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterAll(() => closeAckChannel());

describe('acquittement d’une écriture du réalisé', () => {
  it('Journal monté, lecture arrivée avant le DELETE : la copie est marquée à rafraîchir, montrée d’abord, puis relue', async () => {
    // La relecture du retour réseau atteint la base AVANT le DELETE : elle
    // rapporte encore la séance et sème la copie.
    await loadDated(JOURNAL_VIEW, async () => ['exec-supprimee', 'exec-gardee'], { offline: false, now: () => 1000 });
    const refresh = vi.fn();
    const unmount = mountView(JOURNAL_VIEW, refresh);

    acknowledging([DELETE]);
    await flushOutbox();

    expect(refresh).toHaveBeenCalledTimes(1);
    // Marquée à rafraîchir : plus tenue pour fraîche, mais gardée.
    expect(peekFreshRead(JOURNAL_VIEW)).toBeNull();
    expect(peekRead(JOURNAL_VIEW)).not.toBeNull();
    // La relecture montre la copie d'abord, puis la remplace.
    const seen: DatedState<string[]>[] = [];
    const stop = watchDated<string[]>(JOURNAL_VIEW, (s) => seen.push(s));
    const state = await loadDated(JOURNAL_VIEW, async () => ['exec-gardee'], { offline: false, now: () => 2000 });
    expect(state).toMatchObject({ phase: 'ready', copy: true, value: ['exec-supprimee', 'exec-gardee'] });
    await settle();
    expect(seen).toEqual([{ phase: 'ready', value: ['exec-gardee'], at: 2000, copy: false }]);
    expect(peekFreshRead(JOURNAL_VIEW)).not.toBeNull();
    stop();
    unmount();
  });

  it('écran fermé : la copie est marquée à rafraîchir et gardée, rien n’est relu', async () => {
    await loadDated(JOURNAL_VIEW, async () => ['exec-supprimee'], { offline: false, now: () => 1000 });
    const refresh = vi.fn();
    mountView(JOURNAL_VIEW, refresh)();

    acknowledging([DELETE]);
    await flushOutbox();

    expect(refresh).not.toHaveBeenCalled();
    expect(peekFreshRead(JOURNAL_VIEW)).toBeNull();
    // Hors ligne, elle se montre encore.
    await expect(loadDated(JOURNAL_VIEW, async () => [], { offline: true })).resolves.toMatchObject({ phase: 'ready', copy: true });
  });

  it('une lecture partie avant l’acquittement n’écrit plus la copie', async () => {
    await loadDated(JOURNAL_VIEW, async () => ['exec-supprimee'], { offline: false, now: () => 1000 });
    let answer: (v: string[]) => void = () => {};
    const late = loadDated(JOURNAL_VIEW, () => new Promise<string[]>((ok) => (answer = ok)), { offline: false, now: () => 1500 });
    acknowledging([DELETE]);
    await flushOutbox();
    answer(['exec-supprimee', 'lue avant le DELETE']);
    await late;
    await settle();
    expect(peekRead<{ value: string[] }>(JOURNAL_VIEW)?.value).toEqual(['exec-supprimee']);
  });

  it('ce que la passe n’a pas fait en base (suppression conditionnelle sans effet, écriture refusée) ne relit pas le Journal monté', async () => {
    const refresh = vi.fn();
    const unmount = mountView(JOURNAL_VIEW, refresh);
    flushMock.mockResolvedValueOnce({
      remaining: 0,
      flushed: 1,
      settled: [
        { uid: 'u1', op: { type: 'deleteExecutionIfEmpty', id: 'exec-gardee' }, fate: 'acked', touches: [], noEffect: true },
        { uid: 'u2', op: DELETE, fate: 'refused', touches: [] },
      ],
    });
    await flushOutbox();
    expect(refresh).not.toHaveBeenCalled();
    unmount();
  });

  it('une passe partagée par deux appelants (flush mémoïsé) ne relit le Journal monté qu’une fois', async () => {
    const refresh = vi.fn();
    const unmount = mountView(JOURNAL_VIEW, refresh);
    const shared = Promise.resolve<FlushResult>({
      remaining: 0,
      flushed: 1,
      settled: [{ uid: 'u1', op: DELETE, fate: 'acked', touches: ['ex-1'] }],
    });
    flushMock.mockReturnValue(shared);
    await Promise.all([flushOutbox(), flushOutbox()]);
    expect(refresh).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('une passe sans écriture du réalisé ne relit pas le Journal monté', async () => {
    const refresh = vi.fn();
    const unmount = mountView(JOURNAL_VIEW, refresh);
    flushMock.mockResolvedValueOnce({ remaining: 0, flushed: 0, settled: [] });
    await flushOutbox();
    expect(refresh).not.toHaveBeenCalled();
    unmount();
  });
});

describe('acquittement fait dans un autre onglet', () => {
  it('le message d’un autre onglet relit le Journal monté ici (la marque et la génération, l’émetteur les a posées : cf. lib/acquittement-onglets.test.ts)', async () => {
    const refresh = vi.fn();
    const unmount = mountView(JOURNAL_VIEW, refresh);
    const other = new BroadcastChannel(ACK_CHANNEL);
    other.postMessage({ userId: 'user-1', prefixes: [JOURNAL_VIEW] });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(refresh).toHaveBeenCalledTimes(1);
    other.close();
    unmount();
  });

  it('le message d’un autre compte est ignoré', async () => {
    const refresh = vi.fn();
    const unmount = mountView(JOURNAL_VIEW, refresh);
    const other = new BroadcastChannel(ACK_CHANNEL);
    other.postMessage({ userId: 'quelqu-un-d-autre', prefixes: [JOURNAL_VIEW] });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(refresh).not.toHaveBeenCalled();
    other.close();
    unmount();
  });
});
