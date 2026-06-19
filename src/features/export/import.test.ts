// Tests TDD pour le module d'import JSON (issue #35).
//
// Stratégie calquée sur export.test.ts : client INJECTÉ, fonctions PURES, aucun
// import de lib/supabase. On teste trois couches séparément :
//   1. parseImportFile   — parsing + validation du JSON brut (pure)
//   2. importUserData    — orchestration upsert table par table (client injecté)
// Les cas d'erreur (version inconnue, JSON invalide, erreur Supabase) sont traités
// en premier (red-green-refactor).

import { describe, it, expect } from 'vitest';
import {
  IMPORT_FORMAT_VERSION,
  parseImportFile,
  importUserData,
  type ImportClient,
  type ParsedImport,
} from './import';
import { EXPORT_TABLES, type CollectedData, type Row } from './export';

// --- Helpers ------------------------------------------------------------------

/** Données collectées toutes vides, pour forger des exports de test. */
function emptyCollected(): CollectedData {
  const entries = EXPORT_TABLES.map((t) => [t, [] as Row[]] as const);
  return Object.fromEntries(entries) as CollectedData;
}

/** JSON d'export v1 minimal valide. */
function validJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 1,
    exportedAt: '2026-06-18T10:00:00.000Z',
    data: emptyCollected(),
    ...overrides,
  });
}

/** Fabrique un mock de client Supabase pour l'import. */
function fakeImportClient(
  onUpsert: (
    table: string,
    rows: Row[],
  ) => { data: null; error: { message: string } | null },
): ImportClient {
  return {
    from(table: string) {
      return {
        upsert(rows: Row[], options: { onConflict: string; ignoreDuplicates?: boolean }) {
          void options; // utilisé en runtime, vérifié en intégration
          return Promise.resolve(onUpsert(table, rows));
        },
      };
    },
  };
}

// === parseImportFile ==========================================================

describe('parseImportFile', () => {
  it('parse un JSON v1 valide', () => {
    const result = parseImportFile(validJson());

    expect(result.version).toBe(1);
    expect(result.exportedAt).toBe('2026-06-18T10:00:00.000Z');
    expect(result.data.exercises).toEqual([]);
    expect(result.data.performed_sets).toEqual([]);
  });

  it('accepte des données non vides dans chaque table', () => {
    const json = JSON.stringify({
      version: 1,
      exportedAt: '2026-06-18T10:00:00.000Z',
      data: {
        ...emptyCollected(),
        exercises: [{ id: 'perso-1', name: 'Mon exo', owner_id: 'me' }],
        performed_sets: [{ id: 'ps1', weight_kg: 100 }],
      },
    });

    const result = parseImportFile(json);

    expect(result.data.exercises).toEqual([{ id: 'perso-1', name: 'Mon exo', owner_id: 'me' }]);
    expect(result.data.performed_sets).toEqual([{ id: 'ps1', weight_kg: 100 }]);
  });

  it('rejette du JSON syntaxiquement invalide', () => {
    expect(() => parseImportFile('{ pas du json }')).toThrow(/JSON/i);
  });

  it('rejette un objet sans champ version', () => {
    const json = JSON.stringify({ exportedAt: '2026-06-18T10:00:00.000Z', data: emptyCollected() });
    expect(() => parseImportFile(json)).toThrow(/version/i);
  });

  it('rejette un champ version qui n est pas un entier', () => {
    const json = validJson({ version: '1' });
    expect(() => parseImportFile(json)).toThrow(/version/i);
  });

  it('rejette une version de format inconnue avec un message clair', () => {
    const json = validJson({ version: 99 });
    expect(() => parseImportFile(json)).toThrow(/version.*99/i);
  });

  it('rejette un objet sans champ data', () => {
    const json = JSON.stringify({ version: 1, exportedAt: '2026-06-18T10:00:00.000Z' });
    expect(() => parseImportFile(json)).toThrow(/data/i);
  });

  it('rejette un champ data qui n est pas un objet', () => {
    const json = JSON.stringify({ version: 1, exportedAt: '2026-06-18T10:00:00.000Z', data: 42 });
    expect(() => parseImportFile(json)).toThrow(/data/i);
  });

  it('rejette si une table obligatoire est absente de data', () => {
    const partial = { ...emptyCollected() };
    // Supprimer une table requise
    const { exercises: _ex, ...withoutExercises } = partial;
    const json = JSON.stringify({ version: 1, exportedAt: '2026-06-18T10:00:00.000Z', data: withoutExercises });
    expect(() => parseImportFile(json)).toThrow(/exercises/i);
  });

  it('rejette si une table n est pas un tableau', () => {
    const json = JSON.stringify({
      version: 1,
      exportedAt: '2026-06-18T10:00:00.000Z',
      data: { ...emptyCollected(), routines: 'oops' },
    });
    expect(() => parseImportFile(json)).toThrow(/routines/i);
  });

  it('expose IMPORT_FORMAT_VERSION = 1', () => {
    expect(IMPORT_FORMAT_VERSION).toBe(1);
  });
});

// === importUserData ===========================================================

describe('importUserData', () => {
  it('appelle upsert dans l ordre parent -> enfant pour chaque table non vide', async () => {
    const upsertedTables: string[] = [];
    const client = fakeImportClient((table) => {
      upsertedTables.push(table);
      return { data: null, error: null };
    });

    const parsed: ParsedImport = {
      version: 1,
      exportedAt: '2026-06-18T10:00:00.000Z',
      data: {
        ...emptyCollected(),
        exercises: [{ id: 'perso-1', name: 'Mon exo', owner_id: 'me' }],
        // exercise_overrides référence exercises : doit venir après dans EXPORT_TABLES
        exercise_overrides: [{ id: 'ov1', user_id: 'me', exercise_id: 'perso-1' }],
        routines: [{ id: 'r1', name: 'Ma routine' }],
        performed_sets: [{ id: 'ps1', weight_kg: 80 }],
      },
    };

    await importUserData(client, parsed);

    // Les tables renseignées sont upsertées dans l'ordre EXPORT_TABLES.
    expect(upsertedTables).toEqual(['exercises', 'exercise_overrides', 'routines', 'performed_sets']);
  });

  it('exercise_overrides : réimport idempotent sur onConflict: id', async () => {
    const upsertArgs: { table: string; rows: Row[]; onConflict: string }[] = [];
    const client: ImportClient = {
      from(table: string) {
        return {
          upsert(rows: Row[], options) {
            upsertArgs.push({ table, rows, onConflict: options.onConflict });
            return Promise.resolve({ data: null, error: null });
          },
        };
      },
    };

    const override = { id: 'ov1', user_id: 'me', exercise_id: 'base-1', notes: 'perso' };
    const parsed: ParsedImport = {
      version: 1,
      exportedAt: '2026-06-18T10:00:00.000Z',
      data: { ...emptyCollected(), exercise_overrides: [override] },
    };

    await importUserData(client, parsed);
    await importUserData(client, parsed); // 2e import : idempotent

    const calls = upsertArgs.filter((a) => a.table === 'exercise_overrides');
    expect(calls).toHaveLength(2);
    expect(calls[0].rows).toEqual([override]);
    expect(calls[0].onConflict).toBe('id');
    expect(calls[1].onConflict).toBe('id');
  });

  it('saute les tables vides (pas d appel upsert)', async () => {
    const upsertedTables: string[] = [];
    const client = fakeImportClient((table) => {
      upsertedTables.push(table);
      return { data: null, error: null };
    });

    const parsed: ParsedImport = {
      version: 1,
      exportedAt: '2026-06-18T10:00:00.000Z',
      data: emptyCollected(), // tout vide
    };

    await importUserData(client, parsed);

    expect(upsertedTables).toHaveLength(0);
  });

  it('est idempotent : ré-importer les mêmes lignes ne provoque pas d erreur', async () => {
    // On vérifie que onConflict: 'id' est passé (upsert par UUID).
    const upsertArgs: { table: string; rows: Row[]; onConflict: string }[] = [];
    const client: ImportClient = {
      from(table: string) {
        return {
          upsert(rows: Row[], options) {
            upsertArgs.push({ table, rows, onConflict: options.onConflict });
            return Promise.resolve({ data: null, error: null });
          },
        };
      },
    };

    const parsed: ParsedImport = {
      version: 1,
      exportedAt: '2026-06-18T10:00:00.000Z',
      data: {
        ...emptyCollected(),
        routines: [{ id: 'r1', name: 'Ma routine' }],
      },
    };

    await importUserData(client, parsed);
    // 2e import identique : ne doit pas lever
    await importUserData(client, parsed);

    // upsert appelé 2 fois, toujours avec onConflict: 'id'.
    expect(upsertArgs).toHaveLength(2);
    expect(upsertArgs[0].onConflict).toBe('id');
    expect(upsertArgs[1].onConflict).toBe('id');
  });

  it('remonte l erreur Supabase d une table', async () => {
    const client = fakeImportClient((table) => {
      if (table === 'routines') return { data: null, error: { message: 'db boom' } };
      return { data: null, error: null };
    });

    const parsed: ParsedImport = {
      version: 1,
      exportedAt: '2026-06-18T10:00:00.000Z',
      data: {
        ...emptyCollected(),
        routines: [{ id: 'r1', name: 'Ma routine' }],
      },
    };

    await expect(importUserData(client, parsed)).rejects.toThrow('db boom');
  });

  it('importe toutes les tables renseignées dans l ordre EXPORT_TABLES', async () => {
    const upsertedTables: string[] = [];
    const client = fakeImportClient((table) => {
      upsertedTables.push(table);
      return { data: null, error: null };
    });

    // Toutes les tables avec au moins une ligne.
    const fullData = Object.fromEntries(
      EXPORT_TABLES.map((t) => [t, [{ id: `${t}-1` }]]),
    ) as unknown as CollectedData;

    await importUserData(client, { version: 1, exportedAt: '2026-06-18T10:00:00.000Z', data: fullData });

    // L'ordre doit respecter EXPORT_TABLES (parents avant enfants).
    expect(upsertedTables).toEqual([...EXPORT_TABLES]);
  });
});
