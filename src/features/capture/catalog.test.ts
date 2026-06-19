// Mapping catalogue -> SessionExercise pour l'ajout/swap à la volée (issue #36).
import { describe, it, expect } from 'vitest';
import { catalogExerciseToSession, DEFAULT_ADDED_PRESCRIPTION } from './data';

describe('catalogExerciseToSession', () => {
  it('reprend l’id et le nom du catalogue', () => {
    const ex = catalogExerciseToSession({ id: 'dip', name: 'Dips' });
    expect(ex.exerciseId).toBe('dip');
    expect(ex.name).toBe('Dips');
  });

  it('applique la cible par défaut des ajouts (pas de prescription versionnée)', () => {
    const ex = catalogExerciseToSession({ id: 'dip', name: 'Dips' });
    expect(ex.prescription).toEqual(DEFAULT_ADDED_PRESCRIPTION);
  });

  it('laisse référence et records à null (remplis ensuite depuis l’historique)', () => {
    const ex = catalogExerciseToSession({ id: 'dip', name: 'Dips' });
    expect(ex.reference).toBeNull();
    expect(ex.personalRecord).toBeNull();
    expect(ex.perExerciseNote).toBe('');
  });

  it('transporte unilateral + muscles principaux (décompte des séries, issue #37)', () => {
    const ex = catalogExerciseToSession({
      id: 'split-squat',
      name: 'Fente bulgare',
      unilateral: true,
      primary_muscles: ['quadriceps', 'fessiers'],
    });
    expect(ex.unilateral).toBe(true);
    expect(ex.primaryMuscles).toEqual(['quadriceps', 'fessiers']);
  });

  it('replis sûrs quand l’exo n’a pas ces champs : bilatéral, aucun muscle', () => {
    const ex = catalogExerciseToSession({ id: 'dip', name: 'Dips' });
    expect(ex.unilateral).toBe(false);
    expect(ex.primaryMuscles).toEqual([]);
  });

  it('ne partage pas les fourchettes par référence (copie défensive)', () => {
    const a = catalogExerciseToSession({ id: 'a', name: 'A' });
    const b = catalogExerciseToSession({ id: 'b', name: 'B' });
    a.prescription.sets.min = 99;
    expect(b.prescription.sets.min).toBe(DEFAULT_ADDED_PRESCRIPTION.sets.min);
  });
});
