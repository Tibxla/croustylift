// Tests TDD pour le module d'import JSON (issue #35).
//
// Stratégie calquée sur export.test.ts : client INJECTÉ, fonctions PURES, aucun
// import de lib/supabase. On teste trois couches séparément :
//   1. parseImportFile   : parsing + validation du JSON brut (pure)
//   2. prepareForRestore : mise à niveau des lignes d'une vieille sauvegarde (pure)
//   3. importUserData    : un seul appel à la fonction `import_user_data`
//      (client injecté), qui écrit tout dans une transaction côté base.

import { describe, it, expect } from 'vitest';
import {
  IMPORT_FORMAT_VERSION,
  parseImportFile,
  prepareForRestore,
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

/** Faux client : note chaque appel de fonction, répond `error` (null = succès). */
function fakeImportClient(error: { message: string } | null = null): {
  client: ImportClient;
  calls: { fn: string; data: CollectedData }[];
} {
  const calls: { fn: string; data: CollectedData }[] = [];
  return {
    calls,
    client: {
      rpc(fn, args) {
        calls.push({ fn, data: args.p_data });
        return Promise.resolve({ error });
      },
    },
  };
}

function parsedWith(data: Partial<CollectedData>): ParsedImport {
  return {
    version: 2,
    exportedAt: '2026-11-23T10:00:00.000Z',
    data: { ...emptyCollected(), ...data },
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

  it('accepte une sauvegarde v1, d’avant l’archivage : journal des archivages vide', () => {
    const { seance_archive_events: _events, ...v1Data } = emptyCollected();
    const json = JSON.stringify({ version: 1, exportedAt: '2026-06-18T10:00:00.000Z', data: v1Data });
    const result = parseImportFile(json);
    expect(result.data.seance_archive_events).toEqual([]);
  });

  it('parse une sauvegarde v2 complète', () => {
    const result = parseImportFile(validJson({ version: 2 }));
    expect(result.version).toBe(2);
    expect(result.data.seance_archive_events).toEqual([]);
  });

  it('rejette une sauvegarde v2 sans journal des archivages', () => {
    const { seance_archive_events: _events, ...partial } = emptyCollected();
    const json = JSON.stringify({ version: 2, exportedAt: '2026-09-13T10:00:00.000Z', data: partial });
    expect(() => parseImportFile(json)).toThrow(/seance_archive_events/i);
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

  it('expose IMPORT_FORMAT_VERSION = 2 (journal des archivages, ADR 0017)', () => {
    expect(IMPORT_FORMAT_VERSION).toBe(2);
  });
});

// === prepareForRestore ========================================================

describe('prepareForRestore', () => {
  it('exo d’une sauvegarde d’avant `unilateral` et `primary_muscles` : complété depuis son groupe', () => {
    const data = {
      ...emptyCollected(),
      exercises: [{ id: 'perso-1', owner_id: 'me', name: 'Mon exo', muscle_group: 'dos' }],
    };

    const out = prepareForRestore(data);

    expect(out.exercises).toEqual([
      {
        id: 'perso-1',
        owner_id: 'me',
        name: 'Mon exo',
        muscle_group: 'dos',
        unilateral: false,
        primary_muscles: ['dos'],
      },
    ]);
  });

  it('exo aux muscles principaux vides : remplis depuis son groupe (la base en exige un)', () => {
    const data = {
      ...emptyCollected(),
      exercises: [
        { id: 'perso-1', muscle_group: 'biceps', unilateral: true, primary_muscles: [] },
      ],
    };

    expect(prepareForRestore(data).exercises[0]).toMatchObject({
      unilateral: true,
      primary_muscles: ['biceps'],
    });
  });

  it('exo déjà complet : rendu tel quel', () => {
    const exo = {
      id: 'perso-1',
      muscle_group: 'dos',
      unilateral: true,
      primary_muscles: ['dos', 'biceps'],
    };
    const data = { ...emptyCollected(), exercises: [exo] };

    expect(prepareForRestore(data).exercises).toEqual([exo]);
  });

  it('deux notes datées pour le même exo dans la même exécution : seule la plus récente est restaurée', () => {
    const data = {
      ...emptyCollected(),
      dated_notes: [
        { id: 'n-recente', execution_id: 'e1', exercise_id: 'x1', body: 'la bonne', created_at: '2026-06-02T10:05:00Z' },
        { id: 'n-ancienne', execution_id: 'e1', exercise_id: 'x1', body: 'doublon', created_at: '2026-06-02T10:00:00Z' },
        { id: 'n-autre-exo', execution_id: 'e1', exercise_id: 'x2', body: 'autre exo', created_at: '2026-06-02T09:00:00Z' },
        { id: 'n-autre-seance', execution_id: 'e2', exercise_id: 'x1', body: 'autre séance', created_at: '2026-06-01T09:00:00Z' },
      ],
    };

    const out = prepareForRestore(data);

    expect(out.dated_notes.map((n) => n.id)).toEqual(['n-recente', 'n-autre-exo', 'n-autre-seance']);
  });

  it('ne modifie ni l’entrée ni les autres tables', () => {
    const data = {
      ...emptyCollected(),
      exercises: [{ id: 'perso-1', muscle_group: 'dos' }],
      routines: [{ id: 'r1', name: 'PPL' }],
    };
    const before = JSON.parse(JSON.stringify(data)) as CollectedData;

    const out = prepareForRestore(data);

    expect(data).toEqual(before);
    expect(out.routines).toBe(data.routines);
  });
});

// === importUserData ===========================================================

describe('importUserData', () => {
  it('envoie toute la sauvegarde en UN appel à import_user_data : tout passe ou rien n’est écrit', async () => {
    const { client, calls } = fakeImportClient();
    const parsed = parsedWith({
      exercises: [
        { id: 'perso-1', name: 'Mon exo', owner_id: 'me', muscle_group: 'dos', unilateral: false, primary_muscles: ['dos'] },
      ],
      routines: [{ id: 'r1', name: 'Ma routine' }],
      performed_sets: [{ id: 'ps1', weight_kg: 80 }],
    });

    await importUserData(client, parsed);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.fn).toBe('import_user_data');
    expect(calls[0]!.data).toEqual(parsed.data);
  });

  it('envoie les douze tables, dans l’ordre parents puis enfants', async () => {
    const { client, calls } = fakeImportClient();
    const fullData = Object.fromEntries(
      EXPORT_TABLES.map((t) => [t, [{ id: `${t}-1` }]]),
    ) as unknown as CollectedData;

    await importUserData(client, { version: 1, exportedAt: '2026-06-18T10:00:00.000Z', data: fullData });

    expect(Object.keys(calls[0]!.data)).toEqual([...EXPORT_TABLES]);
  });

  it('met les lignes à niveau avant l’envoi (vieille sauvegarde)', async () => {
    const { client, calls } = fakeImportClient();

    await importUserData(
      client,
      parsedWith({ exercises: [{ id: 'perso-1', name: 'Mon exo', muscle_group: 'dos' }] }),
    );

    expect(calls[0]!.data.exercises[0]).toMatchObject({ unilateral: false, primary_muscles: ['dos'] });
  });

  it('sauvegarde vide : aucun appel', async () => {
    const { client, calls } = fakeImportClient();

    await importUserData(client, parsedWith({}));

    expect(calls).toHaveLength(0);
  });

  it('remonte l’erreur de la base', async () => {
    const { client } = fakeImportClient({ message: 'db boom' });

    await expect(
      importUserData(client, parsedWith({ routines: [{ id: 'r1', name: 'Ma routine' }] })),
    ).rejects.toThrow('db boom');
  });
});
