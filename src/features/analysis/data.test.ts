// Tests de la partie PURE de l'analyse par séance (issue #67) :
// `analyzeExecutions` groupe les exécutions d'un exo par séance et dérive une
// courbe (+ pente + secondaire) PAR groupe — un même exo n'a pas la même perf
// selon le contexte de fatigue de la séance (cf. GLOSSARY.md « Référence »).
// La requête Supabase reste dans la couche d'accès ; seul le groupement/tri est
// testé ici, les courbes elles-mêmes étant couvertes par le domaine.
import { describe, expect, it } from 'vitest';
import {
  analyzeExecutions,
  groupExecutionRows,
  type ExecutionSetRow,
  type SeanceInfo,
  type TrainedExercise,
} from './data';
import type { ExerciseExecution } from '../../domain/types';

const exercise: TrainedExercise = { exerciseId: 'bench', name: 'Développé couché' };

/** Une exécution d'une série unique (e1RM = poids × (1 + (reps+rir)/30)). */
function execution(
  date: string,
  weightKg: number,
  seanceId: string | undefined,
  id = `e-${date}-${seanceId ?? 'none'}`,
): ExerciseExecution {
  return {
    date,
    exerciseId: 'bench',
    sets: [{ weightKg, reps: 5, rir: 1, order: 1 }],
    createdAt: `${date}T10:00:00.000Z`,
    id,
    seanceId,
  };
}

const names = new Map<string, SeanceInfo>([
  ['s-upper', { name: 'Upper A', routineId: 'r-ul', routineName: 'Upper/Lower' }],
  ['s-fullbody', { name: 'Full Body', routineId: 'r-ul', routineName: 'Upper/Lower' }],
]);

describe('analyzeExecutions — courbes par séance', () => {
  it('groupe les exécutions par séance : une courbe par séance, points scopés', () => {
    const { seanceCurves } = analyzeExecutions(
      exercise,
      [
        execution('2026-07-01', 80, 's-upper'),
        execution('2026-07-08', 82.5, 's-upper'),
        execution('2026-07-05', 70, 's-fullbody'),
      ],
      names,
    );
    expect(seanceCurves).toHaveLength(2);
    const upper = seanceCurves.find((c) => c.seanceId === 's-upper');
    const fullbody = seanceCurves.find((c) => c.seanceId === 's-fullbody');
    expect(upper?.curve.map((p) => p.date)).toEqual(['2026-07-01', '2026-07-08']);
    expect(fullbody?.curve.map((p) => p.date)).toEqual(['2026-07-05']);
    expect(upper?.seanceName).toBe('Upper A');
    expect(fullbody?.seanceName).toBe('Full Body');
  });

  it('met la séance la plus récemment exécutée EN PREMIER (elle portera l’accent)', () => {
    const { seanceCurves } = analyzeExecutions(
      exercise,
      [
        execution('2026-07-01', 80, 's-upper'),
        execution('2026-07-20', 70, 's-fullbody'),
        execution('2026-07-08', 82.5, 's-upper'),
      ],
      names,
    );
    expect(seanceCurves.map((c) => c.seanceId)).toEqual(['s-fullbody', 's-upper']);
    expect(seanceCurves[0]?.lastDate).toBe('2026-07-20');
  });

  it('à dernière date égale, départage par le nom (ordre stable)', () => {
    const { seanceCurves } = analyzeExecutions(
      exercise,
      [
        execution('2026-07-10', 80, 's-upper', 'e-a'),
        execution('2026-07-10', 70, 's-fullbody', 'e-b'),
      ],
      names,
    );
    // « Full Body » < « Upper A » en ordre fr.
    expect(seanceCurves.map((c) => c.seanceName)).toEqual(['Full Body', 'Upper A']);
  });

  it('les exécutions sans séance résoluble forment un groupe « Hors séance »', () => {
    const { seanceCurves } = analyzeExecutions(
      exercise,
      [execution('2026-07-01', 80, undefined)],
      names,
    );
    expect(seanceCurves).toHaveLength(1);
    expect(seanceCurves[0]?.seanceId).toBeNull();
    expect(seanceCurves[0]?.seanceName).toBe('Hors séance');
  });

  it('séance sans nom connu -> « (séance inconnue) », jamais de donnée écartée', () => {
    const { seanceCurves } = analyzeExecutions(
      exercise,
      [execution('2026-07-01', 80, 's-fantome')],
      names,
    );
    expect(seanceCurves[0]?.seanceName).toBe('(séance inconnue)');
    expect(seanceCurves[0]?.curve).toHaveLength(1);
  });

  it('la pente %/semaine se calcule PAR séance (3 points ici, 1 là -> null)', () => {
    const { seanceCurves } = analyzeExecutions(
      exercise,
      [
        execution('2026-07-01', 80, 's-upper'),
        execution('2026-07-08', 82.5, 's-upper'),
        execution('2026-07-15', 85, 's-upper'),
        execution('2026-07-20', 70, 's-fullbody'),
      ],
      names,
    );
    const upper = seanceCurves.find((c) => c.seanceId === 's-upper');
    const fullbody = seanceCurves.find((c) => c.seanceId === 's-fullbody');
    expect(upper?.weeklyRate).not.toBeNull();
    expect(fullbody?.weeklyRate).toBeNull();
  });

  it('une exécution vide (exo skippé) ne crée pas de courbe fantôme', () => {
    const { seanceCurves } = analyzeExecutions(
      exercise,
      [
        {
          date: '2026-07-01',
          exerciseId: 'bench',
          sets: [],
          seanceId: 's-upper',
        },
        execution('2026-07-05', 70, 's-fullbody'),
      ],
      names,
    );
    expect(seanceCurves.map((c) => c.seanceId)).toEqual(['s-fullbody']);
  });

  it('aucune exécution -> aucune courbe (l’UI n’affiche rien)', () => {
    expect(analyzeExecutions(exercise, [], names).seanceCurves).toEqual([]);
  });
});

describe('analyzeExecutions — libellé « séance · routine » (ADR 0016)', () => {
  const across = new Map<string, SeanceInfo>([
    ['s-upper', { name: 'Upper A', routineId: 'r-ul', routineName: 'Upper/Lower' }],
    ['s-push', { name: 'Push', routineId: 'r-ppl', routineName: 'PPL' }],
    ['s-push2', { name: 'Push', routineId: 'r-ppl2', routineName: 'PPL v2' }],
  ]);

  it('toutes les courbes dans une même routine : le nom de séance suffit', () => {
    const { seanceCurves } = analyzeExecutions(
      exercise,
      [execution('2026-07-01', 80, 's-upper'), execution('2026-07-05', 70, 's-fullbody')],
      names,
    );
    expect(seanceCurves.map((c) => c.label).sort()).toEqual(['Full Body', 'Upper A']);
  });

  it('dès que la carte mêle deux routines, TOUTES les entrées portent leur routine', () => {
    const { seanceCurves } = analyzeExecutions(
      exercise,
      [
        execution('2026-07-01', 80, 's-upper'),
        execution('2026-08-01', 82.5, 's-push'),
        execution('2026-09-01', 85, 's-push2'),
      ],
      across,
    );
    expect(seanceCurves.map((c) => c.label)).toEqual([
      'Push · PPL v2',
      'Push · PPL',
      'Upper A · Upper/Lower',
    ]);
    expect(seanceCurves.map((c) => c.routineName)).toEqual(['PPL v2', 'PPL', 'Upper/Lower']);
  });

  it('« Hors séance » reste nu, même sur une carte qui mêle des routines', () => {
    const { seanceCurves } = analyzeExecutions(
      exercise,
      [
        execution('2026-07-01', 80, 's-upper'),
        execution('2026-08-01', 82.5, 's-push'),
        execution('2026-09-01', 60, undefined),
      ],
      across,
    );
    expect(seanceCurves.find((c) => c.seanceId === null)?.label).toBe('Hors séance');
  });

  it('une seule courbe : pas de routine accolée', () => {
    const { seanceCurves } = analyzeExecutions(
      exercise,
      [execution('2026-08-01', 82.5, 's-push')],
      across,
    );
    expect(seanceCurves[0]?.label).toBe('Push');
  });
});

// --- Lecture groupée de l'Analyse (une lecture pour toutes les cartes) ---------
//
// `loadAnalyses` lisait une requête par exo (environ 40 pour 30 exos). Il lit
// désormais toutes les séries en une lecture paginée, que `groupExecutionRows`
// répartit par exo. Les lignes arrivent triées par id (pagination), donc dans le
// désordre : le regroupement ne doit pas en dépendre.

describe('groupExecutionRows — toutes les séries, regroupées par exo', () => {
  const setRow = (over: Partial<ExecutionSetRow> & { id: string }): ExecutionSetRow => ({
    created_at: '2026-07-01T10:00:00+00:00',
    weight_kg: 80,
    reps: 5,
    rir: 1,
    set_order: 1,
    side: null,
    execution_id: 'x1',
    exercise_id: 'bench',
    exercises: { name: 'Développé couché' },
    executions: {
      performed_on: '2026-07-01',
      created_at: '2026-07-01T09:59:00+00:00',
      started_at: '2026-07-01T09:30:00+00:00',
      seance_versions: {
        seance_id: 's-upper',
        seances: { name: 'Upper A', routine_id: 'r-ul', routines: { name: 'Upper/Lower' } },
      },
    },
    ...over,
  });

  const rows: ExecutionSetRow[] = [
    // Désordre volontaire : la série 2 du bench arrive avant la série 1.
    setRow({ id: 'a', set_order: 2, weight_kg: 77.5, created_at: '2026-07-01T10:05:00+00:00' }),
    setRow({ id: 'b', exercise_id: 'squat', exercises: { name: 'Squat' }, weight_kg: 120 }),
    setRow({ id: 'c', set_order: 1, created_at: '2026-07-01T10:00:00+00:00' }),
  ];

  it('rend une entrée par exo, avec son nom et ses exécutions', () => {
    const grouped = groupExecutionRows(rows);
    expect([...grouped.keys()].sort()).toEqual(['bench', 'squat']);
    expect(grouped.get('bench')!.name).toBe('Développé couché');
    expect(grouped.get('squat')!.executions).toHaveLength(1);
    expect(grouped.get('squat')!.executions[0]!.sets[0]!.weightKg).toBe(120);
  });

  it('les deux exos d’une même séance gardent chacun leur exécution (même id d’exécution)', () => {
    const grouped = groupExecutionRows(rows);
    const bench = grouped.get('bench')!.executions[0]!;
    const squat = grouped.get('squat')!.executions[0]!;
    expect(bench.id).toBe('x1');
    expect(squat.id).toBe('x1');
    expect(bench.exerciseId).toBe('bench');
    expect(squat.exerciseId).toBe('squat');
    expect(bench.sets).toHaveLength(2);
  });

  it('remet les séries dans l’ordre de saisie, quel que soit l’ordre d’arrivée', () => {
    const bench = groupExecutionRows(rows).get('bench')!.executions[0]!;
    expect(bench.sets.map((s) => s.order)).toEqual([1, 2]);
  });

  it('porte date, création, lancement et séance de l’exécution', () => {
    const { executions, seances } = groupExecutionRows(rows).get('bench')!;
    expect(executions[0]).toMatchObject({
      date: '2026-07-01',
      createdAt: '2026-07-01T09:59:00+00:00',
      startedAt: '2026-07-01T09:30:00+00:00',
      seanceId: 's-upper',
    });
    expect(seances.get('s-upper')).toEqual({
      name: 'Upper A',
      routineId: 'r-ul',
      routineName: 'Upper/Lower',
    });
  });

  it('sans lancement horodaté ni séance : champs absents, rien d’inventé', () => {
    const grouped = groupExecutionRows([
      setRow({
        id: 'z',
        executions: {
          performed_on: '2026-07-01',
          created_at: '2026-07-01T09:59:00+00:00',
          started_at: null,
          seance_versions: null,
        },
      }),
    ]);
    const execution = grouped.get('bench')!.executions[0]!;
    expect(execution.startedAt).toBeUndefined();
    expect(execution.seanceId).toBeUndefined();
    expect(grouped.get('bench')!.seances.size).toBe(0);
  });

  it('une série orpheline d’exécution est écartée', () => {
    expect(groupExecutionRows([setRow({ id: 'o', executions: null })]).size).toBe(0);
  });

  it('même résultat que la lecture par exo pour l’analyse d’une carte', () => {
    const { executions, seances } = groupExecutionRows(rows).get('bench')!;
    const analysis = analyzeExecutions(
      { exerciseId: 'bench', name: 'Développé couché' },
      executions,
      seances,
    );
    expect(analysis.seanceCurves).toHaveLength(1);
    expect(analysis.seanceCurves[0]!.seanceName).toBe('Upper A');
  });
});
