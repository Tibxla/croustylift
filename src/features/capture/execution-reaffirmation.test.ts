// Une réaffirmation ne modifie jamais une exécution existante.
//
// Le bug : la Capture ré-enfile l'`upsertExecution` avant la première série de
// chaque montage, avec la version de séance qu'elle vient de charger. Séance
// retouchée en plein entraînement (v1 → v2) puis retour en Capture : l'upsert
// réécrivait `seance_version_id`, et l'exécution entamée sous v1, avec toutes
// ses séries, changeait de bloc dans l'Analyse.
//
// Faux serveur derrière `lib/supabase`, qui applique la sémantique de PostgREST :
// en conflit d'id, `ignoreDuplicates` laisse la ligne intacte (`on conflict do
// nothing`), son absence la réécrit (`do update`).
import { describe, it, expect, beforeEach, vi } from 'vitest';

interface ServerExecution {
  id: string;
  seance_version_id: string;
  performed_on: string;
  started_at?: string;
}

const server = vi.hoisted(() => ({ executions: new Map<string, ServerExecution>() }));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table !== 'executions') throw new Error(`table inattendue dans ce test : ${table}`);
      return {
        upsert: (row: ServerExecution, options?: { onConflict?: string; ignoreDuplicates?: boolean }) => {
          const known = server.executions.get(row.id);
          if (known && options?.ignoreDuplicates) return Promise.resolve({ data: null, error: null });
          server.executions.set(row.id, { ...known, ...row });
          return Promise.resolve({ data: null, error: null });
        },
      };
    },
  },
}));

import { upsertExecution } from './data';

beforeEach(() => {
  server.executions.clear();
});

describe('upsertExecution : insertion seule', () => {
  it('crée l’exécution absente, avec sa version, sa date et son lancement', async () => {
    await upsertExecution({
      id: 'exec-1',
      seanceVersionId: 'v1',
      performedOn: '2026-11-23',
      startedAt: '2026-11-23T18:00:00.000Z',
    });
    expect(server.executions.get('exec-1')).toEqual({
      id: 'exec-1',
      seance_version_id: 'v1',
      performed_on: '2026-11-23',
      started_at: '2026-11-23T18:00:00.000Z',
    });
  });

  it('réaffirmée sous une nouvelle version de séance : la base garde la version d’origine', async () => {
    await upsertExecution({
      id: 'exec-1',
      seanceVersionId: 'v1',
      performedOn: '2026-11-23',
      startedAt: '2026-11-23T18:00:00.000Z',
    });
    // Séance retouchée en cours d'entraînement, puis remontage de la Capture :
    // la réaffirmation part avec la version v2 fraîchement chargée.
    await upsertExecution({
      id: 'exec-1',
      seanceVersionId: 'v2',
      performedOn: '2026-11-23',
      startedAt: '2026-11-23T18:00:00.000Z',
    });
    expect(server.executions.get('exec-1')?.seance_version_id).toBe('v1');
  });

  it('réaffirmée avec une autre date ou un autre lancement : ni l’une ni l’autre ne bougent', async () => {
    await upsertExecution({
      id: 'exec-1',
      seanceVersionId: 'v1',
      performedOn: '2026-11-23',
      startedAt: '2026-11-23T18:00:00.000Z',
    });
    await upsertExecution({
      id: 'exec-1',
      seanceVersionId: 'v1',
      performedOn: '2026-11-24',
      startedAt: '2026-11-24T00:30:00.000Z',
    });
    expect(server.executions.get('exec-1')).toMatchObject({
      performed_on: '2026-11-23',
      started_at: '2026-11-23T18:00:00.000Z',
    });
  });
});
