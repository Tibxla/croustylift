// Tests unitaires de elapsedMinutesSince et buildSummary.
//
// Logique pure, pas de DOM. On contrôle Date.now via vi.setSystemTime pour les
// tests de durée, et on se calque sur la fixture upperA pour buildSummary.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { elapsedMinutesSince, buildSummary } from './summary';
import { captureReducer, initialState } from './state';
import { upperA, type Session } from './fixtures';
import type { CaptureState } from './state';

/** Fourchette (min, max), comme dans fixtures.ts. */
const r = (min: number, max: number): { min: number; max: number } => ({ min, max });

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

  it('upperA sans primary_muscles : setsByMuscle vide (compte au total, pas par muscle)', () => {
    let state = mkState();
    state = captureReducer(state, { type: 'log-set', exerciseId: 'bench-press', setId: 's1', set: set1 });
    expect(buildSummary(upperA, state).setsByMuscle).toEqual({});
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
    expect(s.setsByMuscle).toEqual({});
  });
});

// --- buildSummary : décompte RÉEL par muscle (issue #37) ---------------------
//
// Session ad hoc portant primaryMuscles + unilateral, pour vérifier la règle de
// décompte sur des séries loggées (le domaine pur est testé à part : ici on
// vérifie le BRANCHEMENT correct des séries de l'état et des champs d'exo).

const mono: Session = {
  id: 'mono',
  name: 'Mono',
  exercises: [
    {
      exerciseId: 'bench',
      name: 'Développé couché',
      primaryMuscles: ['pectoraux', 'triceps'],
      prescription: { sets: r(3, 4), reps: r(8, 12), rir: r(1, 2) },
      reference: null,
      perExerciseNote: '',
    },
    {
      exerciseId: 'split-squat',
      name: 'Fente bulgare',
      unilateral: true,
      primaryMuscles: ['quadriceps', 'fessiers'],
      prescription: { sets: r(3, 3), reps: r(8, 10), rir: r(1, 2) },
      reference: null,
      perExerciseNote: '',
    },
  ],
};

function monoState(): CaptureState {
  return { ...initialState(mono, '2026-06-18'), startedAt: 1_000_000 };
}

function logUni(
  state: CaptureState,
  exerciseId: string,
  setId: string,
  side: 'left' | 'right',
): CaptureState {
  return captureReducer(state, {
    type: 'log-set',
    exerciseId,
    setId,
    set: { weightKg: 30, reps: 10, rir: 2, side },
  });
}

describe('buildSummary — décompte réel par muscle (issue #37)', () => {
  it('exo bilatéral multi-muscles : +1 par muscle et au total par série', () => {
    let state = monoState();
    state = captureReducer(state, { type: 'log-set', exerciseId: 'bench', setId: 'b1', set: set1 });
    state = captureReducer(state, { type: 'log-set', exerciseId: 'bench', setId: 'b2', set: set1 });
    const s = buildSummary(mono, state);
    expect(s.totalSets).toBe(2);
    expect(s.setsByMuscle).toEqual({ pectoraux: 2, triceps: 2 });
  });

  it('exo unilatéral : G+D au même order = 1 série logique, +2 total mais +1 par muscle', () => {
    let state = monoState();
    state = logUni(state, 'split-squat', 'u1l', 'left');
    state = logUni(state, 'split-squat', 'u1r', 'right'); // série logique 1 complète
    state = logUni(state, 'split-squat', 'u2l', 'left');
    state = logUni(state, 'split-squat', 'u2r', 'right'); // série logique 2 complète
    const s = buildSummary(mono, state);
    // 2 séries logiques unilatérales : total = 2 × 2 = 4 ; muscles = 2 chacun.
    expect(s.totalSets).toBe(4);
    expect(s.setsByMuscle).toEqual({ quadriceps: 2, fessiers: 2 });
  });

  it('exo unilatéral "fait" : on compte les SÉRIES LOGIQUES (orders), pas les lignes', () => {
    // split-squat : unilatéral, prescrit min=3 séries. Deux séries logiques
    // tiennent sur QUATRE lignes : compter les lignes (4 ≥ 3) le déclarerait
    // « fait » à tort dès la 2ᵉ série. Il faut 3 séries logiques (6 lignes).
    let state = monoState();
    state = logUni(state, 'split-squat', 'u1l', 'left');
    state = logUni(state, 'split-squat', 'u1r', 'right'); // série logique 1
    state = logUni(state, 'split-squat', 'u2l', 'left');
    state = logUni(state, 'split-squat', 'u2r', 'right'); // série logique 2 (4 lignes)
    // 4 lignes mais seulement 2 séries logiques < 3 → PAS encore fait.
    expect(buildSummary(mono, state).exercisesDone).toBe(0);

    state = logUni(state, 'split-squat', 'u3l', 'left');
    state = logUni(state, 'split-squat', 'u3r', 'right'); // série logique 3 → fait
    expect(buildSummary(mono, state).exercisesDone).toBe(1);
  });

  it('mélange bilatéral + unilatéral : cumule total et muscles', () => {
    let state = monoState();
    state = captureReducer(state, { type: 'log-set', exerciseId: 'bench', setId: 'b1', set: set1 });
    state = logUni(state, 'split-squat', 'u1l', 'left');
    state = logUni(state, 'split-squat', 'u1r', 'right');
    const s = buildSummary(mono, state);
    // bench : 1 série bilatérale (total 1, pecs/triceps +1) ;
    // split-squat : 1 série unilatérale (total 2, quads/fessiers +1).
    expect(s.totalSets).toBe(3);
    expect(s.setsByMuscle).toEqual({
      pectoraux: 1,
      triceps: 1,
      quadriceps: 1,
      fessiers: 1,
    });
  });
});
