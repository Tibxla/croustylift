import { describe, expect, it } from 'vitest';
import type { PerformedSet } from '../../domain/types';
import type { Session, SessionExercise } from './fixtures';
import { exoState, nextExerciseId, resumeWord, settledCount } from './salle-progress';
import type { CaptureState, ExerciseProgress } from './state';

const ex = (id: string, min = 3): SessionExercise => ({
  exerciseId: id,
  name: id,
  prescription: { sets: { min, max: min }, reps: { min: 8, max: 12 }, rir: { min: 1, max: 2 } },
  reference: null,
  perExerciseNote: '',
});
const set = (order: number, side?: 'left' | 'right'): PerformedSet => ({ order, weightKg: 50, reps: 8, rir: 1, side });
const prog = (sets: PerformedSet[], skipped = false): ExerciseProgress => ({ sets, setIds: sets.map(() => null), skipped }) as ExerciseProgress;
const session: Session = { id: 's', name: 'Upper A', exercises: [ex('a'), ex('b'), ex('c'), ex('d')] } as Session;
const stateWith = (progress: Record<string, ExerciseProgress>): CaptureState => ({ progress }) as unknown as CaptureState;

describe('exoState', () => {
  it('à faire, en cours sous le minimum, fait au minimum, passé avant tout', () => {
    expect(exoState(prog([]), 3)).toBe('todo');
    expect(exoState(prog([set(1)]), 3)).toBe('partial');
    expect(exoState(prog([set(1), set(2), set(3)]), 3)).toBe('done');
    expect(exoState(prog([set(1), set(2), set(3)], true), 3)).toBe('skipped');
  });

  it('unilatéral : gauche et droite au même rang font une série', () => {
    expect(exoState(prog([set(1, 'left'), set(1, 'right'), set(2, 'left'), set(2, 'right')]), 2)).toBe('done');
  });
});

describe('nextExerciseId', () => {
  it('le suivant dans l’ordre, en sautant les exos faits ou passés', () => {
    const state = stateWith({ b: prog([set(1), set(2), set(3)]), c: prog([], true) });
    expect(nextExerciseId(session, state, 'a')).toBe('d');
  });

  it('revient sur un exo laissé en cours avant le courant', () => {
    const state = stateWith({ a: prog([set(1)]), b: prog([set(1), set(2), set(3)]), d: prog([set(1), set(2), set(3)]) });
    expect(nextExerciseId(session, state, 'c')).toBe('a');
  });

  it('rien quand tout est réglé ; sans exo courant, le premier à faire', () => {
    const full = prog([set(1), set(2), set(3)]);
    expect(nextExerciseId(session, stateWith({ a: full, b: full, c: full, d: full }), 'a')).toBeNull();
    expect(nextExerciseId(session, stateWith({}), null)).toBe('a');
  });
});

describe('compte et reprise', () => {
  it('compte les exos faits ou passés', () => {
    expect(settledCount(session, stateWith({ a: prog([set(1), set(2), set(3)]), b: prog([], true), c: prog([set(1)]) }))).toBe(2);
  });

  it('dit où reprend un exo entamé', () => {
    expect(resumeWord(prog([]))).toBeNull();
    expect(resumeWord(prog([set(1), set(2)]))).toBe('série 3');
  });
});
