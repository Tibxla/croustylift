// Chargeur de la semaine (fin de séance) : bornes de la semaine civile, exclusion
// de l'exécution en cours, fusion des overrides, pagination au-delà du plafond
// de PostgREST, et repli hors ligne (le prévu en cache reste, « avant » manque).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setSessionUserReader } from '../../lib/session-identity';
import { weekSetsByMuscle } from './session-recap';
import { loadWeekMuscles, weekRowsToBefore, type WeekSetRow } from './week-muscles';

// --- Client Supabase simulé : chaque requête de séries est journalisée --------

const server = vi.hoisted(() => ({
  rows: [] as unknown[],
  offline: false,
  queries: [] as { filters: [string, string, unknown][]; after: string | null; limit: number }[],
}));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'seances') {
        const one = {
          select: () => one,
          eq: () => one,
          maybeSingle: async () =>
            server.offline ? Promise.reject(new TypeError('Failed to fetch')) : { data: { routines: { name: 'Ma routine' } }, error: null },
        };
        return one;
      }
      if (table !== 'performed_sets') throw new Error(`table inattendue : ${table}`);
      const q = { filters: [] as [string, string, unknown][], after: null as string | null, limit: 0 };
      server.queries.push(q);
      const builder = {
        select: () => builder,
        gte: (c: string, v: unknown) => (q.filters.push(['gte', c, v]), builder),
        lte: (c: string, v: unknown) => (q.filters.push(['lte', c, v]), builder),
        neq: (c: string, v: unknown) => (q.filters.push(['neq', c, v]), builder),
        gt: (_c: string, v: string) => ((q.after = v), builder),
        order: () => builder,
        limit: (n: number) => ((q.limit = n), builder),
        then: (resolve: (r: unknown) => void, reject: (e: unknown) => void) => {
          if (server.offline) return Promise.reject(new TypeError('Failed to fetch')).then(resolve, reject);
          const page = (server.rows as WeekSetRow[]).filter((r) => q.after === null || r.id > q.after);
          return Promise.resolve({ data: page.slice(0, q.limit), error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  },
}));

vi.mock('../exercises/overrides', () => ({
  loadExerciseOverrides: async () => new Map([['curl', { name: null, unilateral: true, primaryMuscles: ['biceps'] }]]),
}));

vi.mock('./data', () => ({
  loadCaptureSource: async () => ({ kind: 'choose', seances: [{ id: 's-a', name: 'Upper A' }, { id: 's-b', name: 'Lower A' }] }),
  loadChosenSeance: async (c: { id: string; name: string }) => ({ seance: c, seanceVersionId: `v-${c.id}` }),
  loadSeanceForCapture: async (seance: { id: string; name: string }) => ({
    id: seance.id,
    name: seance.name,
    exercises: [
      {
        exerciseId: `${seance.id}-ex`,
        name: 'exo',
        primaryMuscles: [seance.id === 's-a' ? 'pectoraux' : 'quadriceps'],
        prescription: { sets: { min: 3, max: 4 }, reps: { min: 8, max: 12 }, rir: { min: 1, max: 2 } },
        reference: null,
      },
    ],
  }),
}));

const set = (id: string, execution_id: string, exercise_id: string, over: Partial<WeekSetRow> = {}): WeekSetRow => ({
  id,
  weight_kg: 80,
  reps: 8,
  rir: 1,
  set_order: 1,
  side: null,
  exercise_id,
  execution_id,
  exercises: { name: exercise_id, unilateral: false, primary_muscles: ['pectoraux'] },
  executions: {
    performed_on: '2026-11-23',
    started_at: '2026-11-23T09:55:00Z',
    created_at: '2026-11-23T10:00:00Z',
    seance_versions: { seances: { name: 'Upper A' } },
  },
  ...over,
});

beforeEach(() => {
  server.rows = [];
  server.offline = false;
  server.queries = [];
  setSessionUserReader(async () => 'u1');
});
afterEach(() => setSessionUserReader(null));

describe('loadWeekMuscles', () => {
  it('borne la lecture du lundi de la semaine au jour de la séance, et exclut l’exécution en cours', async () => {
    await loadWeekMuscles({ seanceId: 's-a', dateIso: '2026-11-26', currentExecutionId: 'exec-du-jour', currentStartedAt: Date.parse('2026-11-26T18:00:00Z') });
    expect(server.queries[0]!.filters).toEqual([
      ['gte', 'executions.performed_on', '2026-11-23'],
      ['lte', 'executions.performed_on', '2026-11-26'],
      ['neq', 'execution_id', 'exec-du-jour'],
    ]);
  });

  it('semaine à cheval sur deux mois : du lundi 30 novembre à la séance du dimanche 6 décembre', async () => {
    await loadWeekMuscles({ seanceId: 's-a', dateIso: '2026-12-06', currentExecutionId: 'x', currentStartedAt: Date.parse('2026-12-06T18:00:00Z') });
    expect(server.queries[0]!.filters.slice(0, 2)).toEqual([
      ['gte', 'executions.performed_on', '2026-11-30'],
      ['lte', 'executions.performed_on', '2026-12-06'],
    ]);
  });

  it('fusionne les overrides et rend le prévu de toutes les séances de la routine', async () => {
    server.rows = [set('a1', 'e1', 'curl', { side: 'left' }), set('a2', 'e1', 'curl', { side: 'right' })];
    const week = await loadWeekMuscles({ seanceId: 's-a', dateIso: '2026-11-26', currentExecutionId: 'x', currentStartedAt: Date.parse('2026-11-26T18:00:00Z') });
    expect(week.before).toEqual([
      {
        unilateral: true,
        primaryMuscles: ['biceps'],
        sets: [
          { order: 1, weightKg: 80, reps: 8, rir: 1, side: 'left' },
          { order: 1, weightKg: 80, reps: 8, rir: 1, side: 'right' },
        ],
      },
    ]);
    expect(week.seancesBefore).toEqual([{ name: 'Upper A', performedOn: '2026-11-23' }]);
    expect(week.planned?.seanceCount).toBe(2);
    expect(week.planned?.exercises.map((e) => e.primaryMuscles[0])).toEqual(['pectoraux', 'quadriceps']);
    expect(week.routineName).toBe('Ma routine');
  });

  it('pagine au-delà du plafond de PostgREST : aucune série perdue', async () => {
    server.rows = Array.from({ length: 2500 }, (_, i) => set(`r${String(i).padStart(5, '0')}`, `e${i % 3}`, 'dc', { set_order: i }));
    const week = await loadWeekMuscles({ seanceId: 's-a', dateIso: '2026-11-26', currentExecutionId: 'x', currentStartedAt: Date.parse('2026-11-26T18:00:00Z') });
    expect(server.queries.map((q) => q.after)).toEqual([null, 'r00999', 'r01999']);
    expect(week.before?.reduce((n, e) => n + e.sets.length, 0)).toBe(2500);
  });

  it('hors ligne : « avant » manque (null), le prévu en cache reste', async () => {
    server.offline = true;
    const week = await loadWeekMuscles({ seanceId: 's-a', dateIso: '2026-11-26', currentExecutionId: 'x', currentStartedAt: Date.parse('2026-11-26T18:00:00Z') });
    expect(week.before).toBeNull();
    expect(week.seancesBefore).toEqual([]);
    expect(week.planned?.seanceCount).toBe(2);
    expect(week.routineName).toBeNull();
  });

  it('séance hors de la routine courante : pas de prévu', async () => {
    const week = await loadWeekMuscles({ seanceId: 'autre', dateIso: '2026-11-26', currentExecutionId: 'x', currentStartedAt: Date.parse('2026-11-26T18:00:00Z') });
    expect(week.planned).toBeNull();
  });
});

describe('weekRowsToBefore', () => {
  it('un exo par exécution, rangées par jour puis création ; l’exécution en cours et les lignes orphelines ignorées', () => {
    const tue = { performed_on: '2026-11-24', started_at: '2026-11-24T07:55:00Z', created_at: '2026-11-24T08:00:00Z', seance_versions: { seances: { name: 'Lower A' } } };
    const { before, seancesBefore } = weekRowsToBefore(
      [
        set('z1', 'e2', 'squat', { executions: tue, exercises: { name: 'Squat', unilateral: false, primary_muscles: ['quadriceps'] } }),
        set('a1', 'e1', 'dc', { set_order: 2 }),
        set('a2', 'e1', 'dc', { set_order: 1 }),
        set('b1', 'en-cours', 'dc'),
        set('c1', 'orpheline', 'dc', { executions: null }),
      ],
      new Map(),
      'en-cours',
    );
    expect(seancesBefore).toEqual([
      { name: 'Upper A', performedOn: '2026-11-23' },
      { name: 'Lower A', performedOn: '2026-11-24' },
    ]);
    expect(before[0]!.sets.map((s) => s.order)).toEqual([1, 2]);
    const rows = weekSetsByMuscle({ before, today: [], planned: [] });
    expect(rows.find((r) => r.muscle === 'pectoraux')?.before).toBe(2);
    expect(rows.find((r) => r.muscle === 'quadriceps')?.before).toBe(1);
  });
});

// « Avant » la séance close, et seulement avant. Le cas : une séance lancée le
// lundi et rangée le jeudi (clôture tardive) comptait en « avant » les séances
// du mardi et du mercredi, faites APRÈS elle.
describe('weekRowsToBefore, bornée à la séance close', () => {
  const day = (performed_on: string, started_at: string | null, created_at: string, name: string) => ({
    performed_on,
    started_at,
    created_at,
    seance_versions: { seances: { name } },
  });
  const bound = { dateIso: '2026-11-25', startedAt: Date.parse('2026-11-25T17:00:00Z') };

  it('un jour postérieur à la séance n’est jamais « avant »', () => {
    const { seancesBefore } = weekRowsToBefore(
      [
        set('a1', 'lundi', 'dc', { executions: day('2026-11-23', '2026-11-23T18:00:00Z', '2026-11-23T18:05:00Z', 'Lundi') }),
        set('b1', 'jeudi', 'dc', { executions: day('2026-11-26', '2026-11-26T08:00:00Z', '2026-11-26T08:05:00Z', 'Jeudi') }),
      ],
      new Map(),
      null,
      bound,
    );
    expect(seancesBefore.map((s) => s.name)).toEqual(['Lundi']);
  });

  it('le même jour : seules les exécutions commencées avant elle, d’après leur début', () => {
    const { seancesBefore } = weekRowsToBefore(
      [
        set('m1', 'matin', 'dc', { executions: day('2026-11-25', '2026-11-25T07:00:00Z', '2026-11-25T07:10:00Z', 'Matin') }),
        set('s1', 'soir', 'dc', { executions: day('2026-11-25', '2026-11-25T20:00:00Z', '2026-11-25T20:05:00Z', 'Soir') }),
        // Commencée avant (16 h 50), créée après (17 h 10, 1re série) : le début fait foi.
        set('p1', 'presque', 'dc', { executions: day('2026-11-25', '2026-11-25T16:50:00Z', '2026-11-25T17:10:00Z', 'Presque') }),
      ],
      new Map(),
      null,
      bound,
    );
    expect(seancesBefore.map((s) => s.name)).toEqual(['Matin', 'Presque']);
  });

  it('le même jour, sans début connu (ligne héritée) : sa création en tient lieu', () => {
    const { seancesBefore } = weekRowsToBefore(
      [
        set('h1', 'heritee-avant', 'dc', { executions: day('2026-11-25', null, '2026-11-25T09:00:00Z', 'Héritée matin') }),
        set('h2', 'heritee-apres', 'dc', { executions: day('2026-11-25', null, '2026-11-25T21:00:00Z', 'Héritée soir') }),
      ],
      new Map(),
      null,
      bound,
    );
    expect(seancesBefore.map((s) => s.name)).toEqual(['Héritée matin']);
  });

  it('la lecture passe le début de l’exécution en cours : une séance plus tardive du même jour n’est pas comptée', async () => {
    server.rows = [
      set('m1', 'matin', 'dc', { executions: day('2026-11-26', '2026-11-26T07:00:00Z', '2026-11-26T07:10:00Z', 'Matin') }),
      set('s1', 'soir', 'dc', { executions: day('2026-11-26', '2026-11-26T20:00:00Z', '2026-11-26T20:05:00Z', 'Soir') }),
    ];
    const week = await loadWeekMuscles({
      seanceId: 's-a',
      dateIso: '2026-11-26',
      currentExecutionId: 'x',
      currentStartedAt: Date.parse('2026-11-26T18:00:00Z'),
    });
    expect(week.seancesBefore.map((s) => s.name)).toEqual(['Matin']);
  });
});
