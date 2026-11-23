// PROTOTYPE JETABLE · socle E. État de l'Exécution en cours, tenu par le shell
// (il survit aux changements de surface). Lu partout par `useProto().seance`.
//
//   seance.state       exos, séries loggées, brouillons, exo affiché, phase
//   seance.log()       logge le brouillon de l'exo affiché
//   seance.undo()      retire la dernière série de l'exo affiché
//   seance.setIdx(i)   affiche l'exo i dans l'instrument
//   seance.add(id) / replace(exId, id) / skip(exId)   Déviations en salle
//   seance.start(seanceId) / close()                   début, Clôture
import { useMemo, useReducer } from 'react';
import type { ExercisePlan } from '../fixtures';
import { session as fixtureSession } from '../fixtures';
import { catalogById, planFromCatalog, routines } from './fixtures-e';
import { refAt, type SetValue } from './format';

/** Brouillon de la prochaine série, en kg (le pas de la règle est un réglage). */
export interface Draft {
  weightKg: number;
  reps: number;
  rir: number;
}

export interface SeanceState {
  /** `aucune` : pas de séance en cours (avant le choix, après la Clôture). */
  phase: 'en-cours' | 'aucune';
  routineName: string;
  seanceName: string;
  dateIso: string;
  startedAt: string;
  elapsedMin: number;
  exercises: ExercisePlan[];
  logged: Record<string, SetValue[]>;
  skipped: Record<string, boolean>;
  /** Exo affiché dans l'instrument. */
  idx: number;
  drafts: Record<string, Draft>;
  /** Exo de la dernière série loggée (pour « Annuler »), null sinon. */
  lastLog: string | null;
}

export type Progress = 'todo' | 'partial' | 'done' | 'skipped';

/** Fait = minimum de séries du plan atteint (règle de l'app réelle). */
export function progressOf(state: SeanceState, ex: ExercisePlan): Progress {
  const n = (state.logged[ex.id] ?? []).length;
  if (n === 0) return state.skipped[ex.id] ? 'skipped' : 'todo';
  return n >= ex.sets[0] ? 'done' : 'partial';
}

/** Prochain exo ni fait ni passé, dans l'ordre, après l'exo affiché puis depuis
 *  le début. null : il ne reste rien, l'action devient « Terminer la séance ». */
export function nextIndex(state: SeanceState): number | null {
  const n = state.exercises.length;
  for (let k = 1; k < n; k++) {
    const i = (state.idx + k) % n;
    const p = progressOf(state, state.exercises[i]!);
    if (p === 'todo' || p === 'partial') return i;
  }
  return null;
}

export function seedDraft(ex: ExercisePlan, logged: SetValue[]): Draft {
  const rank = logged.length + 1;
  const ref = refAt(ex, rank);
  const prev = logged[logged.length - 1];
  const base = prev ?? ref ?? ex.reference?.sets[0] ?? null;
  return {
    weightKg: prev?.weightKg ?? base?.weightKg ?? 20,
    reps: ref?.reps ?? base?.reps ?? ex.reps[0],
    rir: ref?.rir ?? base?.rir ?? ex.rir[1],
  };
}

export function draftOf(state: SeanceState, ex: ExercisePlan): Draft {
  return state.drafts[ex.id] ?? seedDraft(ex, state.logged[ex.id] ?? []);
}

/** Total de séries loggées dans l'Exécution. */
export function totalSets(state: SeanceState): number {
  return Object.values(state.logged).reduce((n, s) => n + s.length, 0);
}

function initial(): SeanceState {
  const s = fixtureSession;
  return {
    phase: 'en-cours',
    routineName: s.routineName,
    seanceName: s.seanceName,
    dateIso: s.dateIso,
    startedAt: s.startedAt,
    elapsedMin: s.elapsedMin,
    exercises: s.exercises,
    logged: Object.fromEntries(s.exercises.map((e) => [e.id, e.loggedToday.map(({ weightKg, reps, rir }) => ({ weightKg, reps, rir }))])),
    skipped: Object.fromEntries(s.exercises.filter((e) => e.status === 'skipped').map((e) => [e.id, true])),
    idx: Math.max(0, s.exercises.findIndex((e) => e.status === 'in-progress')),
    drafts: {},
    lastLog: null,
  };
}

type Action =
  | { type: 'idx'; i: number }
  | { type: 'draft'; id: string; d: Draft }
  | { type: 'log' }
  | { type: 'undo' }
  | { type: 'skip'; id: string }
  | { type: 'add'; catalogId: string }
  | { type: 'replace'; id: string; catalogId: string }
  | { type: 'start'; seanceId: string }
  | { type: 'close' };

function reducer(state: SeanceState, a: Action): SeanceState {
  switch (a.type) {
    case 'idx':
      return { ...state, idx: Math.min(state.exercises.length - 1, Math.max(0, a.i)), lastLog: null };
    case 'draft':
      return { ...state, drafts: { ...state.drafts, [a.id]: a.d } };
    case 'log': {
      const ex = state.exercises[state.idx]!;
      const sets = state.logged[ex.id] ?? [];
      const d = draftOf(state, ex);
      const next = [...sets, { ...d }];
      const ref = refAt(ex, next.length + 1);
      return {
        ...state,
        logged: { ...state.logged, [ex.id]: next },
        skipped: { ...state.skipped, [ex.id]: false },
        drafts: { ...state.drafts, [ex.id]: { weightKg: d.weightKg, reps: ref?.reps ?? d.reps, rir: ref?.rir ?? d.rir } },
        lastLog: ex.id,
      };
    }
    case 'undo': {
      const ex = state.exercises[state.idx]!;
      const sets = state.logged[ex.id] ?? [];
      const popped = sets[sets.length - 1];
      if (!popped) return state;
      return {
        ...state,
        logged: { ...state.logged, [ex.id]: sets.slice(0, -1) },
        drafts: { ...state.drafts, [ex.id]: { ...popped } },
        lastLog: null,
      };
    }
    case 'skip':
      return { ...state, skipped: { ...state.skipped, [a.id]: !state.skipped[a.id] } };
    case 'add': {
      const c = catalogById(a.catalogId);
      if (!c || state.exercises.some((e) => e.id === c.id)) return state;
      return { ...state, exercises: [...state.exercises, planFromCatalog(c)] };
    }
    case 'replace': {
      const c = catalogById(a.catalogId);
      const old = state.exercises.find((e) => e.id === a.id);
      if (!c || !old || state.exercises.some((e) => e.id === c.id)) return state;
      // Le remplaçant garde la prescription de l'exo remplacé (Déviation « exo remplacé »).
      const plan = planFromCatalog(c, { sets: old.sets, reps: old.reps, rir: old.rir });
      return { ...state, exercises: state.exercises.map((e) => (e.id === a.id ? plan : e)) };
    }
    case 'start': {
      const routine = routines.find((r) => r.seances.some((s) => s.id === a.seanceId));
      const tpl = routine?.seances.find((s) => s.id === a.seanceId);
      if (!routine || !tpl) return state;
      const exercises =
        tpl.id === 'upper-a'
          ? fixtureSession.exercises.map((e) => ({ ...e, status: 'todo' as const, loggedToday: [] }))
          : tpl.items.flatMap((it) => {
              const c = catalogById(it.exerciseId);
              return c ? [planFromCatalog(c, it)] : [];
            });
      return {
        phase: 'en-cours',
        routineName: routine.name,
        seanceName: tpl.name,
        dateIso: '2026-11-23',
        startedAt: '18:05',
        elapsedMin: 0,
        exercises,
        logged: {},
        skipped: {},
        idx: 0,
        drafts: {},
        lastLog: null,
      };
    }
    case 'close':
      return { ...state, phase: 'aucune', lastLog: null };
  }
}

export interface SeanceStore {
  state: SeanceState;
  setIdx: (i: number) => void;
  setDraft: (id: string, d: Draft) => void;
  log: () => void;
  undo: () => void;
  skip: (id: string) => void;
  add: (catalogId: string) => void;
  replace: (id: string, catalogId: string) => void;
  start: (seanceId: string) => void;
  /** Clôture : la séance rejoint le journal, la Salle revient au choix. */
  close: () => void;
}

export function useSeanceStore(): SeanceStore {
  const [state, dispatch] = useReducer(reducer, undefined, initial);
  return useMemo(
    () => ({
      state,
      setIdx: (i) => dispatch({ type: 'idx', i }),
      setDraft: (id, d) => dispatch({ type: 'draft', id, d }),
      log: () => dispatch({ type: 'log' }),
      undo: () => dispatch({ type: 'undo' }),
      skip: (id) => dispatch({ type: 'skip', id }),
      add: (catalogId) => dispatch({ type: 'add', catalogId }),
      replace: (id, catalogId) => dispatch({ type: 'replace', id, catalogId }),
      start: (seanceId) => dispatch({ type: 'start', seanceId }),
      close: () => dispatch({ type: 'close' }),
    }),
    [state],
  );
}
