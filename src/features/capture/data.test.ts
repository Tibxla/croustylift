import { describe, it, expect } from 'vitest';
import {
  decideCaptureSource,
  deriveExerciseHistory,
  resolveCaptureRoutineId,
  reconstructExerciseExecutions,
  type SeanceChoice,
  type PerformedSetWithExecutionRow,
} from './data';

// Logique PURE de sélection de la séance en Capture (issue #1).
//
// La capture ne charge plus « la 1ʳᵉ séance de la 1ʳᵉ routine » : elle respecte
// la ROUTINE COURANTE (getCurrentRoutineId) et présente ses séances. La fixture
// de démo ne sert plus que de FALLBACK (user sans routine exploitable).
//
// `decideCaptureSource` tranche cette décision à partir de deux entrées déjà
// lues côté Supabase (id de routine courante + séances de cette routine), pour
// la garder testable sans toucher la base.

const seance = (id: string, name: string): SeanceChoice => ({ id, name });

describe('decideCaptureSource', () => {
  it('aucune routine courante -> fallback démo', () => {
    expect(decideCaptureSource(null, [])).toEqual({ kind: 'demo' });
  });

  it('routine courante mais sans séance -> fallback démo (rien à choisir)', () => {
    expect(decideCaptureSource('routine-1', [])).toEqual({ kind: 'demo' });
  });

  it('routine courante avec séances -> choix parmi ces séances', () => {
    const seances = [seance('s-1', 'Upper'), seance('s-2', 'Lower')];
    expect(decideCaptureSource('routine-1', seances)).toEqual({
      kind: 'choose',
      seances,
    });
  });

  it('une seule séance reste un choix (pas un raccourci automatique ici)', () => {
    const seances = [seance('s-1', 'Full body')];
    expect(decideCaptureSource('routine-1', seances)).toEqual({
      kind: 'choose',
      seances,
    });
  });
});

// Résolution de la routine sur laquelle ouvrir la Capture : routine courante si
// définie, sinon repli sur la 1ʳᵉ routine existante (évite l'impasse « rien à
// logger » quand une routine existe mais qu'aucune n'a été « définie courante »).
describe('resolveCaptureRoutineId', () => {
  it('routine courante définie -> on la prend (même avec d\'autres routines)', () => {
    expect(resolveCaptureRoutineId('r-courante', ['r-1', 'r-courante', 'r-2'])).toBe(
      'r-courante',
    );
  });

  it('aucune routine courante mais des routines existent -> repli sur la 1ʳᵉ', () => {
    expect(resolveCaptureRoutineId(null, ['r-1', 'r-2'])).toBe('r-1');
  });

  it('aucune routine courante et aucune routine -> null (vrai premier lancement)', () => {
    expect(resolveCaptureRoutineId(null, [])).toBeNull();
  });
});

// Reconstruction de l'historique domaine à partir des lignes plates
// `performed_sets`+`executions` (partie PURE de `loadExerciseExecutions`). La
// requête Supabase reste dans la couche d'accès ; seul ce regroupement est
// testé ici — sans toucher la base. On vérifie les invariants que les dérivées
// du domaine (`lastReference`, `personalRecord`, courbes) supposent : mapping du
// `side`, regroupement par exécution avec tie-breaks (createdAt + id) portés,
// garde-fou orphelin et coercition numérique de `weight_kg`.

/** Fabrique une ligne plate `performed_sets`+`executions` (jointure présente par défaut). */
function setRow(
  overrides: Partial<PerformedSetWithExecutionRow> & { execution_id: string } & {
    executions?: {
      performed_on: string;
      created_at: string;
      seance_version_id: string;
    } | null;
  },
): PerformedSetWithExecutionRow {
  return {
    weight_kg: 100,
    reps: 8,
    rir: 2,
    set_order: 1,
    side: null,
    executions: {
      performed_on: '2026-06-18',
      created_at: '2026-06-18T10:00:00.000Z',
      seance_version_id: 'v-upper-1',
    },
    ...overrides,
  };
}

describe('reconstructExerciseExecutions', () => {
  it('aucune ligne -> historique vide (user neuf)', () => {
    expect(reconstructExerciseExecutions([], 'exo-1')).toEqual([]);
  });

  it('side null -> undefined (toSide) ; "left"/"right" préservés, autre valeur -> undefined', () => {
    const rows: PerformedSetWithExecutionRow[] = [
      setRow({ execution_id: 'e-1', set_order: 1, side: null }),
      setRow({ execution_id: 'e-1', set_order: 2, side: 'left' }),
      setRow({ execution_id: 'e-1', set_order: 2, side: 'right' }),
      setRow({ execution_id: 'e-1', set_order: 3, side: 'bilateral' }),
    ];
    const [exec] = reconstructExerciseExecutions(rows, 'exo-1');
    expect(exec?.sets.map((s) => s.side)).toEqual([undefined, 'left', 'right', undefined]);
  });

  it('regroupe par execution_id : deux exécutions à performed_on égal restent distinctes, clés de tie-break (createdAt + id) portées', () => {
    // Deux séances le même jour (performed_on égal) : `created_at`/`id` distincts
    // les départagent côté domaine (lastReference, courbes). On vérifie que ces
    // clés sont bien portées sur chaque ExerciseExecution.
    const rows: PerformedSetWithExecutionRow[] = [
      setRow({
        execution_id: 'e-matin',
        set_order: 1,
        executions: { performed_on: '2026-06-18', created_at: '2026-06-18T08:00:00.000Z', seance_version_id: 'v-upper-1' },
      }),
      setRow({
        execution_id: 'e-soir',
        set_order: 1,
        executions: { performed_on: '2026-06-18', created_at: '2026-06-18T19:00:00.000Z', seance_version_id: 'v-upper-1' },
      }),
    ];
    const execs = reconstructExerciseExecutions(rows, 'exo-1');
    expect(execs).toHaveLength(2);
    expect(execs.map((e) => e.id)).toEqual(['e-matin', 'e-soir']);
    expect(execs.map((e) => e.date)).toEqual(['2026-06-18', '2026-06-18']);
    expect(execs.map((e) => e.createdAt)).toEqual([
      '2026-06-18T08:00:00.000Z',
      '2026-06-18T19:00:00.000Z',
    ]);
    expect(execs.every((e) => e.exerciseId === 'exo-1')).toBe(true);
  });

  it('plusieurs séries d\'une même exécution sont regroupées sous une seule ExerciseExecution', () => {
    const rows: PerformedSetWithExecutionRow[] = [
      setRow({ execution_id: 'e-1', set_order: 1 }),
      setRow({ execution_id: 'e-1', set_order: 2 }),
      setRow({ execution_id: 'e-1', set_order: 3 }),
    ];
    const execs = reconstructExerciseExecutions(rows, 'exo-1');
    expect(execs).toHaveLength(1);
    expect(execs[0]?.sets.map((s) => s.order)).toEqual([1, 2, 3]);
  });

  it('garde-fou orphelin : ligne sans jointure executions (null) ignorée', () => {
    const rows: PerformedSetWithExecutionRow[] = [
      setRow({ execution_id: 'e-orpheline', executions: null }),
      setRow({
        execution_id: 'e-valide',
        executions: { performed_on: '2026-06-18', created_at: '2026-06-18T10:00:00.000Z', seance_version_id: 'v-upper-1' },
      }),
    ];
    const execs = reconstructExerciseExecutions(rows, 'exo-1');
    expect(execs).toHaveLength(1);
    expect(execs[0]?.id).toBe('e-valide');
  });

  it('coercition Number(weight_kg) : une charge en chaîne (numeric Postgres) devient un nombre', () => {
    // Postgres renvoie `numeric` en chaîne via PostgREST : `Number(...)` la coerce.
    const rows = [
      setRow({
        execution_id: 'e-1',
        weight_kg: '82.5' as unknown as number,
      }),
    ];
    const [exec] = reconstructExerciseExecutions(rows, 'exo-1');
    const weight = exec?.sets[0]?.weightKg;
    expect(weight).toBe(82.5);
    expect(typeof weight).toBe('number');
  });
});

// Dérivées d'historique (Référence scopée séance + repli + records all-time).
// Partie PURE de `loadExerciseHistory` : le scope de séance filtre les lignes par
// `seance_version_id` (toutes les versions du template) ; les records ignorent le
// scope. Décisions du 2026-07-29, cf. CONTEXT.md « Référence » / « Record personnel ».

describe('deriveExerciseHistory', () => {
  // Historique sur DEUX séances : Upper (v1 puis v2) et Full Body. L'exo est le
  // même partout ; les perfs diffèrent pour rendre tout mauvais scope détectable.
  const rows: PerformedSetWithExecutionRow[] = [
    // Upper v1, 2026-06-01 : 80 kg.
    setRow({
      execution_id: 'e-upper-old',
      weight_kg: 80,
      executions: {
        performed_on: '2026-06-01',
        created_at: '2026-06-01T10:00:00.000Z',
        seance_version_id: 'v-upper-1',
      },
    }),
    // Full Body, 2026-06-15 : 90 kg (plus récent que Upper, AUTRE séance).
    setRow({
      execution_id: 'e-fullbody',
      weight_kg: 90,
      executions: {
        performed_on: '2026-06-15',
        created_at: '2026-06-15T10:00:00.000Z',
        seance_version_id: 'v-fullbody-1',
      },
    }),
    // Upper v2, 2026-06-10 : 82,5 kg (la dernière fois DANS Upper).
    setRow({
      execution_id: 'e-upper-recent',
      weight_kg: 82.5,
      executions: {
        performed_on: '2026-06-10',
        created_at: '2026-06-10T10:00:00.000Z',
        seance_version_id: 'v-upper-2',
      },
    }),
  ];
  const upperVersions = ['v-upper-1', 'v-upper-2'];

  it('la Référence est la dernière perf DANS la séance, pas la plus récente toutes séances', () => {
    const h = deriveExerciseHistory(rows, 'exo-1', upperVersions, false);
    // Dernière exécution d'Upper = 2026-06-10 (82,5), PAS le Full Body du 15 (90).
    expect(h.reference?.map((s) => s.weightKg)).toEqual([82.5]);
  });

  it('la Référence traverse les versions du template (v1 comptée si v2 vide)', () => {
    const onlyV1 = rows.filter((r) => r.executions?.seance_version_id !== 'v-upper-2');
    const h = deriveExerciseHistory(onlyV1, 'exo-1', upperVersions, false);
    expect(h.reference?.map((s) => s.weightKg)).toEqual([80]);
  });

  it('pas de repli quand la séance a une Référence (fallbackReference null)', () => {
    const h = deriveExerciseHistory(rows, 'exo-1', upperVersions, false);
    expect(h.fallbackReference).toBeNull();
  });

  it('séance sans historique : Référence null, repli = dernière perf toutes séances', () => {
    const h = deriveExerciseHistory(rows, 'exo-1', ['v-lower-1'], false);
    expect(h.reference).toBeNull();
    // Le repli pioche la plus récente TOUTES séances : le Full Body du 15 (90).
    expect(h.fallbackReference?.map((s) => s.weightKg)).toEqual([90]);
  });

  it('aucun historique nulle part : Référence ET repli null, records nuls', () => {
    const h = deriveExerciseHistory([], 'exo-1', upperVersions, false);
    expect(h.reference).toBeNull();
    expect(h.fallbackReference).toBeNull();
    expect(h.personalRecord).toEqual({
      bestE1rm: null,
      bestE1rmSet: null,
      bestWeightReps: null,
    });
  });

  it('le Record personnel reste ALL-TIME toutes séances (le 90 du Full Body compte)', () => {
    const h = deriveExerciseHistory(rows, 'exo-1', upperVersions, false);
    expect(h.personalRecord.bestWeightReps).toEqual({ weightKg: 90, reps: 8 });
    expect(h.personalRecord.bestE1rmSet).toEqual({ weightKg: 90, reps: 8 });
  });

  it('exo bilatéral : pas de records par côté (null) ; unilatéral : dérivés', () => {
    expect(deriveExerciseHistory(rows, 'exo-1', upperVersions, false).personalRecordBySide).toBeNull();
    const uniRows = [
      setRow({ execution_id: 'e-uni', side: 'left', weight_kg: 30 }),
      setRow({ execution_id: 'e-uni', side: 'right', weight_kg: 28 }),
    ];
    const bySide = deriveExerciseHistory(uniRows, 'exo-1', upperVersions, true).personalRecordBySide;
    expect(bySide?.left.bestWeightReps).toEqual({ weightKg: 30, reps: 8 });
    expect(bySide?.right.bestWeightReps).toEqual({ weightKg: 28, reps: 8 });
  });

  it('une ligne orpheline (jointure absente) reste hors du scope de séance', () => {
    const withOrphan = [...rows, setRow({ execution_id: 'e-orpheline', executions: null })];
    const h = deriveExerciseHistory(withOrphan, 'exo-1', upperVersions, false);
    expect(h.reference?.map((s) => s.weightKg)).toEqual([82.5]);
  });
});
