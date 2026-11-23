// Lectures et écritures du plan qui dépendent de la base : routine courante,
// réordonnancement des séances, refus de suppression. Réseau bouchonné.
import { describe, it, expect, beforeEach, vi } from 'vitest';

type Row = Record<string, unknown>;

const server = vi.hoisted(() => ({
  /** Activations, avec l'état d'archivage de leur routine (colonne de la jointure). */
  activations: [] as Record<string, unknown>[],
  rpcCalls: [] as { fn: string; args: unknown }[],
  rpcError: null as unknown,
  deleteError: null as unknown,
}));

vi.mock('../../lib/supabase', () => {
  const from = (table: string) => {
    if (table === 'routine_activations') {
      const filters: ((row: Row) => boolean)[] = [];
      const query = {
        select: () => query,
        is: (column: string, value: unknown) => (filters.push((r) => (r[column] ?? null) === value), query),
        order: () => query,
        limit: () => query,
        maybeSingle: () => {
          const rows = server.activations
            .filter((row) => filters.every((f) => f(row)))
            .sort((a, b) => String(b.activated_at).localeCompare(String(a.activated_at)));
          return Promise.resolve({ data: rows[0] ?? null, error: null });
        },
      };
      return query;
    }
    if (table === 'routines') {
      return { delete: () => ({ eq: () => Promise.resolve({ error: server.deleteError }) }) };
    }
    throw new Error(`table inattendue dans ce test : ${table}`);
  };
  const rpc = (fn: string, args: unknown) => {
    server.rpcCalls.push({ fn, args });
    return Promise.resolve({ error: server.rpcError });
  };
  return { supabase: { from, rpc } };
});

import { deleteRoutine, getCurrentRoutineId, reorderSeancesViaRpc } from './data';

beforeEach(() => {
  server.activations = [];
  server.rpcCalls = [];
  server.rpcError = null;
  server.deleteError = null;
});

describe('getCurrentRoutineId', () => {
  it('rend la routine de l’activation la plus récente', async () => {
    server.activations = [
      { routine_id: 'r1', activated_at: '2026-11-01T10:00:00Z', 'routines.archived_at': null },
      { routine_id: 'r2', activated_at: '2026-11-10T10:00:00Z', 'routines.archived_at': null },
    ];
    expect(await getCurrentRoutineId()).toBe('r2');
  });

  it('ignore les activations des routines archivées', async () => {
    // La routine courante (jamais exécutée) vient d'être supprimée : ses
    // activations sont parties en cascade. La précédente, r1, est archivée.
    server.activations = [
      { routine_id: 'r0', activated_at: '2026-10-01T10:00:00Z', 'routines.archived_at': null },
      {
        routine_id: 'r1',
        activated_at: '2026-11-01T10:00:00Z',
        'routines.archived_at': '2026-11-05T10:00:00Z',
      },
    ];
    expect(await getCurrentRoutineId()).toBe('r0');
  });

  it('aucune activation de routine vivante : null', async () => {
    server.activations = [
      {
        routine_id: 'r1',
        activated_at: '2026-11-01T10:00:00Z',
        'routines.archived_at': '2026-11-05T10:00:00Z',
      },
    ];
    expect(await getCurrentRoutineId()).toBeNull();
  });
});

describe('reorderSeancesViaRpc', () => {
  it('appelle reorder_seances avec la routine et les ids dans l’ordre', async () => {
    await reorderSeancesViaRpc('routine-1', ['s2', 's1', 's3']);

    expect(server.rpcCalls).toEqual([
      { fn: 'reorder_seances', args: { p_routine_id: 'routine-1', p_seance_ids: ['s2', 's1', 's3'] } },
    ]);
  });

  it('relance l’erreur de la base (id en double ou hors de la routine)', async () => {
    server.rpcError = { code: '22023', message: 'id hors de la routine' };

    await expect(reorderSeancesViaRpc('routine-1', ['s1', 's1'])).rejects.toMatchObject({
      code: '22023',
    });
  });
});

describe('deleteRoutine', () => {
  it('le refus de supprimer la routine courante (23514) est dit en clair', async () => {
    server.deleteError = { code: '23514', message: 'new row violates check constraint' };

    await expect(deleteRoutine('routine-courante')).rejects.toThrow(
      'La routine courante ne se supprime pas. Définis d’abord une autre routine comme courante.',
    );
  });
});
