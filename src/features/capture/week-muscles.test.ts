// Partie pure du chargeur de la semaine (fin de séance) : regroupement des
// séries par exo et par exécution, overrides de muscles, bornes de la semaine.
import { describe, expect, it } from 'vitest';
import { weekSetsByMuscle } from './session-recap';
import { sundayOf, weekRowsToBefore, type WeekRow } from './week-muscles';

const set = (exercise_id: string, set_order: number, over: Partial<WeekRow['performed_sets'][number]> = {}) => ({
  weight_kg: 80,
  reps: 8,
  rir: 1,
  set_order,
  side: null,
  exercise_id,
  exercises: { name: exercise_id, unilateral: false, primary_muscles: ['pectoraux'] },
  ...over,
});

const row = (id: string, performed_on: string, sets: WeekRow['performed_sets'], name = 'Upper A'): WeekRow => ({
  id,
  performed_on,
  created_at: `${performed_on}T10:00:00Z`,
  seance_versions: { seances: { name } },
  performed_sets: sets,
});

describe('weekRowsToBefore', () => {
  it('un exo par exécution, ses séries ensemble, les exécutions vides ignorées', () => {
    const { before, seancesBefore } = weekRowsToBefore(
      [
        row('e1', '2026-11-23', [set('dc', 1), set('dc', 2), set('rowing', 1, { exercises: { name: 'Rowing', unilateral: false, primary_muscles: ['dos'] } })]),
        row('e2', '2026-11-23', [], 'Vide'),
        row('e3', '2026-11-24', [set('dc', 1)], 'Upper B'),
      ],
      new Map(),
    );
    expect(before).toHaveLength(3);
    expect(before[0]!.sets.map((s) => s.order)).toEqual([1, 2]);
    expect(seancesBefore).toEqual([
      { name: 'Upper A', performedOn: '2026-11-23' },
      { name: 'Upper B', performedOn: '2026-11-24' },
    ]);
    const rows = weekSetsByMuscle({ before, today: [], planned: [] });
    expect(rows.find((r) => r.muscle === 'pectoraux')?.before).toBe(3);
    expect(rows.find((r) => r.muscle === 'dos')?.before).toBe(1);
  });

  it('les muscles et le drapeau unilatéral de l’utilisateur priment', () => {
    const { before } = weekRowsToBefore(
      [row('e1', '2026-11-23', [set('curl', 1, { side: 'left' }), set('curl', 1, { side: 'right' })])],
      new Map([['curl', { name: null, unilateral: true, primaryMuscles: ['biceps'] }]]),
    );
    expect(before[0]).toMatchObject({ unilateral: true, primaryMuscles: ['biceps'] });
    expect(before[0]!.sets.map((s) => s.side)).toEqual(['left', 'right']);
  });
});

describe('sundayOf', () => {
  it('le dimanche de la semaine, changement de mois compris', () => {
    expect(sundayOf('2026-11-23')).toBe('2026-11-29');
    expect(sundayOf('2026-11-30')).toBe('2026-12-06');
  });
});
