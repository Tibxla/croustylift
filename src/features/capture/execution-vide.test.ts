// `deleteExecutionIfEmpty` : la RPC de la migration 0025, et son repli tant
// qu'elle n'est pas en base. La base est simulée.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const server = vi.hoisted(() => ({
  /** La fonction existe-t-elle en base ? */
  rpcDeployed: true,
  rpcAnswer: 'deleted' as string,
  rpcError: null as { code: string; message: string } | null,
  executions: [] as { id: string; closed_at: string | null }[],
  sets: [] as { id: string; execution_id: string }[],
  notes: [] as { id: string; execution_id: string }[],
  log: [] as string[],
}));

vi.mock('../../lib/supabase', () => {
  const rows = (table: string): { id: string; execution_id?: string; closed_at?: string | null }[] =>
    table === 'executions' ? server.executions : table === 'performed_sets' ? server.sets : server.notes;
  const from = (table: string) => ({
    select: () => ({
      eq: (column: 'id' | 'execution_id', value: string) => {
        const found = () => rows(table).filter((r) => r[column] === value);
        server.log.push(`select:${table}`);
        return {
          maybeSingle: () => Promise.resolve({ data: found()[0] ?? null, error: null }),
          limit: (n: number) => Promise.resolve({ data: found().slice(0, n), error: null }),
        };
      },
    }),
    delete: () => ({
      eq: (_column: string, id: string) => ({
        is: (_c: string, _v: null) => ({
          select: () => {
            const gone = server.executions.filter((e) => e.id === id && e.closed_at === null);
            server.executions = server.executions.filter((e) => !gone.includes(e));
            server.log.push(`delete:${table}`);
            return Promise.resolve({ data: gone.map((e) => ({ id: e.id })), error: null });
          },
        }),
      }),
    }),
  });
  const rpc = (fn: string, args: { p_execution_id: string }) => {
    server.log.push(`rpc:${fn}:${args.p_execution_id}`);
    if (server.rpcError) return Promise.resolve({ data: null, error: server.rpcError });
    if (!server.rpcDeployed) {
      return Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
    }
    return Promise.resolve({ data: server.rpcAnswer, error: null });
  };
  return { supabase: { from, rpc } };
});

import { deleteExecutionIfEmpty } from './data';

beforeEach(() => {
  server.rpcDeployed = true;
  server.rpcAnswer = 'deleted';
  server.rpcError = null;
  server.executions = [{ id: 'exec-1', closed_at: null }];
  server.sets = [];
  server.notes = [];
  server.log = [];
});

describe('deleteExecutionIfEmpty, fonction en base', () => {
  it('une seule écriture, la RPC, qui tranche : sa réponse est rendue telle quelle', async () => {
    for (const answer of ['deleted', 'kept', 'absent'] as const) {
      server.rpcAnswer = answer;
      expect(await deleteExecutionIfEmpty('exec-1')).toBe(answer);
    }
    expect(server.log).toEqual(Array(3).fill('rpc:delete_execution_if_empty:exec-1'));
  });

  it('réponse inattendue : dans le doute, « gardée »', async () => {
    server.rpcAnswer = 'autre chose';
    expect(await deleteExecutionIfEmpty('exec-1')).toBe('kept');
  });

  it('une vraie erreur (réseau, droits) remonte : la file réessaiera, sans passer par le repli', async () => {
    server.rpcError = { code: '42501', message: 'permission denied' };
    await expect(deleteExecutionIfEmpty('exec-1')).rejects.toMatchObject({ code: '42501' });
    expect(server.executions).toHaveLength(1);
    expect(server.log).toEqual(['rpc:delete_execution_if_empty:exec-1']);
  });
});

describe('deleteExecutionIfEmpty, fonction pas encore en base : repli', () => {
  beforeEach(() => {
    server.rpcDeployed = false;
  });

  it('exécution ouverte et vide : supprimée', async () => {
    expect(await deleteExecutionIfEmpty('exec-1')).toBe('deleted');
    expect(server.executions).toEqual([]);
  });

  it('une série en base : gardée, aucun delete envoyé', async () => {
    server.sets = [{ id: 's1', execution_id: 'exec-1' }];
    expect(await deleteExecutionIfEmpty('exec-1')).toBe('kept');
    expect(server.executions).toHaveLength(1);
    expect(server.log.some((line) => line.startsWith('delete:'))).toBe(false);
  });

  it('une note datée en base : gardée', async () => {
    server.notes = [{ id: 'n1', execution_id: 'exec-1' }];
    expect(await deleteExecutionIfEmpty('exec-1')).toBe('kept');
    expect(server.executions).toHaveLength(1);
  });

  it('exécution close : gardée', async () => {
    server.executions = [{ id: 'exec-1', closed_at: '2026-11-25T10:00:00Z' }];
    expect(await deleteExecutionIfEmpty('exec-1')).toBe('kept');
    expect(server.executions).toHaveLength(1);
  });

  it('exécution absente : sans effet (idempotent)', async () => {
    server.executions = [];
    expect(await deleteExecutionIfEmpty('exec-1')).toBe('absent');
  });

  it('close entre la lecture et le delete : le delete, borné aux ouvertes, ne la touche pas', async () => {
    const real = server.log.push.bind(server.log);
    server.log.push = (line: string) => {
      // Juste avant le delete : un autre appareil range la séance.
      if (line === 'select:dated_notes') server.executions[0]!.closed_at = '2026-11-25T10:00:00Z';
      return real(line);
    };
    expect(await deleteExecutionIfEmpty('exec-1')).toBe('absent');
    expect(server.executions).toHaveLength(1);
  });
});
