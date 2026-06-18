import { describe, it, expect } from 'vitest';
import {
  nextVersionNumber,
  nextPosition,
  rowToEditablePrescription,
  prescriptionInputToRow,
  type PrescriptionInput,
} from './data';

describe('nextVersionNumber', () => {
  it('null (aucune version) -> 1 (première version)', () => {
    expect(nextVersionNumber(null)).toBe(1);
  });

  it('max courant n -> n + 1', () => {
    expect(nextVersionNumber(1)).toBe(2);
    expect(nextVersionNumber(7)).toBe(8);
  });
});

describe('nextPosition', () => {
  it('liste vide -> 0', () => {
    expect(nextPosition([])).toBe(0);
  });

  it('reprend après le max, pas après la longueur (positions à trous)', () => {
    expect(nextPosition([0, 1, 2])).toBe(3);
    expect(nextPosition([0, 5])).toBe(6);
    expect(nextPosition([3])).toBe(4);
  });
});

describe('rowToEditablePrescription', () => {
  it('mappe une ligne jointe vers la forme éditable', () => {
    const row = {
      exercise_id: 'ex-1',
      position: 2,
      sets_min: 3,
      sets_max: 4,
      reps_min: 8,
      reps_max: 12,
      rir_min: 1,
      rir_max: 2,
      exercises: { name: 'Développé couché', muscle_group: 'pectoraux' },
    };
    expect(rowToEditablePrescription(row)).toEqual({
      exerciseId: 'ex-1',
      position: 2,
      sets: { min: 3, max: 4 },
      reps: { min: 8, max: 12 },
      rir: { min: 1, max: 2 },
      exerciseName: 'Développé couché',
      muscleGroup: 'pectoraux',
    });
  });

  it('exo joint manquant -> placeholders sûrs', () => {
    const row = {
      exercise_id: 'ex-2',
      position: 0,
      sets_min: 3,
      sets_max: 3,
      reps_min: 6,
      reps_max: 6,
      rir_min: 2,
      rir_max: 2,
      exercises: null,
    };
    const out = rowToEditablePrescription(row);
    expect(out.exerciseName).toBe('(exercice inconnu)');
    expect(out.muscleGroup).toBe('');
  });
});

describe('prescriptionInputToRow', () => {
  it('aplatit les fourchettes en colonnes et n écrit pas owner_id', () => {
    const input: PrescriptionInput = {
      exerciseId: 'ex-1',
      position: 1,
      sets: { min: 3, max: 4 },
      reps: { min: 10, max: 12 },
      rir: { min: 0, max: 1 },
    };
    const row = prescriptionInputToRow('ver-1', input);
    expect(row).toEqual({
      seance_version_id: 'ver-1',
      exercise_id: 'ex-1',
      position: 1,
      sets_min: 3,
      sets_max: 4,
      reps_min: 10,
      reps_max: 12,
      rir_min: 0,
      rir_max: 1,
    });
    expect('owner_id' in row).toBe(false);
  });
});
