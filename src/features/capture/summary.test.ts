// Tests unitaires de elapsedMinutesSince et buildSummary.
//
// Logique pure, pas de DOM. On contrôle Date.now via vi.setSystemTime pour les
// tests de durée, et on se calque sur la fixture upperA pour buildSummary.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { elapsedMinutesSince, buildSummary } from './summary';
import { captureReducer, initialState } from './state';
import { upperA } from './fixtures';
import type { CaptureState } from './state';

// --- Fabriques ---------------------------------------------------------------

function mkState(overrides?: Partial<CaptureState>): CaptureState {
  return {
    ...initialState(upperA, '2026-06-18'),
    startedAt: 1_000_000,
    ...overrides,
  };
}

const set1 = { weightKg: 80, reps: 8, rir: 2 };

// --- elapsedMinutesSince -----------------------------------------------------

describe('elapsedMinutesSince', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('retourne le nombre de minutes écoulées (arrondi)', () => {
    vi.setSystemTime(1_000_000 + 60_000 * 45); // +45 min exactement
    expect(elapsedMinutesSince(1_000_000)).toBe(45);
  });

  it('arrondit au plus proche : 30 secondes de plus -> +1 min', () => {
    vi.setSystemTime(1_000_000 + 60_000 * 3 + 30_000); // 3 min 30 s
    expect(elapsedMinutesSince(1_000_000)).toBe(4);
  });

  it('arrondit au plus proche : 29 secondes de plus -> même minute', () => {
    vi.setSystemTime(1_000_000 + 60_000 * 3 + 29_000); // 3 min 29 s
    expect(elapsedMinutesSince(1_000_000)).toBe(3);
  });

  it('retourne 0 si lancé juste maintenant (delta < 30 s)', () => {
    vi.setSystemTime(1_000_000 + 10_000); // +10 s
    expect(elapsedMinutesSince(1_000_000)).toBe(0);
  });

  it('cas dégénéré : undefined -> null (pas de durée)', () => {
    expect(elapsedMinutesSince(undefined)).toBeNull();
  });

  it('cas dégénéré : NaN -> null', () => {
    expect(elapsedMinutesSince(NaN)).toBeNull();
  });

  it('cas dégénéré : Infinity -> null', () => {
    expect(elapsedMinutesSince(Infinity)).toBeNull();
  });

  it('cas dégénéré : -Infinity -> null', () => {
    expect(elapsedMinutesSince(-Infinity)).toBeNull();
  });

  it('durée négative (startedAt dans le futur) -> valeur négative arrondie, pas null', () => {
    // On ne bloque pas le cas dégénéré durée<0 : la valeur est transmise telle
    // quelle (cas rarissime : horloge avancée puis corrigée). Le composant l'affiche.
    vi.setSystemTime(1_000_000 - 60_000); // -1 min
    expect(elapsedMinutesSince(1_000_000)).toBe(-1);
  });
});

// --- buildSummary ------------------------------------------------------------

describe('buildSummary', () => {
  it('état vide : 0 exos faits, 0 séries', () => {
    const state = mkState();
    const s = buildSummary(upperA, state);
    expect(s.sessionName).toBe('Upper A');
    expect(s.exercisesDone).toBe(0);
    expect(s.exercisesTotal).toBe(upperA.exercises.length); // 4
    expect(s.totalSets).toBe(0);
  });

  it('compte un exo comme "fait" dès que le min de séries est atteint', () => {
    // bench-press : min=3 séries
    let state = mkState();
    state = captureReducer(state, { type: 'log-set', exerciseId: 'bench-press', setId: 's1', set: set1 });
    state = captureReducer(state, { type: 'log-set', exerciseId: 'bench-press', setId: 's2', set: set1 });

    // Pas encore "fait" (2/3)
    expect(buildSummary(upperA, state).exercisesDone).toBe(0);

    state = captureReducer(state, { type: 'log-set', exerciseId: 'bench-press', setId: 's3', set: set1 });
    // Maintenant "fait" (3/3)
    expect(buildSummary(upperA, state).exercisesDone).toBe(1);
  });

  it('un exo passé (skipped) compte comme "fait"', () => {
    const state = captureReducer(mkState(), { type: 'skip-exercise', exerciseId: 'bench-press' });
    expect(buildSummary(upperA, state).exercisesDone).toBe(1);
  });

  it('totalSets compte toutes les séries de tous les exercices', () => {
    let state = mkState();
    state = captureReducer(state, { type: 'log-set', exerciseId: 'bench-press', setId: 's1', set: set1 });
    state = captureReducer(state, { type: 'log-set', exerciseId: 'bench-press', setId: 's2', set: set1 });
    state = captureReducer(state, { type: 'log-set', exerciseId: 'seated-row', setId: 's3', set: set1 });
    expect(buildSummary(upperA, state).totalSets).toBe(3);
  });

  it('exercisesTotal vaut le nombre d\'exercices de la séance', () => {
    const state = mkState();
    expect(buildSummary(upperA, state).exercisesTotal).toBe(4);
  });

  it('tous les exos faits : exercisesDone === exercisesTotal', () => {
    // On logue le min de séries pour chaque exo
    let state = mkState();
    for (const ex of upperA.exercises) {
      const min = ex.prescription.sets.min;
      for (let i = 0; i < min; i++) {
        state = captureReducer(state, {
          type: 'log-set',
          exerciseId: ex.exerciseId,
          setId: `${ex.exerciseId}-s${i}`,
          set: set1,
        });
      }
    }
    const s = buildSummary(upperA, state);
    expect(s.exercisesDone).toBe(s.exercisesTotal);
  });

  it('séance sans exercices : état dégénéré propre (0/0, 0 séries)', () => {
    const emptySession = { id: 'empty', name: 'Vide', exercises: [] };
    const state: CaptureState = {
      sessionId: 'empty',
      executionId: 'exec-0',
      date: '2026-06-18',
      startedAt: 1_000_000,
      activeExerciseId: null,
      progress: {},
      datedNotes: {},
      closedAt: null,
    };
    const s = buildSummary(emptySession, state);
    expect(s.exercisesDone).toBe(0);
    expect(s.exercisesTotal).toBe(0);
    expect(s.totalSets).toBe(0);
  });
});
