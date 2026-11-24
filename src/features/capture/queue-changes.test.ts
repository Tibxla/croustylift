// Le sélecteur « Quelle séance ? » relit la file et la méta quand la file a pu
// changer : retrait après un flush (ici ou dans un autre onglet), geste de
// l'écran, retour du réseau (queue-changes.ts).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FlushResult } from './outbox';

const { flushMock } = vi.hoisted(() => ({
  flushMock: vi.fn<(...args: unknown[]) => Promise<FlushResult>>(),
}));
vi.mock('./outbox', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./outbox')>();
  return { ...actual, flush: flushMock };
});
vi.mock('./data', () => ({
  deleteExecutionById: vi.fn(),
  deleteExecutionIfEmpty: vi.fn(),
  deleteSetById: vi.fn(),
  patchSet: vi.fn(),
  exercisesHoldingRows: vi.fn(() => []),
  refreshExerciseRows: vi.fn(async () => undefined),
  updateExecution: vi.fn(),
  upsertExecution: vi.fn(),
  upsertSet: vi.fn(),
}));
vi.mock('../notes/data', () => ({
  upsertDatedNote: vi.fn(),
  deleteDatedNoteById: vi.fn(),
  deleteDatedNoteByCouple: vi.fn(),
  upsertExerciseNoteRow: vi.fn(),
  deleteExerciseNoteByExercise: vi.fn(),
}));

import { onQueueChanged, OUTBOX_STORAGE_KEY } from './queue-changes';
import { flushOutbox } from './sync';
import { enqueue, OUTBOX_CHANGED_EVENT } from './outbox';

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

const storageEvent = (key: string | null) => Object.assign(new Event('storage'), { key });

beforeEach(() => {
  (globalThis as unknown as { localStorage: Storage }).localStorage = new MemoryStorage() as unknown as Storage;
  flushMock.mockReset();
});

describe('onQueueChanged', () => {
  it('la clé de stockage épinglée est bien celle de la file (outbox.ts, gelé)', () => {
    enqueue({ type: 'upsertExecution', id: 'e1', seanceVersionId: 'v1', performedOn: '2026-11-24' });
    expect(localStorage.getItem(OUTBOX_STORAGE_KEY)).toContain('e1');
  });

  it('un flush de CET onglet qui se termine (retrait de la file) prévient', async () => {
    const listener = vi.fn();
    const off = onQueueChanged(listener, new EventTarget());
    flushMock.mockResolvedValueOnce({ remaining: 0, flushed: 1 });
    await flushOutbox();
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    flushMock.mockResolvedValueOnce({ remaining: 0, flushed: 1 });
    await flushOutbox();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('la file d’un AUTRE onglet qui change (événement storage de sa clé) prévient, une autre clé non', () => {
    const target = new EventTarget();
    const listener = vi.fn();
    const off = onQueueChanged(listener, target);
    target.dispatchEvent(storageEvent('croustylift:readcache:user-1:vue:journal'));
    expect(listener).not.toHaveBeenCalled();
    target.dispatchEvent(storageEvent(OUTBOX_STORAGE_KEY));
    // `clear()` du stockage : clé nulle.
    target.dispatchEvent(storageEvent(null));
    expect(listener).toHaveBeenCalledTimes(2);
    off();
  });

  it('un geste de l’écran (OUTBOX_CHANGED_EVENT) et le retour du réseau préviennent ; plus rien après le démontage', () => {
    const target = new EventTarget();
    const listener = vi.fn();
    const off = onQueueChanged(listener, target);
    target.dispatchEvent(new Event(OUTBOX_CHANGED_EVENT));
    target.dispatchEvent(new Event('online'));
    expect(listener).toHaveBeenCalledTimes(2);
    off();
    target.dispatchEvent(new Event('online'));
    target.dispatchEvent(storageEvent(OUTBOX_STORAGE_KEY));
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
