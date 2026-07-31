// Tests de la partie PURE de l'analyse par séance (issue #67) :
// `analyzeExecutions` groupe les exécutions d'un exo par séance et dérive une
// courbe (+ pente + secondaire) PAR groupe — un même exo n'a pas la même perf
// selon le contexte de fatigue de la séance (cf. CONTEXT.md « Référence »).
// La requête Supabase reste dans la couche d'accès ; seul le groupement/tri est
// testé ici, les courbes elles-mêmes étant couvertes par le domaine.
import { describe, expect, it } from 'vitest';
import { analyzeExecutions, type TrainedExercise } from './data';
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

const names = new Map([
  ['s-upper', 'Upper A'],
  ['s-fullbody', 'Full Body'],
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
