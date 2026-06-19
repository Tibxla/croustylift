import { describe, it, expect } from 'vitest';
import {
  isPersonalExercise,
  toListExercise,
  filterExercises,
  type ListExercise,
} from './exercises-list';

// Un exo réduit à ce que la liste manipule. owner_id null = exo de base.
function make(
  id: string,
  name: string,
  ownerId: string | null,
  muscles: string[] = ['pectoraux'],
  unilateral = false,
): ListExercise {
  return {
    id,
    name,
    ownerId,
    muscleGroup: muscles[0] ?? '',
    primaryMuscles: muscles,
    unilateral,
  };
}

describe('isPersonalExercise', () => {
  it('owner_id non nul -> exo perso', () => {
    expect(isPersonalExercise('user-123')).toBe(true);
  });

  it('owner_id null -> exo de base', () => {
    expect(isPersonalExercise(null)).toBe(false);
  });
});

describe('toListExercise', () => {
  it('mappe une row exercises vers la forme liste', () => {
    expect(
      toListExercise({
        id: 'ex-1',
        name: 'Développé couché',
        owner_id: null,
        muscle_group: 'pectoraux',
        primary_muscles: ['pectoraux', 'triceps'],
        unilateral: false,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      }),
    ).toEqual({
      id: 'ex-1',
      name: 'Développé couché',
      ownerId: null,
      muscleGroup: 'pectoraux',
      primaryMuscles: ['pectoraux', 'triceps'],
      unilateral: false,
    });
  });

  it('replis sûrs : primary_muscles null -> [], unilateral null -> false', () => {
    const out = toListExercise({
      id: 'ex-2',
      name: 'Vieux exo',
      owner_id: 'u1',
      muscle_group: 'biceps',
      // colonnes legacy potentiellement nulles
      primary_muscles: null as unknown as string[],
      unilateral: null as unknown as boolean,
      created_at: '',
      updated_at: '',
    });
    expect(out.primaryMuscles).toEqual([]);
    expect(out.unilateral).toBe(false);
  });
});

describe('filterExercises', () => {
  const catalogue: ListExercise[] = [
    make('b1', 'Développé couché', null, ['pectoraux']),
    make('b2', 'Squat', null, ['quadriceps', 'fessiers']),
    make('p1', 'Curl marteau', 'u1', ['brachioradial'], true),
    make('p2', 'Développé incliné', 'u1', ['pectoraux']),
  ];

  it('sans requête : sépare base et perso, chaque groupe trié par nom (fr)', () => {
    const { base, personal } = filterExercises(catalogue, '');
    // Base : Développé couché < Squat. Perso : Curl marteau < Développé incliné.
    expect(base.map((e) => e.id)).toEqual(['b1', 'b2']);
    expect(personal.map((e) => e.id)).toEqual(['p1', 'p2']);
  });

  it('tri alphabétique français, insensible à la casse', () => {
    const list: ListExercise[] = [
      make('x', 'Zercher', null),
      make('y', 'arnold press', null),
      make('z', 'Élévation', null),
    ];
    const { base } = filterExercises(list, '');
    expect(base.map((e) => e.name)).toEqual(['arnold press', 'Élévation', 'Zercher']);
  });

  it('recherche par nom, insensible à la casse et aux espaces de bord', () => {
    const { base, personal } = filterExercises(catalogue, '  DÉVELOPPÉ  ');
    expect(base.map((e) => e.id)).toEqual(['b1']);
    expect(personal.map((e) => e.id)).toEqual(['p2']);
  });

  it('recherche sans correspondance -> groupes vides', () => {
    const { base, personal } = filterExercises(catalogue, 'tractions');
    expect(base).toEqual([]);
    expect(personal).toEqual([]);
  });
});
