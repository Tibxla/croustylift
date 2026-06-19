import { describe, it, expect } from 'vitest';
import {
  decideCaptureSource,
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
    executions?: { performed_on: string; created_at: string } | null;
  },
): PerformedSetWithExecutionRow {
  return {
    weight_kg: 100,
    reps: 8,
    rir: 2,
    set_order: 1,
    side: null,
    executions: { performed_on: '2026-06-18', created_at: '2026-06-18T10:00:00.000Z' },
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
        executions: { performed_on: '2026-06-18', created_at: '2026-06-18T08:00:00.000Z' },
      }),
      setRow({
        execution_id: 'e-soir',
        set_order: 1,
        executions: { performed_on: '2026-06-18', created_at: '2026-06-18T19:00:00.000Z' },
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
        executions: { performed_on: '2026-06-18', created_at: '2026-06-18T10:00:00.000Z' },
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
