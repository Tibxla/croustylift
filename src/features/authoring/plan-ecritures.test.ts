// Lectures et écritures du plan qui dépendent de la base : routine courante,
// réordonnancement des séances, refus de suppression. Réseau bouchonné.
import { describe, it, expect, beforeEach, vi } from 'vitest';

type Row = Record<string, unknown>;

const server = vi.hoisted(() => ({
  /** Activations, avec l'état d'archivage de leur routine (colonne de la jointure). */
  activations: [] as Record<string, unknown>[],
  rpcCalls: [] as { fn: string; args: unknown }[],
  rpcError: null as unknown,
  /** Erreur propre à une fonction (prime sur `rpcError`). */
  rpcErrors: {} as Record<string, unknown>,
  /** Réponses successives d'une fonction (prime sur `rpcErrors`), consommées dans l'ordre. */
  rpcReplies: {} as Record<string, { data?: unknown; error?: unknown }[]>,
  /** Écritures directes sur les tables (chemin de repli). */
  inserts: [] as { table: string; row: unknown }[],
  deleteError: null as unknown,
  /** Appelé au moment où la requête de suppression part. */
  onDelete: null as (() => void) | null,
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
    if (table === 'seances') {
      return {
        delete: () => ({ eq: () => Promise.resolve({ error: server.deleteError }) }),
        select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [{ position: 0 }, { position: 1 }], error: null }) }) }),
        insert: (row: Row) => {
          server.inserts.push({ table, row });
          return { select: () => ({ single: () => Promise.resolve({ data: { id: 'legacy-seance', ...row }, error: null }) }) };
        },
      };
    }
    if (table === 'seance_versions') {
      return {
        insert: (row: Row) => {
          server.inserts.push({ table, row });
          return Promise.resolve({ error: null });
        },
      };
    }
    if (table === 'routines') {
      return {
        delete: () => ({
          eq: () => {
            server.onDelete?.();
            return Promise.resolve({ error: server.deleteError });
          },
        }),
      };
    }
    throw new Error(`table inattendue dans ce test : ${table}`);
  };
  const rpc = (fn: string, args: unknown) => {
    server.rpcCalls.push({ fn, args });
    const reply = server.rpcReplies[fn]?.shift();
    if (reply) return Promise.resolve({ data: reply.data ?? null, error: reply.error ?? null });
    return Promise.resolve({ error: server.rpcErrors[fn] ?? server.rpcError });
  };
  return { supabase: { from, rpc } };
});

import { activeBlockers } from '../../pwa/blockers';
import {
  PLAN_WRITE_BLOCK,
  deleteRoutine,
  deleteSeance,
  getCurrentRoutineId,
  REORDER_CONFLICT_MESSAGE,
  LOST_CREATION_MESSAGE,
  createSeance,
  reorderSeances,
} from './data';

beforeEach(() => {
  server.activations = [];
  server.rpcCalls = [];
  server.rpcError = null;
  server.rpcErrors = {};
  server.rpcReplies = {};
  server.inserts = [];
  server.deleteError = null;
  server.onDelete = null;
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

describe('createSeance', () => {
  const created = { id: 'x', routine_id: 'routine-1', name: 'Push', position: 2, archived_at: null };

  it('crée la séance et sa version 1 en UNE requête (create_seance), avec un id fourni par le client', async () => {
    server.rpcReplies.create_seance = [{ data: created }];
    await expect(createSeance('routine-1', { name: 'Push' })).resolves.toEqual(created);
    expect(server.rpcCalls).toHaveLength(1);
    const call = server.rpcCalls[0]!;
    expect(call.fn).toBe('create_seance');
    expect(call.args).toMatchObject({ p_routine_id: 'routine-1', p_name: 'Push', p_prescriptions: [] });
    expect((call.args as { p_seance_id: string }).p_seance_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(server.inserts).toEqual([]);
  });

  it('réponse perdue (erreur réseau) : la demande est rejouée avec le MÊME id, sans doublon', async () => {
    server.rpcReplies.create_seance = [{ error: { message: 'TypeError: Failed to fetch', code: '' } }, { data: created }];
    await expect(createSeance('routine-1', { name: 'Push' })).resolves.toEqual(created);
    const ids = server.rpcCalls.map((c) => (c.args as { p_seance_id: string }).p_seance_id);
    expect(ids).toHaveLength(2);
    expect(ids[1]).toBe(ids[0]);
  });

  it('nom déjà pris (23505) : dit en clair, sans rejeu', async () => {
    server.rpcReplies.create_seance = [{ error: { code: '23505', message: 'duplicate key value violates unique constraint "seances_routine_name_unique"' } }];
    await expect(createSeance('routine-1', { name: 'Push' })).rejects.toThrow('Cette routine a déjà une séance « Push ». Choisis un autre nom.');
    expect(server.rpcCalls).toHaveLength(1);
  });

  it('une copie passe ses prescriptions dans la même requête', async () => {
    server.rpcReplies.create_seance = [{ data: created }];
    await createSeance('routine-1', { name: 'Push' }, [
      { exerciseId: 'e1', position: 0, sets: { min: 2, max: 3 }, reps: { min: 8, max: 12 }, rir: { min: 1, max: 2 } },
    ]);
    expect(server.rpcCalls[0]!.args).toMatchObject({
      p_prescriptions: [{ exercise_id: 'e1', position: 0, sets_min: 2, sets_max: 3, reps_min: 8, reps_max: 12, rir_min: 1, rir_max: 2 }],
    });
  });

  it('deux échecs réseau, puis un nouvel essai du même geste : le MÊME id est rejoué (ni doublon, ni « nom déjà pris »)', async () => {
    const lost = { error: { message: 'TypeError: Failed to fetch', code: '' } };
    server.rpcReplies.create_seance = [lost, lost];
    await expect(createSeance('routine-1', { name: 'Push 2' }, [], 'source-1')).rejects.toThrow(LOST_CREATION_MESSAGE);
    server.rpcReplies.create_seance = [{ data: created }];
    await createSeance('routine-1', { name: 'Push 2' }, [], 'source-1');
    const ids = server.rpcCalls.map((c) => (c.args as { p_seance_id: string }).p_seance_id);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(1);
    // Créée : le geste suivant, même identique, tire un nouvel id.
    server.rpcReplies.create_seance = [{ data: created }];
    await createSeance('routine-1', { name: 'Push 2' }, [], 'source-1');
    expect((server.rpcCalls[3]!.args as { p_seance_id: string }).p_seance_id).not.toBe(ids[0]);
  });

  it('un refus de la base (nom déjà pris) clôt le geste : l’essai suivant tire un nouvel id', async () => {
    server.rpcReplies.create_seance = [{ error: { code: '23505', message: 'duplicate key' } }, { data: created }];
    await expect(createSeance('routine-1', { name: 'Legs' })).rejects.toThrow();
    await createSeance('routine-1', { name: 'Legs' });
    const ids = server.rpcCalls.map((c) => (c.args as { p_seance_id: string }).p_seance_id);
    expect(ids[1]).not.toBe(ids[0]);
  });

  it('fonction absente de la base (0027 pas encore passée) : repli sur la séance puis sa version', async () => {
    server.rpcReplies.create_seance = [{ error: { code: 'PGRST202', message: 'Could not find the function' } }];
    const seance = await createSeance('routine-1', { name: 'Push' });
    expect(seance.id).toBe('legacy-seance');
    expect(server.inserts.map((i) => i.table)).toEqual(['seances', 'seance_versions']);
  });
});

describe('reorderSeances', () => {
  it('envoie l’ordre affiché ET le nouvel ordre à reorder_seances_revision, en une requête', async () => {
    const pending = reorderSeances('routine-1', ['s2', 's1', 's3'], ['s1', 's2', 's3']);
    // Écriture du plan : le rechargement est bloqué le temps de la RPC.
    expect(activeBlockers()).toEqual([PLAN_WRITE_BLOCK]);
    await pending;

    expect(server.rpcCalls).toEqual([
      {
        fn: 'reorder_seances_revision',
        args: { p_routine_id: 'routine-1', p_expected_ids: ['s1', 's2', 's3'], p_seance_ids: ['s2', 's1', 's3'] },
      },
    ]);
    expect(activeBlockers()).toEqual([]);
  });

  it('ordre changé ailleurs (refus PT409) : une erreur en clair, rien n’est retenté', async () => {
    server.rpcErrors.reorder_seances_revision = { code: 'PT409', message: 'reorder_seances_revision : l’ordre a changé depuis sa lecture.' };

    await expect(reorderSeances('routine-1', ['s2', 's1'], ['s1', 's2'])).rejects.toThrow(REORDER_CONFLICT_MESSAGE);
    expect(REORDER_CONFLICT_MESSAGE).toBe('L’ordre a changé sur un autre appareil : vérifie-le puis recommence.');
    expect(server.rpcCalls.map((c) => c.fn)).toEqual(['reorder_seances_revision']);
  });

  it('fonction absente de la base (migration 0026 pas encore passée) : repli sur reorder_seances', async () => {
    server.rpcErrors.reorder_seances_revision = { code: 'PGRST202', message: 'Could not find the function' };

    await reorderSeances('routine-1', ['s2', 's1'], ['s1', 's2']);
    expect(server.rpcCalls).toEqual([
      { fn: 'reorder_seances_revision', args: { p_routine_id: 'routine-1', p_expected_ids: ['s1', 's2'], p_seance_ids: ['s2', 's1'] } },
      { fn: 'reorder_seances', args: { p_routine_id: 'routine-1', p_seance_ids: ['s2', 's1'] } },
    ]);
  });

  it('relance l’erreur de la base (id en double ou hors de la routine)', async () => {
    server.rpcError = { code: '22023', message: 'id hors de la routine' };

    await expect(reorderSeances('routine-1', ['s1', 's1'], ['s1', 's2'])).rejects.toMatchObject({
      code: '22023',
    });
    expect(activeBlockers()).toEqual([]);
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

describe('refus de contrainte d’une écriture du plan', () => {
  it('l’explication propre à l’écriture prime sur le message générique (23503)', async () => {
    server.deleteError = { code: '23503', message: 'violates foreign key constraint "x_fkey"' };

    await expect(deleteSeance('s1')).rejects.toThrow(
      'Cette séance a déjà été faite en salle : archive-la plutôt, son historique reste entier.',
    );
    await expect(deleteRoutine('r1')).rejects.toThrow(
      'Cette routine a déjà été faite en salle : archive-la plutôt, son historique reste entier.',
    );
  });

  it('un refus que l’écriture n’explique pas sort en français, pas en message Postgres (23514)', async () => {
    const raw = { code: '23514', message: 'new row violates check constraint "seances_x_check"' };
    server.deleteError = raw;

    const err = await deleteSeance('s1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/^Enregistrement refusé : une valeur sort des limites/);
    expect((err as Error).message).not.toMatch(/violates|check constraint/);
    expect((err as Error).cause).toBe(raw);
  });

  it('toute autre erreur repart telle quelle', async () => {
    const raw = { code: '42501', message: 'permission denied' };
    server.deleteError = raw;
    await expect(deleteSeance('s1')).rejects.toBe(raw);
  });
});

describe('écriture du plan et rechargement automatique', () => {
  it('bloque le rechargement dès l’appel et pendant la requête, le rend à la fin', async () => {
    let during: string[] = [];
    server.onDelete = () => {
      during = activeBlockers();
    };
    const pending = deleteRoutine('r1');
    // Posé en synchrone : un changement d'onglet dans la foulée ne recharge pas.
    expect(activeBlockers()).toEqual([PLAN_WRITE_BLOCK]);
    await pending;
    expect(during).toEqual([PLAN_WRITE_BLOCK]);
    expect(activeBlockers()).toEqual([]);
  });

  it('rend le rechargement quand l’écriture est refusée', async () => {
    server.deleteError = { code: '23503', message: 'violates foreign key constraint' };
    await expect(deleteRoutine('r1')).rejects.toBeDefined();
    expect(activeBlockers()).toEqual([]);
  });
});

describe('écriture du plan et copies des écrans au calme', () => {
  it('une écriture du plan fait relire la liste des routines au lieu de resservir sa copie', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() {
        return store.size;
      },
    });
    const { saveLocalAccount } = await import('../../lib/local-account');
    const { clearReadCache } = await import('../../lib/read-cache');
    const { loadDated, VIEW_PREFIX } = await import('../../lib/dated-read');
    clearReadCache();
    saveLocalAccount({ userId: 'user-1', email: 'toi@exemple.com' });
    const key = `${VIEW_PREFIX}seances`;
    await loadDated(key, async () => ['avant'], { offline: false });

    await deleteRoutine('r1');

    const after = await loadDated(key, async () => ['après'], { offline: false });
    expect(after).toMatchObject({ phase: 'ready', value: ['après'], copy: false });
    vi.unstubAllGlobals();
  });
});
