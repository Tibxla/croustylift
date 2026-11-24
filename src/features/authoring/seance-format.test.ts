import { describe, expect, it } from 'vitest';
import { addedNote, exoCount, fmtCount, fmtCountRange, fmtField, muscleLabel, rowChange, seanceCount, summarizeRow } from './seance-format';
import type { EditorRow } from './prescription-edit';

const row = (rowId: string, sets: [number, number], reps: [number, number], rir: [number, number]): EditorRow => ({
  rowId,
  exerciseId: 'e',
  exerciseName: 'Développé couché',
  muscleGroup: 'pectoraux',
  primaryMuscles: ['pectoraux'],
  unilateral: false,
  sets: { mode: sets[0] === sets[1] ? 'fixe' : 'fourchette', min: sets[0], max: sets[1] },
  reps: { mode: reps[0] === reps[1] ? 'fixe' : 'fourchette', min: reps[0], max: reps[1] },
  rir: { mode: rir[0] === rir[1] ? 'fixe' : 'fourchette', min: rir[0], max: rir[1] },
});

describe('formats de la surface Séances', () => {
  it('un compte entier sans décimale, une fraction à une décimale (U30)', () => {
    expect(fmtCount(13)).toBe('13');
    expect(fmtCount(5.8)).toBe('5,8');
    expect(fmtCount(5.96)).toBe('6');
    expect(fmtCountRange({ min: 13, max: 14 })).toBe('13-14');
    expect(fmtCountRange({ min: 5.8, max: 7 })).toBe('5,8-7');
    expect(fmtCountRange({ min: 6, max: 6.02 })).toBe('6');
  });

  it('une prescription se lit « 3 × 8-12 · RIR 2 »', () => {
    expect(summarizeRow(row('a', [3, 3], [8, 12], [2, 2]))).toBe('3 × 8-12 · RIR 2');
    expect(fmtField({ mode: 'fourchette', min: 4, max: 4 })).toBe('4');
  });

  it('un muscle prend une capitale, les comptes s’accordent', () => {
    expect(muscleLabel('pectoraux')).toBe('Pectoraux');
    expect(muscleLabel('')).toBe('');
    expect(exoCount(0)).toBe('vide');
    expect(exoCount(1)).toBe('1 exo');
    expect(exoCount(4)).toBe('4 exos');
    expect(seanceCount(0)).toBe('aucune séance');
    expect(seanceCount(2)).toBe('2 séances');
  });

  it('une ligne dit si elle est ajoutée ou modifiée depuis l’enregistré', () => {
    const saved = [row('a', [3, 3], [8, 12], [2, 2])];
    expect(rowChange(saved, row('a', [3, 3], [8, 12], [2, 2]))).toBeNull();
    expect(rowChange(saved, row('a', [4, 4], [8, 12], [2, 2]))).toBe('modifié');
    expect(rowChange(saved, row('b', [3, 3], [8, 12], [2, 2]))).toBe('ajouté');
  });
});

describe('addedNote', () => {
  it('rien d’ajouté : aucune phrase', () => {
    expect(addedNote([])).toBe('');
  });
  it('un ajout : son nom', () => {
    expect(addedNote(['Crunch'])).toBe('Crunch ajouté à la séance.');
  });
  it('plusieurs : le dernier et le compte, doublons compris', () => {
    expect(addedNote(['Crunch', 'Squat', 'Squat'])).toBe('Squat ajouté · 3 exos ajoutés.');
  });
});
