// Tests de l'ordre des exos dans l'Analyse (décision du 2026-09-13) : l'ordre du
// plan de la routine courante, séance par séance, puis les exos hors routine
// par ordre alphabétique.
import { describe, expect, it } from 'vitest';
import { orderByPlan, planExerciseOrder } from './exercise-order';

describe('planExerciseOrder', () => {
  it('suit les séances par position, puis les exos par position dans chaque séance', () => {
    const order = planExerciseOrder(
      [
        { id: 'pull', position: 1 },
        { id: 'push', position: 0 },
      ],
      [
        { seanceId: 'pull', exerciseId: 'row', position: 0 },
        { seanceId: 'push', exerciseId: 'ohp', position: 1 },
        { seanceId: 'push', exerciseId: 'bench', position: 0 },
        { seanceId: 'pull', exerciseId: 'curl', position: 1 },
      ],
    );
    expect(order).toEqual(['bench', 'ohp', 'row', 'curl']);
  });

  it('un exo présent dans plusieurs séances garde sa première place dans le plan', () => {
    const order = planExerciseOrder(
      [
        { id: 'upper-a', position: 0 },
        { id: 'upper-b', position: 1 },
      ],
      [
        { seanceId: 'upper-a', exerciseId: 'bench', position: 0 },
        { seanceId: 'upper-b', exerciseId: 'incline', position: 0 },
        { seanceId: 'upper-b', exerciseId: 'bench', position: 1 },
      ],
    );
    expect(order).toEqual(['bench', 'incline']);
  });

  it('ignore une prescription dont la séance n’est pas dans le plan', () => {
    expect(
      planExerciseOrder([{ id: 'push', position: 0 }], [
        { seanceId: 'archivee', exerciseId: 'dips', position: 0 },
        { seanceId: 'push', exerciseId: 'bench', position: 0 },
      ]),
    ).toEqual(['bench']);
  });
});

describe('orderByPlan', () => {
  const exercises = [
    { exerciseId: 'curl', name: 'Curl' },
    { exerciseId: 'bench', name: 'Développé couché' },
    { exerciseId: 'squat', name: 'Squat' },
    { exerciseId: 'abs', name: 'Abdos' },
  ];

  it('place les exos du plan dans son ordre, puis les autres par nom', () => {
    expect(orderByPlan(exercises, ['squat', 'bench']).map((e) => e.exerciseId)).toEqual([
      'squat',
      'bench',
      'abs',
      'curl',
    ]);
  });

  it('sans plan : tout par nom', () => {
    expect(orderByPlan(exercises, []).map((e) => e.name)).toEqual([
      'Abdos',
      'Curl',
      'Développé couché',
      'Squat',
    ]);
  });

  it('un exo du plan jamais entraîné n’apparaît pas', () => {
    expect(orderByPlan(exercises, ['deadlift', 'curl']).map((e) => e.exerciseId)[0]).toBe('curl');
  });

  it('ne mute pas la liste reçue', () => {
    const copy = [...exercises];
    orderByPlan(exercises, ['squat']);
    expect(exercises).toEqual(copy);
  });
});
