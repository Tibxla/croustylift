// Lignes touchées par `update` et `delete` (audit sync, constat 4, piste).
//
// PostgREST ne signale pas une écriture qui ne trouve aucune ligne. Les
// fonctions de sync demandent donc les lignes touchées et en rendent le nombre.
// Zéro ligne reste un succès : une suppression est idempotente, et une clôture
// sans ligne veut dire que l'exécution n'existe pas en base (rien à clore).
import { describe, it, expect, beforeEach, vi } from 'vitest';

type Row = Record<string, unknown>;

const server = vi.hoisted(() => ({
  executions: [] as Record<string, unknown>[],
  performed_sets: [] as Record<string, unknown>[],
  dated_notes: [] as Record<string, unknown>[],
}));

vi.mock('../../lib/supabase', () => {
  type Table = keyof typeof server;
  const from = (table: Table) => {
    const write = (apply: (row: Row) => Row | null) => ({
      eq: (column: string, value: unknown) => ({
        select: () => {
          const touched = server[table].filter((row) => row[column] === value);
          server[table] = server[table].flatMap((row) => {
            if (row[column] !== value) return [row];
            const next = apply(row);
            return next ? [next] : [];
          });
          return Promise.resolve({ data: touched.map((row) => ({ id: row.id })), error: null });
        },
      }),
    });
    return {
      update: (patch: Row) => write((row) => ({ ...row, ...patch })),
      delete: () => write(() => null),
    };
  };
  return { supabase: { from } };
});

import { deleteExecutionById, deleteSetById, updateExecution } from './data';
import { deleteDatedNoteById } from '../notes/data';
import { clearQueue, enqueue, flush, readQuarantine, readQueue } from './outbox';
import { syncFns } from './sync';

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
  get length(): number {
    return this.store.size;
  }
  key(i: number): string | null {
    return [...this.store.keys()][i] ?? null;
  }
}

beforeEach(() => {
  (globalThis as unknown as { localStorage: Storage }).localStorage =
    new MemoryStorage() as unknown as Storage;
  clearQueue();
  server.executions = [{ id: 'exec-1', closed_at: null }];
  server.performed_sets = [{ id: 'set-1' }];
  server.dated_notes = [{ id: 'note-1' }];
  vi.restoreAllMocks();
});

describe('lignes touchées', () => {
  it('une clôture appliquée rend 1 et ferme la ligne', async () => {
    expect(await updateExecution({ id: 'exec-1', closedAt: '2026-11-23T10:00:00Z' })).toBe(1);
    expect(server.executions[0]).toMatchObject({ closed_at: '2026-11-23T10:00:00Z' });
  });

  it('une clôture sans ligne rend 0, ne lève pas, et le dit en console', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(await updateExecution({ id: 'exec-fantome', closedAt: '2026-11-23T10:00:00Z' })).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('exec-fantome');
  });

  it('les suppressions rendent le nombre de lignes retirées, 0 si déjà absentes', async () => {
    expect(await deleteSetById('set-1')).toBe(1);
    expect(await deleteSetById('set-1')).toBe(0);
    expect(await deleteDatedNoteById('note-1')).toBe(1);
    expect(await deleteDatedNoteById('note-1')).toBe(0);
    expect(await deleteExecutionById('exec-1')).toBe(1);
    expect(await deleteExecutionById('exec-1')).toBe(0);
  });

  it('dans la file, une clôture sans ligne est acquittée : ni blocage ni quarantaine', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    enqueue({ type: 'updateExecution', id: 'exec-fantome', closedAt: '2026-11-23T10:00:00Z' });
    enqueue({ type: 'deleteSet', id: 'set-1' });

    const result = await flush(syncFns);

    expect(result).toEqual({ remaining: 0, flushed: 2 });
    expect(readQueue()).toEqual([]);
    expect(readQuarantine()).toEqual([]);
    expect(server.performed_sets).toEqual([]);
  });
});
