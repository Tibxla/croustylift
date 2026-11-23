// Deux ONGLETS sur la même file (relecture Codex du lot 3A) : deux instances du
// module `outbox`, un seul stockage partagé, comme deux onglets du navigateur.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { OutboxOp, SyncFns } from './outbox';

type Outbox = typeof import('./outbox');

/** Stockage partagé, énumérable, dont l'écriture de la file peut être refusée. */
class SharedStorage {
  store = new Map<string, string>();
  /** Refuse l'écriture de la file (quota plein). */
  full = false;
  getItem(k: string): string | null {
    return this.store.has(k) ? (this.store.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    if (this.full && k === 'croustylift:outbox') throw new Error('QuotaExceededError');
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

let storage: SharedStorage;

/** Une instance neuve du module : un onglet, avec sa mémoire propre. */
async function openTab(): Promise<Outbox> {
  vi.resetModules();
  return import('./outbox');
}

const setOp = (id: string): OutboxOp => ({
  type: 'insertSet',
  id,
  executionId: 'exec-1',
  exerciseId: 'bench',
  setOrder: 1,
  weightKg: 80,
  reps: 8,
  rir: 2,
});

/** SyncFns qui notent ce qui part, avec un `insertSet` remplaçable. */
function recorder(insertSet?: (op: OutboxOp) => Promise<void>): { fns: SyncFns; sent: string[] } {
  const sent: string[] = [];
  const ok = async (op: { id: string }) => void sent.push(op.id);
  const fns = {
    upsertExecution: ok,
    insertSet: insertSet ?? ok,
    deleteSet: ok,
    updateExecution: ok,
    upsertDatedNote: ok,
    deleteDatedNote: ok,
    upsertExerciseNote: ok,
    deleteExerciseNote: ok,
    deleteExecution: ok,
  } as unknown as SyncFns;
  return { fns, sent };
}

const persistedIds = () =>
  (JSON.parse(storage.getItem('croustylift:outbox') ?? '[]') as OutboxOp[]).map((op) => op.id);

beforeEach(() => {
  storage = new SharedStorage();
  (globalThis as unknown as { localStorage: Storage }).localStorage = storage as unknown as Storage;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('stockage plein dans un onglet, écritures d’un autre onglet', () => {
  it('le repli mémoire de A n’efface pas la série persistée entre-temps par B', async () => {
    const a = await openTab();
    const b = await openTab();
    // A persiste S0, puis le stockage refuse S1 : A la tient en mémoire.
    a.enqueue(setOp('S0'));
    storage.full = true;
    a.enqueue(setOp('S1'));
    expect(a.storageFailing()).toBe(true);
    // B envoie S0, la place revient, B persiste S2.
    storage.full = false;
    const tabB = recorder();
    await b.flush(tabB.fns);
    expect(tabB.sent).toEqual(['S0']);
    b.enqueue(setOp('S2'));
    expect(persistedIds()).toEqual(['S2']);

    // A reprend la synchro : il voit S2 (file relue) et sa propre S1.
    expect(a.readQueue().map((op) => op.id).sort()).toEqual(['S1', 'S2']);
    const tabA = recorder();
    await a.flush(tabA.fns);

    // Avant : A réécrivait la file depuis son miroir, S2 disparaissait sans
    // jamais avoir été envoyée. S0, déjà envoyée par B, ne repart pas.
    expect(tabA.sent.sort()).toEqual(['S1', 'S2']);
    expect(persistedIds()).toEqual([]);
    expect(a.storageFailing()).toBe(false);
  });

  it('un retrait tenu en mémoire par A ne réécrit pas la file : la série de B reste', async () => {
    const a = await openTab();
    const b = await openTab();
    a.enqueue(setOp('S0'));
    a.enqueue(setOp('S1'));
    // Le stockage refuse le retrait de S0 après son envoi par A.
    storage.full = true;
    const tabA = recorder(async (op) => {
      if (op.id === 'S1') throw new Error('offline');
    });
    await a.flush(tabA.fns);
    expect(a.readQueue().map((op) => op.id)).toEqual(['S1']);
    // B, lui, peut écrire : il ajoute S2 à la file persistée.
    storage.full = false;
    b.enqueue(setOp('S2'));

    // A relit : S0 reste retirée pour lui, S1 et S2 sont là.
    expect(a.readQueue().map((op) => op.id)).toEqual(['S1', 'S2']);
  });
});
