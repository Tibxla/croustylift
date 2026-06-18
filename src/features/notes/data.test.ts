import { describe, it, expect } from 'vitest';
import { datedNoteOutboxOp } from './data';

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
