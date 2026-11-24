import { describe, it, expect } from 'vitest';
import { datedNoteOutboxOp, exerciseNoteOutboxOp, pendingDatedNoteKeys } from './data';

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
    // L'effacement porte le couple : c'est lui, pas l'id, qui désigne la note en base.
    expect(op).toEqual({
      type: 'deleteDatedNote',
      id: 'note-1',
      executionId: 'exec-1',
      exerciseId: 'bench',
    });
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

describe('pendingDatedNoteKeys', () => {
  it('rend les exos de l’exécution dont une écriture de note attend, et l’id des effacements sans couple', () => {
    const keys = pendingDatedNoteKeys(
      [
        { type: 'upsertDatedNote', id: 'n1', executionId: 'exec-1', exerciseId: 'bench', body: 'x' },
        { type: 'deleteDatedNote', id: 'n2', executionId: 'exec-1', exerciseId: 'squat' },
        // Op d'un bundle antérieur : ni exécution ni exo, seulement l'id de la note.
        { type: 'deleteDatedNote', id: 'n-ancien' },
        // Autre exécution, autre type : ignorés.
        { type: 'upsertDatedNote', id: 'n3', executionId: 'exec-2', exerciseId: 'row', body: 'y' },
        { type: 'deleteDatedNote', id: 'n4', executionId: 'exec-2', exerciseId: 'curl' },
        { type: 'upsertExerciseNote', id: 'dips', body: 'z' },
      ],
      'exec-1',
    );
    expect(keys).toEqual(['bench', 'squat', 'n-ancien']);
  });
});
