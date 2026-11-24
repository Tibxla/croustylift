import { describe, it, expect } from 'vitest';
import {
  EXPORT_FORMAT_VERSION,
  EXPORT_TABLES,
  buildExport,
  collectUserData,
  serializeExport,
  withoutRowsNewerThanTheirParent,
  type CollectedData,
  type ExportClient,
  type ExportPage,
  type Row,
} from './export';
import { setSessionUserReader } from '../../lib/session-identity';

// --- Mock minimal du client Supabase ----------------------------------------
//
// `collectUserData` ne dépend QUE de `client.from(table).select('*').order('id')
// [.gt('id', curseur)].limit(n)`. On mocke donc juste cette chaîne : un faux client renvoie,
// par table, la fenêtre demandée des lignes voulues, PLAFONNÉE comme PostgREST
// (`maxRows`, 1000 par défaut), ou une erreur pour vérifier la remontée. Aucun
// import de `lib/supabase`.

/** Données collectées toutes vides (chaque table -> []), pour les cas « vide ». */
function emptyCollected(): CollectedData {
  const entries = EXPORT_TABLES.map((t) => [t, [] as Row[]] as const);
  return Object.fromEntries(entries) as CollectedData;
}

function fakeClient(
  byTable: Partial<Record<string, { data?: unknown[]; error?: { message: string } }>>,
  maxRows = 1000,
): ExportClient {
  return {
    from(table: string) {
      return {
        select(_columns: string) {
          return {
            order(_column: string) {
              let after: string | null = null;
              const page: ExportPage = {
                gt(_col, value) {
                  after = value;
                  return page;
                },
                limit(count) {
                  const result = byTable[table] ?? { data: [] };
                  const rows = (result.data ?? []) as { id: string }[];
                  return Promise.resolve({
                    data: result.data
                      ? [...rows]
                          .sort((a, b) => (a.id < b.id ? -1 : 1))
                          .filter((row) => after === null || row.id > after)
                          .slice(0, Math.min(count, maxRows))
                      : null,
                    error: result.error ?? null,
                  });
                },
              };
              return page;
            },
          };
        },
      };
    },
  };
}

describe('collectUserData : garde de compte', () => {
  it('compte changé pendant l’export : la collecte échoue, pas de sauvegarde mêlée', async () => {
    let user = 'compte-A';
    setSessionUserReader(async () => user);
    const sets = Array.from({ length: 5 }, (_, i) => ({ id: `ps-${i}` }));
    const client = fakeClient({ performed_sets: { data: sets } }, 2);
    const original = client.from.bind(client);
    client.from = (table: string) => {
      if (table === 'dated_notes') user = 'compte-B';
      return original(table);
    };
    try {
      await expect(collectUserData(client)).rejects.toThrow(/compte connecté a changé/);
    } finally {
      setSessionUserReader(null);
    }
  });
});

describe('EXPORT_TABLES', () => {
  it('couvre toutes les tables scopées à l utilisateur', () => {
    expect(EXPORT_TABLES).toEqual([
      'exercises',
      'exercise_notes',
      'exercise_overrides',
      'routines',
      'routine_activations',
      'seances',
      'seance_archive_events',
      'seance_versions',
      'prescriptions',
      'executions',
      'performed_sets',
      'dated_notes',
    ]);
  });

  it('seance_archive_events vient après seances (dépendance FK, ADR 0017)', () => {
    const idx = (t: string) => EXPORT_TABLES.indexOf(t as typeof EXPORT_TABLES[number]);
    expect(idx('seance_archive_events')).toBeGreaterThan(idx('seances'));
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

  it('au-delà du plafond de 1000 lignes : la table est exportée EN ENTIER', async () => {
    const sets = Array.from({ length: 2400 }, (_, i) => ({
      id: `ps-${String(i).padStart(4, '0')}`,
      weight_kg: 80,
    }));
    const collected = await collectUserData(fakeClient({ performed_sets: { data: sets } }));
    expect(collected.performed_sets).toHaveLength(2400);
    expect(collected.performed_sets).toEqual(sets);
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
      // L'exo de base visé est lu avec le catalogue : l'override a son parent.
      exercises: { data: [{ id: 'base-1', owner_id: null, name: 'Développé couché' }] },
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
    seance_archive_events: [],
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

describe('withoutRowsNewerThanTheirParent', () => {
  const empty = () =>
    Object.fromEntries(EXPORT_TABLES.map((t) => [t, [] as Row[]])) as CollectedData;

  it('série écrite pendant l’export, exécution absente : écartée, la sauvegarde reste restaurable', () => {
    const data = empty();
    data.executions = [{ id: 'e1', seance_version_id: null }];
    data.performed_sets = [
      { id: 's1', execution_id: 'e1' },
      { id: 's2', execution_id: 'e-arrivee-pendant-export' },
    ];
    data.dated_notes = [{ id: 'n1', execution_id: 'e-arrivee-pendant-export' }];
    const out = withoutRowsNewerThanTheirParent(data, new Set());
    expect(out.performed_sets.map((r) => r.id)).toEqual(['s1']);
    expect(out.dated_notes).toEqual([]);
  });

  it('en cascade : une version absente écarte ses exécutions, puis leurs séries', () => {
    const data = empty();
    data.seance_versions = [];
    data.executions = [
      { id: 'e1', seance_version_id: 'v-nouvelle' },
      { id: 'e2', seance_version_id: null },
    ];
    data.performed_sets = [
      { id: 's1', execution_id: 'e1' },
      { id: 's2', execution_id: 'e2' },
    ];
    const out = withoutRowsNewerThanTheirParent(data, new Set());
    expect(out.executions.map((r) => r.id)).toEqual(['e2']);
    expect(out.performed_sets.map((r) => r.id)).toEqual(['s2']);
  });

  it('sauvegarde cohérente : rien n’est retiré', () => {
    const data = empty();
    data.routines = [{ id: 'r1' }];
    data.seances = [{ id: 'se1', routine_id: 'r1' }];
    expect(withoutRowsNewerThanTheirParent(data, new Set())).toEqual(data);
  });

  it('exo perso supprimé pendant l’export : ses notes, overrides, prescriptions, séries et notes datées sont écartés', () => {
    const data = empty();
    data.seance_versions = [{ id: 'v1', seance_id: 'se1' }];
    data.seances = [{ id: 'se1', routine_id: 'r1' }];
    data.routines = [{ id: 'r1' }];
    data.executions = [{ id: 'e1', seance_version_id: 'v1' }];
    data.exercise_notes = [
      { id: 'n-base', exercise_id: 'base-1' },
      { id: 'n-perdu', exercise_id: 'perso-supprime' },
    ];
    data.exercise_overrides = [
      { id: 'o-base', exercise_id: 'base-1' },
      { id: 'o-perdu', exercise_id: 'perso-supprime' },
    ];
    data.prescriptions = [
      { id: 'p-perso', seance_version_id: 'v1', exercise_id: 'perso-1' },
      { id: 'p-perdu', seance_version_id: 'v1', exercise_id: 'perso-supprime' },
    ];
    data.performed_sets = [
      { id: 's-base', execution_id: 'e1', exercise_id: 'base-1' },
      { id: 's-perdu', execution_id: 'e1', exercise_id: 'perso-supprime' },
    ];
    data.dated_notes = [
      { id: 'd-perso', execution_id: 'e1', exercise_id: 'perso-1' },
      { id: 'd-perdu', execution_id: 'e1', exercise_id: 'perso-supprime' },
    ];

    const out = withoutRowsNewerThanTheirParent(data, new Set(['base-1', 'perso-1']));

    expect(out.exercise_notes.map((r) => r.id)).toEqual(['n-base']);
    expect(out.exercise_overrides.map((r) => r.id)).toEqual(['o-base']);
    expect(out.prescriptions.map((r) => r.id)).toEqual(['p-perso']);
    expect(out.performed_sets.map((r) => r.id)).toEqual(['s-base']);
    expect(out.dated_notes.map((r) => r.id)).toEqual(['d-perso']);
    // Les parents, eux, restent : seules les lignes orphelines partent.
    expect(out.executions.map((r) => r.id)).toEqual(['e1']);
    expect(out.seance_versions.map((r) => r.id)).toEqual(['v1']);
  });
});

describe('collectUserData : liens vers les exercices', () => {
  it('une série sur un exo de base reste : l’exo est lu, même s’il n’est pas exporté', async () => {
    const client = fakeClient({
      exercises: {
        data: [
          { id: 'base-1', owner_id: null, name: 'Développé couché' },
          { id: 'perso-1', owner_id: 'me', name: 'Mon exo' },
        ],
      },
      executions: { data: [{ id: 'e1', seance_version_id: null }] },
      performed_sets: {
        data: [
          { id: 's1', execution_id: 'e1', exercise_id: 'base-1' },
          { id: 's2', execution_id: 'e1', exercise_id: 'perso-1' },
        ],
      },
    });

    const collected = await collectUserData(client);

    expect(collected.exercises.map((r) => r.id)).toEqual(['perso-1']);
    expect(collected.performed_sets.map((r) => r.id)).toEqual(['s1', 's2']);
  });

  it('une note liée à un exo perso absent du catalogue lu est écartée : la sauvegarde reste restaurable', async () => {
    const client = fakeClient({
      exercises: { data: [{ id: 'base-1', owner_id: null, name: 'Développé couché' }] },
      executions: { data: [{ id: 'e1', seance_version_id: null }] },
      exercise_notes: {
        data: [
          { id: 'n1', exercise_id: 'base-1' },
          { id: 'n2', exercise_id: 'perso-supprime-pendant-la-lecture' },
        ],
      },
      performed_sets: {
        data: [{ id: 's1', execution_id: 'e1', exercise_id: 'perso-supprime-pendant-la-lecture' }],
      },
    });

    const collected = await collectUserData(client);

    expect(collected.exercise_notes.map((r) => r.id)).toEqual(['n1']);
    expect(collected.performed_sets).toEqual([]);
  });
});

