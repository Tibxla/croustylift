// Repère « Dernière fois tu notais » : copies locales de la dernière exécution
// passée d'une séance et de ses notes datées.
//
// Avant : la clé de copie portait la date du jour et la liste des versions. Un
// jour nouveau n'avait donc jamais de copie (repère absent hors ligne) et chaque
// jour d'entraînement laissait une clé orpheline. Désormais une copie par séance.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const server = vi.hoisted(() => ({
  online: true,
  /** Dernière exécution passée rendue par le serveur. */
  last: null as { id: string; performed_on: string } | null,
  notes: [] as { exercise_id: string; body: string; created_at: string }[],
  executionFilters: [] as [string, unknown][],
}));

vi.mock('../../lib/supabase', () => {
  const answer = <T,>(data: T) =>
    server.online
      ? Promise.resolve({ data, error: null })
      : Promise.resolve({ data: null, error: new TypeError('Failed to fetch') });
  const from = (table: string) => {
    if (table === 'executions') {
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => (server.executionFilters.push([column, value]), query),
        lt: () => query,
        order: () => query,
        limit: () => query,
        maybeSingle: () => answer(server.last),
      };
      return query;
    }
    if (table === 'dated_notes') {
      const query = { select: () => query, eq: () => query, order: () => answer(server.notes) };
      return query;
    }
    throw new Error(`table inattendue dans ce test : ${table}`);
  };
  return { supabase: { from } };
});

import { loadLastSeanceExecution, loadPreviousDatedNotes, pruneCaptureCopies } from './data';
import { clearReadCache } from '../../lib/read-cache';
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
  get length(): number {
    return this.store.size;
  }
  key(i: number): string | null {
    return [...this.store.keys()][i] ?? null;
  }
}

const copies = () => {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key?.startsWith('croustylift:readcache:')) keys.push(key);
  }
  return keys.sort();
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  (globalThis as unknown as { localStorage: Storage }).localStorage =
    new MemoryStorage() as unknown as Storage;
  clearReadCache();
  saveLocalAccount({ userId: 'user-a', email: 'a@exemple.com' });
  server.online = true;
  server.last = { id: 'exec-lundi', performed_on: '2026-11-16' };
  server.notes = [{ exercise_id: 'exo-1', body: 'Épaule sensible', created_at: '2026-11-16T10:00:00Z' }];
  server.executionFilters = [];
});

describe('loadLastSeanceExecution', () => {
  it('filtre la séance côté serveur, par jointure, sans liste de versions', async () => {
    await loadLastSeanceExecution('seance-1', '2026-11-20');
    expect(server.executionFilters).toEqual([['seance_versions.seance_id', 'seance-1']]);
  });

  it('un jour nouveau, hors ligne : la copie de la veille sert de repère', async () => {
    await loadLastSeanceExecution('seance-1', '2026-11-20');
    server.online = false;

    expect(await loadLastSeanceExecution('seance-1', '2026-11-23')).toEqual({
      id: 'exec-lundi',
      performedOn: '2026-11-16',
    });
  });

  it('une copie qui ne précède pas le jour demandé ne sert pas', async () => {
    // Copie lue le 23 (dernière exécution : le 20), puis reprise d'une séance
    // restée ouverte le 18 : l'exécution du 20 n'est pas « avant le 18 ».
    server.last = { id: 'exec-vendredi', performed_on: '2026-11-20' };
    await loadLastSeanceExecution('seance-1', '2026-11-23');
    server.online = false;

    expect(await loadLastSeanceExecution('seance-1', '2026-11-18')).toBeNull();
  });

  it('un jour nouveau, en ligne : le réseau passe avant la copie', async () => {
    await loadLastSeanceExecution('seance-1', '2026-11-20');
    server.last = { id: 'exec-vendredi', performed_on: '2026-11-20' };

    expect(await loadLastSeanceExecution('seance-1', '2026-11-23')).toEqual({
      id: 'exec-vendredi',
      performedOn: '2026-11-20',
    });
  });

  it('le même jour : la copie est servie d’abord, même hors ligne', async () => {
    await loadLastSeanceExecution('seance-1', '2026-11-20');
    server.online = false;

    expect(await loadLastSeanceExecution('seance-1', '2026-11-20')).toEqual({
      id: 'exec-lundi',
      performedOn: '2026-11-16',
    });
  });

  it('sans copie ni réseau : rien, sans erreur', async () => {
    server.online = false;
    expect(await loadLastSeanceExecution('seance-1', '2026-11-20')).toBeNull();
  });

  it('une seule clé par séance, quel que soit le nombre de jours', async () => {
    for (const day of ['2026-11-18', '2026-11-20', '2026-11-23']) {
      const last = await loadLastSeanceExecution('seance-1', day);
      await loadPreviousDatedNotes('seance-1', last);
      await settle();
    }
    expect(copies()).toEqual([
      'croustylift:readcache:user-a:last-exec:seance-1',
      'croustylift:readcache:user-a:prev-notes:seance-1',
    ]);
  });
});

describe('loadPreviousDatedNotes', () => {
  const lundi = { id: 'exec-lundi', performedOn: '2026-11-16' };

  it('rend les notes de la dernière exécution, puis les sert hors ligne', async () => {
    const expected = { 'exo-1': { body: 'Épaule sensible', performedOn: '2026-11-16' } };
    expect(await loadPreviousDatedNotes('seance-1', lundi)).toEqual(expected);
    server.online = false;
    expect(await loadPreviousDatedNotes('seance-1', lundi)).toEqual(expected);
  });

  it('la copie d’une autre exécution ne sert pas de repère', async () => {
    await loadPreviousDatedNotes('seance-1', lundi);
    server.online = false;

    expect(
      await loadPreviousDatedNotes('seance-1', { id: 'exec-vendredi', performedOn: '2026-11-20' }),
    ).toEqual({});
  });

  it('pas d’exécution passée : aucune lecture', async () => {
    expect(await loadPreviousDatedNotes('seance-1', null)).toEqual({});
    expect(copies()).toEqual([]);
  });
});

describe('pruneCaptureCopies', () => {
  const put = (key: string, value: unknown) =>
    localStorage.setItem(`croustylift:readcache:user-a:${key}`, JSON.stringify({ v: 1, value }));

  it('retire les copies du repère à l’ancien format, garde les nouvelles', () => {
    put('last-exec:1a2b3c:2026-11-10', { id: 'e1', performedOn: '2026-11-03' });
    put('last-exec:1a2b3c:2026-11-17', null);
    put('prev-notes:exec-ancienne', { 'exo-1': { body: 'x', performedOn: '2026-11-03' } });
    put('last-exec:seance-1', { before: '2026-11-23', last: null });
    put('prev-notes:seance-1', { executionId: 'e1', notes: {} });

    pruneCaptureCopies();

    expect(copies()).toEqual([
      'croustylift:readcache:user-a:last-exec:seance-1',
      'croustylift:readcache:user-a:prev-notes:seance-1',
    ]);
  });

  it('retire les templates des versions qui ne sont plus courantes', () => {
    put('seance-version:seance-1', 'v3');
    put('seance-template:v1:seance-1', { id: 'seance-1', name: 'A', exercises: [] });
    put('seance-template:v2:seance-1', { id: 'seance-1', name: 'A', exercises: [] });
    put('seance-template:v3:seance-1', { id: 'seance-1', name: 'A', exercises: [] });
    // Séance dont la version courante n'est pas connue localement : on ne sait pas.
    put('seance-template:v9:seance-2', { id: 'seance-2', name: 'B', exercises: [] });

    pruneCaptureCopies(['v2']);

    expect(copies()).toEqual([
      'croustylift:readcache:user-a:seance-template:v2:seance-1',
      'croustylift:readcache:user-a:seance-template:v3:seance-1',
      'croustylift:readcache:user-a:seance-template:v9:seance-2',
      'croustylift:readcache:user-a:seance-version:seance-1',
    ]);
  });

  it('laisse entier l’historique des exos (les records en dérivent)', () => {
    put('exo-execs:exo-1', [{ id: 's1' }]);
    pruneCaptureCopies();
    expect(copies()).toEqual(['croustylift:readcache:user-a:exo-execs:exo-1']);
  });
});
