// Décomptes de fin de séance sur des séries loggées par le réducteur : état de
// chaque exo (fait, passé) et séries par muscle. Reportés de l'ancien récap
// (`buildSummary`) sur le récap actuel (`buildSessionRecap`) et sur l'entrée du
// décompte par muscle (`performedToday`, puis `countPerformedSets` et
// `setsByMuscle`). Le domaine pur est testé à part (set-count.test.ts) : ici
// on vérifie le BRANCHEMENT des séries de l'état et des champs d'exo.
import { describe, expect, it } from 'vitest';
import { countPerformedSets } from '../../domain/set-count';
import type { PerformedSet } from '../../domain/types';
import { upperA, type Session } from './fixtures';
import { buildSessionRecap, performedToday, setsByMuscle } from './session-recap';
import { captureReducer, initialState, type CaptureState } from './state';

const r = (min: number, max: number) => ({ min, max });
const set1: Omit<PerformedSet, 'order'> = { weightKg: 80, reps: 8, rir: 2 };

function mkState(session: Session = upperA): CaptureState {
  return { ...initialState(session, '2026-06-18'), startedAt: 1_000_000 };
}

function log(state: CaptureState, exerciseId: string, setId: string, set = set1): CaptureState {
  return captureReducer(state, { type: 'log-set', exerciseId, setId, set });
}

/** Les séries du jour par muscle, telles que les lit la fin de séance. */
function todayByMuscle(session: Session, state: CaptureState): Record<string, number> {
  const rows = setsByMuscle({ done: performedToday(session, state), planned: [] });
  return Object.fromEntries(rows.map((row) => [row.muscle, row.done]));
}

const totalToday = (session: Session, state: CaptureState) => countPerformedSets(performedToday(session, state)).total;

describe('fin de séance : état des exos (ancien `buildSummary`)', () => {
  it('un exo est « fait » dès que le minimum de séries est atteint : pas fait, en cours, fait', () => {
    // bench-press : min = 3 séries.
    const bench = (s: CaptureState) => buildSessionRecap(upperA, s).exercises[0]!.status;
    let state = mkState();
    expect(bench(state)).toBe('pas-fait');

    state = log(state, 'bench-press', 's1');
    expect(bench(state)).toBe('en-cours');
    state = log(state, 'bench-press', 's2');
    expect(bench(state)).toBe('en-cours');
    expect(buildSessionRecap(upperA, state).counts.fait).toBe(0);

    state = log(state, 'bench-press', 's3');
    expect(bench(state)).toBe('fait');
    expect(buildSessionRecap(upperA, state).counts.fait).toBe(1);
  });

  it('le nom de la séance, et un exo passé avant toute série compté à part', () => {
    const state = captureReducer(mkState(), { type: 'skip-exercise', exerciseId: 'bench-press' });
    const recap = buildSessionRecap(upperA, state);
    expect(recap.sessionName).toBe('Upper A');
    expect(recap.counts).toEqual({ fait: 0, 'en-cours': 0, passe: 1, 'pas-fait': upperA.exercises.length - 1 });
  });

  it('un exo passé après avoir atteint son minimum reste compté passé, pas fait', () => {
    let state = mkState();
    for (const setId of ['s1', 's2', 's3']) state = log(state, 'bench-press', setId);
    state = captureReducer(state, { type: 'skip-exercise', exerciseId: 'bench-press' });
    const recap = buildSessionRecap(upperA, state);
    expect(recap.counts).toMatchObject({ fait: 0, passe: 1 });
    expect(recap.exercises[0]).toMatchObject({ status: 'passe', setsDone: 3 });
  });

  it('tous les exos au minimum : autant d’exos faits que d’exos dans la séance', () => {
    let state = mkState();
    for (const ex of upperA.exercises) {
      for (let i = 0; i < ex.prescription.sets.min; i++) state = log(state, ex.exerciseId, `${ex.exerciseId}-s${i}`);
    }
    const recap = buildSessionRecap(upperA, state);
    expect(recap.exercises).toHaveLength(upperA.exercises.length);
    expect(recap.counts.fait).toBe(upperA.exercises.length);
  });

  it('séance sans exercices : état dégénéré propre, tout à zéro', () => {
    const empty: Session = { id: 'empty', name: 'Vide', exercises: [] };
    const recap = buildSessionRecap(empty, mkState(empty));
    expect(recap.exercises).toEqual([]);
    expect(recap.counts).toEqual({ fait: 0, 'en-cours': 0, passe: 0, 'pas-fait': 0 });
    expect(recap).toMatchObject({ setsLogged: 0, beaten: 0, liftedKg: 0, records: [] });
    expect(performedToday(empty, mkState(empty))).toEqual([]);
  });

  it('le total pondéré compte toutes les séries de tous les exercices', () => {
    let state = log(log(mkState(), 'bench-press', 's1'), 'bench-press', 's2');
    state = log(state, 'seated-row', 's3');
    expect(totalToday(upperA, state)).toBe(3);
  });

  it('exos sans muscles principaux : comptés au total, sur aucun muscle', () => {
    const state = log(mkState(), 'bench-press', 's1');
    expect(totalToday(upperA, state)).toBe(1);
    expect(todayByMuscle(upperA, state)).toEqual({});
  });
});

// Séance portant muscles principaux et unilatéral, pour la règle de décompte
// sur des séries loggées (issue #37).
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

function logUni(state: CaptureState, setId: string, side: 'left' | 'right'): CaptureState {
  return log(state, 'split-squat', setId, { weightKg: 30, reps: 10, rir: 2, side });
}

describe('fin de séance : séries du jour par muscle (issue #37)', () => {
  it('exo bilatéral multi-muscles : +1 par muscle et au total par série', () => {
    const state = log(log(mkState(mono), 'bench', 'b1'), 'bench', 'b2');
    expect(totalToday(mono, state)).toBe(2);
    expect(todayByMuscle(mono, state)).toEqual({ pectoraux: 2, triceps: 2 });
  });

  it('exo unilatéral : G+D au même rang = 1 série logique, +2 au total mais +1 par muscle', () => {
    let state = mkState(mono);
    state = logUni(state, 'u1l', 'left');
    state = logUni(state, 'u1r', 'right');
    state = logUni(state, 'u2l', 'left');
    state = logUni(state, 'u2r', 'right');
    expect(totalToday(mono, state)).toBe(4);
    expect(todayByMuscle(mono, state)).toEqual({ quadriceps: 2, fessiers: 2 });
  });

  it('exo unilatéral « fait » : on compte les SÉRIES LOGIQUES (rangs), pas les lignes', () => {
    // Prescrit min = 3. Deux séries logiques tiennent sur quatre lignes :
    // compter les lignes (4 ≥ 3) le déclarerait « fait » dès la 2ᵉ série.
    let state = mkState(mono);
    state = logUni(state, 'u1l', 'left');
    state = logUni(state, 'u1r', 'right');
    state = logUni(state, 'u2l', 'left');
    state = logUni(state, 'u2r', 'right');
    const split = (s: CaptureState) => buildSessionRecap(mono, s).exercises[1]!;
    expect(split(state)).toMatchObject({ status: 'en-cours', setsDone: 2 });

    state = logUni(state, 'u3l', 'left');
    state = logUni(state, 'u3r', 'right');
    expect(split(state)).toMatchObject({ status: 'fait', setsDone: 3 });
  });

  it('mélange bilatéral + unilatéral : cumule total et muscles', () => {
    let state = log(mkState(mono), 'bench', 'b1');
    state = logUni(state, 'u1l', 'left');
    state = logUni(state, 'u1r', 'right');
    // bench : 1 série bilatérale (total 1) ; split-squat : 1 série unilatérale (total 2).
    expect(totalToday(mono, state)).toBe(3);
    expect(todayByMuscle(mono, state)).toEqual({ pectoraux: 1, triceps: 1, quadriceps: 1, fessiers: 1 });
  });
});
