import { describe, it, expect } from 'vitest';
import { datedNoteOutboxOp, exerciseNoteOutboxOp } from './data';

describe('datedNoteOutboxOp', () => {
  it('corps non vide -> op upsertDatedNote avec le corps NORMALISÉ', () => {
    const op = datedNoteOutboxOp({
      id: 'note-1',
      executionId: 'exec-1',
      exerciseId: 'bench',
      body: '  dos un peu raide  ',
    });
    expect(op).toEqual({
      type: 'upsertDatedNote',
      id: 'note-1',
      executionId: 'exec-1',
      exerciseId: 'bench',
      body: 'dos un peu raide',
    });
  });

  it('corps vide ou blanc -> op deleteDatedNote (efface la note)', () => {
    const op = datedNoteOutboxOp({
      id: 'note-1',
      executionId: 'exec-1',
      exerciseId: 'bench',
      body: '   ',
    });
    expect(op).toEqual({ type: 'deleteDatedNote', id: 'note-1' });
  });
});

describe('exerciseNoteOutboxOp', () => {
  it('corps non vide -> op upsertExerciseNote (id = exerciseId) avec le corps NORMALISÉ', () => {
    const op = exerciseNoteOutboxOp({
      exerciseId: 'bench',
      body: '  coudes rentrés  ',
    });
    // La clé idempotente est l'exerciseId (singleton par user+exo), pas un UUID
    // de ligne client : pas d'executionId, l'op ne porte que id + body normalisé.
    expect(op).toEqual({
      type: 'upsertExerciseNote',
      id: 'bench',
      body: 'coudes rentrés',
    });
  });

  it('corps vide ou blanc -> op deleteExerciseNote (efface la note)', () => {
    const op = exerciseNoteOutboxOp({
      exerciseId: 'bench',
      body: '   ',
    });
    expect(op).toEqual({ type: 'deleteExerciseNote', id: 'bench' });
  });
});
