import { describe, it, expect } from 'vitest';
import {
  MUSCLE_GROUPS,
  isMuscleGroup,
  toggleMuscle,
  validatePersonalExercise,
  buildPersonalExerciseInsert,
} from './exercise-input';

describe('MUSCLE_GROUPS', () => {
  it('liste les 15 muscles canoniques (cf. CONTEXT.md)', () => {
    expect(MUSCLE_GROUPS).toHaveLength(15);
    // bornes du vocabulaire : « dos » n'est PAS un muscle -> « dorsaux »
    expect(MUSCLE_GROUPS).toContain('dorsaux');
    expect(MUSCLE_GROUPS).not.toContain('dos');
    expect(MUSCLE_GROUPS).toContain('avant épaule');
    expect(MUSCLE_GROUPS).toContain('brachioradial');
  });
});

describe('isMuscleGroup', () => {
  it('reconnaît un muscle canonique', () => {
    expect(isMuscleGroup('pectoraux')).toBe(true);
    expect(isMuscleGroup('ischio-jambiers')).toBe(true);
  });

  it('rejette un terme hors vocabulaire', () => {
    expect(isMuscleGroup('dos')).toBe(false);
    expect(isMuscleGroup('épaules')).toBe(false);
    expect(isMuscleGroup('')).toBe(false);
  });
});

describe('toggleMuscle', () => {
  it('ajoute un muscle absent en conservant l ordre canonique', () => {
    // on ajoute biceps (index 6) à une sélection contenant déjà triceps (index 7)
    expect(toggleMuscle(['triceps'], 'biceps')).toEqual(['biceps', 'triceps']);
  });

  it('retire un muscle déjà présent', () => {
    expect(toggleMuscle(['pectoraux', 'triceps'], 'pectoraux')).toEqual(['triceps']);
  });

  it('garde toujours l ordre canonique quel que soit l ordre d ajout', () => {
    let sel: string[] = [];
    sel = toggleMuscle(sel, 'mollets'); // dernier
    sel = toggleMuscle(sel, 'pectoraux'); // premier
    sel = toggleMuscle(sel, 'biceps'); // milieu
    expect(sel).toEqual(['pectoraux', 'biceps', 'mollets']);
  });

  it('ne fait rien (renvoie la liste triée) pour un terme hors vocabulaire', () => {
    expect(toggleMuscle(['pectoraux'], 'dos')).toEqual(['pectoraux']);
  });

  it('ne mute pas la sélection en entrée', () => {
    const input = ['triceps'];
    toggleMuscle(input, 'biceps');
    expect(input).toEqual(['triceps']);
  });
});

describe('validatePersonalExercise', () => {
  it('valide un exo avec nom et >= 1 muscle', () => {
    expect(
      validatePersonalExercise({ name: 'Développé couché', primaryMuscles: ['pectoraux'] }),
    ).toBeNull();
  });

  it('refuse un nom vide ou en blancs', () => {
    expect(validatePersonalExercise({ name: '   ', primaryMuscles: ['pectoraux'] })).toMatch(
      /nom/i,
    );
  });

  it('refuse zéro muscle principal', () => {
    expect(validatePersonalExercise({ name: 'Test', primaryMuscles: [] })).toMatch(/muscle/i);
  });
});

describe('buildPersonalExerciseInsert', () => {
  it('produit la row d insert : muscle_group = premier muscle, primary_muscles, unilateral', () => {
    expect(
      buildPersonalExerciseInsert({
        name: '  Tirage horizontal  ',
        primaryMuscles: ['trapèzes', 'dorsaux'],
        unilateral: true,
      }),
    ).toEqual({
      name: 'Tirage horizontal',
      muscle_group: 'trapèzes',
      primary_muscles: ['trapèzes', 'dorsaux'],
      unilateral: true,
    });
  });

  it('défaut unilateral = false', () => {
    const row = buildPersonalExerciseInsert({
      name: 'Curl',
      primaryMuscles: ['biceps'],
    });
    expect(row.unilateral).toBe(false);
  });

  it('dédoublonne les muscles et garde l ordre canonique', () => {
    const row = buildPersonalExerciseInsert({
      name: 'Squat',
      primaryMuscles: ['quadriceps', 'fessiers', 'quadriceps'],
    });
    expect(row.primary_muscles).toEqual(['quadriceps', 'fessiers']);
    expect(row.muscle_group).toBe('quadriceps');
  });

  it('n écrit pas owner_id (rempli par default auth.uid())', () => {
    const row = buildPersonalExerciseInsert({ name: 'X', primaryMuscles: ['biceps'] });
    expect('owner_id' in row).toBe(false);
  });

  it('jette si aucun muscle principal valide', () => {
    expect(() => buildPersonalExerciseInsert({ name: 'X', primaryMuscles: [] })).toThrow();
    expect(() => buildPersonalExerciseInsert({ name: 'X', primaryMuscles: ['dos'] })).toThrow();
  });

  it('jette si le nom est vide', () => {
    expect(() =>
      buildPersonalExerciseInsert({ name: '  ', primaryMuscles: ['biceps'] }),
    ).toThrow();
  });
});
