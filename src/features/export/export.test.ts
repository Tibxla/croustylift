import { describe, it, expect } from 'vitest';
import {
  EXPORT_FORMAT_VERSION,
  EXPORT_TABLES,
  buildExport,
  collectUserData,
  serializeExport,
  type CollectedData,
  type ExportClient,
  type Row,
} from './export';

// --- Mock minimal du client Supabase ----------------------------------------
//
// `collectUserData` ne dépend QUE de `client.from(table).select('*')`. On mocke
// donc juste cette chaîne : un faux client renvoie, par table, les lignes voulues
// (ou une erreur, pour vérifier la remontée). Aucun import de `lib/supabase`.

/** Données collectées toutes vides (chaque table -> []), pour les cas « vide ». */
function emptyCollected(): CollectedData {
  const entries = EXPORT_TABLES.map((t) => [t, [] as Row[]] as const);
  return Object.fromEntries(entries) as CollectedData;
}

function fakeClient(
  byTable: Partial<Record<string, { data?: unknown[]; error?: { message: string } }>>,
): ExportClient {
  return {
    from(table: string) {
      return {
        select(_columns: string) {
          const result = byTable[table] ?? { data: [] };
          return Promise.resolve({
            data: result.data ?? null,
            error: result.error ?? null,
          });
        },
      };
    },
  };
}

describe('EXPORT_TABLES', () => {
  it('couvre toutes les tables scopées à l utilisateur', () => {
    expect(EXPORT_TABLES).toEqual([
      'exercises',
      'exercise_notes',
      'exercise_overrides',
      'routines',
      'routine_activations',
      'seances',
      'seance_versions',
      'prescriptions',
      'executions',
      'performed_sets',
      'dated_notes',
    ]);
  });

  it('exercise_overrides vient après exercises (dépendance FK)', () => {
    const idx = (t: string) => EXPORT_TABLES.indexOf(t as typeof EXPORT_TABLES[number]);
    expect(idx('exercise_overrides')).toBeGreaterThan(idx('exercises'));
  });
});

describe('collectUserData', () => {
  it('assemble une entrée par table, avec ses lignes', async () => {
    const client = fakeClient({
      routines: { data: [{ id: 'r1', name: 'Ma routine' }] },
      seances: { data: [{ id: 's1', name: 'Upper A' }] },
      performed_sets: { data: [{ id: 'ps1', weight_kg: 80 }] },
    });

    const collected = await collectUserData(client);

    // Toutes les tables sont présentes (vides si pas de données).
    expect(Object.keys(collected).sort()).toEqual([...EXPORT_TABLES].sort());
    expect(collected.routines).toEqual([{ id: 'r1', name: 'Ma routine' }]);
    expect(collected.seances).toEqual([{ id: 's1', name: 'Upper A' }]);
    expect(collected.performed_sets).toEqual([{ id: 'ps1', weight_kg: 80 }]);
  });

  it('cas vide : chaque table -> tableau vide', async () => {
    const collected = await collectUserData(fakeClient({}));
    for (const table of EXPORT_TABLES) {
      expect(collected[table]).toEqual([]);
    }
  });

  it('exclut les exos de base (owner_id null) : seuls les exos perso sont exportés', async () => {
    const client = fakeClient({
      exercises: {
        data: [
          { id: 'base-1', name: 'Développé couché', owner_id: null },
          { id: 'perso-1', name: 'Mon exo', owner_id: 'me' },
        ],
      },
    });

    const collected = await collectUserData(client);

    expect(collected.exercises).toEqual([{ id: 'perso-1', name: 'Mon exo', owner_id: 'me' }]);
  });

  it('exercise_overrides est inclus tel quel (user_id, pas owner_id : pas filtré)', async () => {
    const client = fakeClient({
      exercise_overrides: {
        data: [
          { id: 'ov1', user_id: 'me', exercise_id: 'base-1', notes: 'perso' },
        ],
      },
    });

    const collected = await collectUserData(client);

    expect(collected.exercise_overrides).toEqual([
      { id: 'ov1', user_id: 'me', exercise_id: 'base-1', notes: 'perso' },
    ]);
  });

  it('remonte l erreur Supabase d une table', async () => {
    const client = fakeClient({
      executions: { error: { message: 'boom' } },
    });

    await expect(collectUserData(client)).rejects.toThrow('boom');
  });

  it('data null (pas d erreur) -> tableau vide pour la table', async () => {
    const client = fakeClient({
      routines: { data: undefined },
    });
    const collected = await collectUserData(client);
    expect(collected.routines).toEqual([]);
  });
});

describe('buildExport', () => {
  const collected: CollectedData = {
    exercises: [{ id: 'perso-1', name: 'Mon exo', owner_id: 'me' }],
    exercise_notes: [],
    exercise_overrides: [{ id: 'ov1', user_id: 'me', exercise_id: 'base-1', notes: 'perso' }],
    routines: [{ id: 'r1', name: 'Ma routine' }],
    routine_activations: [],
    seances: [{ id: 's1', name: 'Upper A' }],
    seance_versions: [],
    prescriptions: [],
    executions: [{ id: 'e1', performed_on: '2026-06-18' }],
    performed_sets: [{ id: 'ps1', weight_kg: 80 }],
    dated_notes: [],
  };

  it('enveloppe les données avec version + exportedAt + table data', () => {
    const out = buildExport(collected, '2026-06-18T10:00:00.000Z');

    expect(out.version).toBe(EXPORT_FORMAT_VERSION);
    expect(out.exportedAt).toBe('2026-06-18T10:00:00.000Z');
    expect(out.data).toEqual(collected);
  });

  it('cas vide : structure complète, toutes les tables présentes et vides', () => {
    const out = buildExport(emptyCollected(), '2026-06-18T10:00:00.000Z');

    expect(out.version).toBe(EXPORT_FORMAT_VERSION);
    for (const table of EXPORT_TABLES) {
      expect(out.data[table]).toEqual([]);
    }
  });
});

describe('serializeExport', () => {
  it('produit un JSON indenté reparsable, fidèle à l export', () => {
    const out = buildExport(emptyCollected(), '2026-06-18T10:00:00.000Z');

    const json = serializeExport(out);

    expect(json).toContain('\n'); // indenté (lisible / diffable)
    expect(JSON.parse(json)).toEqual(out);
  });
});
