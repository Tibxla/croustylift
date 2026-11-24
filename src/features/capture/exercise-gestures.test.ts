// Gestes sur les EXOS de la séance en cours. Ici : remettre un exo passé.
import { beforeEach, describe, expect, it } from 'vitest';
import { upperA } from './fixtures';
import { replaceExercise, restoreSkippedExercise } from './exercise-gestures';
import { deriveExerciseDeviations, layoutEditOf, replayLayout, templateExerciseIds } from './session-edit';
import type { SessionExercise } from './fixtures';
import {
  applyQueuedSets,
  captureReducer,
  getProgress,
  initialState,
  isPristine,
  loadPersisted,
  persist,
  type CaptureState,
} from './state';
import { buildSummary } from './summary';
import { buildSessionRecap } from './session-recap';

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(k: string): string | null {
    return this.store.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.store.set(k, String(v));
  }
  removeItem(k: string): void {
    this.store.delete(k);
  }
  get length(): number {
    return this.store.size;
  }
  key(i: number): string | null {
    return [...this.store.keys()][i] ?? null;
  }
}

const DATE = '2026-11-25';
const BENCH = 'bench-press';
const fresh = (): CaptureState => ({ ...initialState(upperA, DATE), executionId: 'exec-1' });
const skipped = (state = fresh()) => captureReducer(state, { type: 'skip-exercise', exerciseId: BENCH });
const set = (order: number) => ({ weightKg: 80, reps: 8, rir: 2, order });

beforeEach(() => {
  (globalThis as unknown as { localStorage: Storage }).localStorage = new MemoryStorage() as unknown as Storage;
});

describe('restoreSkippedExercise (« Remettre » un exo passé)', () => {
  it('lève le « passé », sans aucune écriture : l’état « passé » ne vit que sur l’appareil', () => {
    const state = skipped();
    const gesture = restoreSkippedExercise(state, BENCH);
    expect(gesture).toEqual({ action: { type: 'unskip-exercise', exerciseId: BENCH }, ops: [] });
    expect(getProgress(captureReducer(state, gesture!.action), BENCH).skipped).toBe(false);
  });

  it('rien à faire sur un exo qui n’est pas passé', () => {
    expect(restoreSkippedExercise(fresh(), BENCH)).toBeNull();
    expect(restoreSkippedExercise(fresh(), 'inconnu')).toBeNull();
  });

  it('les séries faites avant de passer l’exo sont toujours là, et l’exo redevient « en cours »', () => {
    let state = captureReducer(fresh(), {
      type: 'log-set',
      exerciseId: BENCH,
      setId: 's1',
      set: { weightKg: 80, reps: 8, rir: 2 },
    });
    state = skipped(state);
    expect(buildSummary(upperA, state).exercisesSkipped).toBe(1);
    state = captureReducer(state, restoreSkippedExercise(state, BENCH)!.action);
    expect(getProgress(state, BENCH).sets).toHaveLength(1);
    expect(buildSummary(upperA, state).exercisesSkipped).toBe(0);
  });

  it('passé puis remis sans rien saisir : le tableau est de nouveau intact', () => {
    const state = skipped();
    expect(isPristine(state)).toBe(false);
    expect(isPristine(captureReducer(state, restoreSkippedExercise(state, BENCH)!.action))).toBe(true);
  });

  it('« passé » et « remis » survivent au rechargement', () => {
    persist(skipped());
    const reloaded = loadPersisted(upperA, DATE)!;
    expect(getProgress(reloaded, BENCH).skipped).toBe(true);
    persist(captureReducer(reloaded, restoreSkippedExercise(reloaded, BENCH)!.action));
    expect(getProgress(loadPersisted(upperA, DATE)!, BENCH).skipped).toBe(false);
  });

  it('une réponse tardive de la base ne remet pas « passé » un exo remis, ni l’inverse', () => {
    const base = { [BENCH]: { sets: [set(1)], setIds: ['s1'] } };
    const late = { type: 'reconcile-progress' as const, base, pendingSetIds: [], knownAtDeparture: [] };
    // Passé localement : il le reste, avec la série arrivée de la base.
    const stillSkipped = captureReducer(skipped(), late);
    expect(getProgress(stillSkipped, BENCH)).toMatchObject({ skipped: true, setIds: ['s1'] });
    // Remis localement : la base (qui ne connaît pas « passé ») ne le repasse pas.
    const restored = captureReducer(skipped(), restoreSkippedExercise(skipped(), BENCH)!.action);
    expect(getProgress(captureReducer(restored, late), BENCH).skipped).toBe(false);
    // Passé, sans série nulle part : la marque tient quand même.
    expect(getProgress(captureReducer(skipped(), { ...late, base: {} }), BENCH).skipped).toBe(true);
  });

  it('les écritures de séries en file rejouées gardent la marque « passé »', () => {
    const progress = applyQueuedSets(
      skipped().progress,
      [{ type: 'insertSet', id: 's1', executionId: 'exec-1', exerciseId: BENCH, setOrder: 1, weightKg: 80, reps: 8, rir: 2 }],
      'exec-1',
    );
    expect(progress[BENCH]).toMatchObject({ skipped: true, setIds: ['s1'] });
  });

  it('logger une série sur un exo passé le remet de lui-même', () => {
    const state = captureReducer(skipped(), {
      type: 'log-set',
      exerciseId: BENCH,
      setId: 's1',
      set: { weightKg: 80, reps: 8, rir: 2 },
    });
    expect(getProgress(state, BENCH).skipped).toBe(false);
    expect(restoreSkippedExercise(state, BENCH)).toBeNull();
  });
});

// Machine prise en cours d'exo : on remplace un exo DÉJÀ commencé. Avant, le
// remplaçant prenait sa place et ses séries disparaissaient de l'écran (elles
// restaient en base, invisibles) ; le geste n'était d'ailleurs proposé que sur
// un exo sans série.
describe('replaceExercise', () => {
  const ids = (session: { exercises: SessionExercise[] }) => session.exercises.map((e) => e.exerciseId);
  const first = upperA.exercises[0]!;
  const second = upperA.exercises[1]!;
  const machine: SessionExercise = { ...first, exerciseId: 'chest-machine', name: 'Développé machine' };
  const logged = (): CaptureState =>
    captureReducer(fresh(), { type: 'log-set', exerciseId: first.exerciseId, setId: 's1', set: { weightKg: 80, reps: 8, rir: 2 } });

  it('exo pas commencé : le remplaçant prend sa place, comme avant', () => {
    const gesture = replaceExercise(fresh(), upperA, first.exerciseId, machine)!;
    expect(ids(gesture.session)).toEqual(['chest-machine', ...ids(upperA).slice(1)]);
    expect(gesture.session.exercises[0]).toMatchObject({ origin: 'swapped', swappedFrom: first.exerciseId });
    expect(gesture.action).toEqual({
      type: 'edit-layout',
      edit: expect.objectContaining({ kind: 'swapped', exerciseId: 'chest-machine', replaces: first.exerciseId }),
    });
    expect(gesture.action).not.toHaveProperty('edit.keepsReplaced');
    expect(gesture.ops).toEqual([]);
  });

  it('exo commencé : il reste à sa place avec ses séries, le remplaçant s’insère juste après, marqué « remplacé »', () => {
    const state = logged();
    const gesture = replaceExercise(state, upperA, first.exerciseId, machine)!;
    expect(ids(gesture.session)).toEqual([first.exerciseId, 'chest-machine', ...ids(upperA).slice(1)]);
    expect(gesture.session.exercises[0]).toBe(first);
    expect(gesture.session.exercises[1]).toMatchObject({ origin: 'swapped', swappedFrom: first.exerciseId });
    // Ses séries ne bougent pas : aucune écriture, il reste « en cours ».
    const next = captureReducer(state, gesture.action);
    expect(getProgress(next, first.exerciseId).sets).toHaveLength(1);
    expect(gesture.ops).toEqual([]);
    expect(buildSummary(gesture.session, next)).toMatchObject({ exercisesTotal: upperA.exercises.length + 1, exercisesDone: 0 });
  });

  it.each(['base', 'file'])('série du Journal arrivée après le remplacement (%s) : l’exo et ses kg reviennent et restent au rechargement', (source) => {
    const before = fresh();
    const gesture = replaceExercise(before, upperA, BENCH, machine)!;
    const swapped = captureReducer(before, gesture.action);
    const next = captureReducer(swapped, {
      type: 'reconcile-progress',
      knownAtDeparture: [],
      pendingSetIds: [],
      base: source === 'base' ? { [BENCH]: { sets: [set(1)], setIds: ['journal'] } } : {},
      queuedOps: source === 'file' ? [{
        type: 'insertSet', id: 'journal', exerciseId: BENCH, executionId: before.executionId,
        setOrder: 1, weightKg: 80, reps: 8, rir: 2,
      }] : [],
    });
    persist(next);
    for (const state of [next, loadPersisted(upperA, DATE)!]) {
      const session = replayLayout(upperA, state.layout!, () => machine);
      expect(ids(session)).toEqual([BENCH, machine.exerciseId, ...ids(upperA).slice(1)]);
      expect(session.exercises[1]).toMatchObject({ origin: 'swapped', swappedFrom: BENCH });
      expect(buildSessionRecap(session, state)).toMatchObject({ setsLogged: 1, liftedKg: 640 });
      expect(state.layout![0]?.keepsReplaced).toBe(true);
    }
  });

  it('l’exo affiché était celui qu’on remplace : l’instrument passe au remplaçant', () => {
    const shown = captureReducer(logged(), { type: 'open-exercise', exerciseId: first.exerciseId });
    expect(replaceExercise(shown, upperA, first.exerciseId, machine)!.openExerciseId).toBe('chest-machine');
    const elsewhere = captureReducer(logged(), { type: 'open-exercise', exerciseId: second.exerciseId });
    expect(replaceExercise(elsewhere, upperA, first.exerciseId, machine)!.openExerciseId).toBeNull();
  });

  it('une série du Journal sur un exo déjà réajouté le laisse à sa nouvelle place', () => {
    const before = fresh();
    const swapped = captureReducer(before, replaceExercise(before, upperA, BENCH, machine)!.action);
    const added = captureReducer(swapped, { type: 'edit-layout', edit: layoutEditOf(first) });
    const next = captureReducer(added, {
      type: 'reconcile-progress', knownAtDeparture: [], pendingSetIds: [],
      base: { [BENCH]: { sets: [set(1)], setIds: ['journal'] } },
    });
    const session = replayLayout(upperA, next.layout!, (edit) => edit.exerciseId === BENCH ? first : machine);
    expect(ids(session)).toEqual([machine.exerciseId, ...ids(upperA).slice(1), BENCH]);
    expect(buildSessionRecap(session, next)).toMatchObject({ setsLogged: 1, liftedKg: 640 });
  });

  it('rien à faire : cible absente de la séance, ou remplaçant déjà dans la séance', () => {
    expect(replaceExercise(fresh(), upperA, 'inconnu', machine)).toBeNull();
    expect(replaceExercise(fresh(), upperA, first.exerciseId, second)).toBeNull();
  });

  it('la décision « il avait commencé » est inscrite dans le geste : le rejeu ne la redérive pas', () => {
    const state = logged();
    const gesture = replaceExercise(state, upperA, first.exerciseId, machine)!;
    const next = captureReducer(state, gesture.action);
    expect(next.layout).toEqual([expect.objectContaining({ replaces: first.exerciseId, keepsReplaced: true })]);
    // Rechargement : la disposition persiste et se rejoue à l'identique.
    persist(next);
    const reloaded = loadPersisted(upperA, DATE)!;
    expect(reloaded.layout).toEqual(next.layout);
    const replayed = replayLayout(upperA, reloaded.layout!, () => machine);
    expect(ids(replayed)).toEqual(ids(gesture.session));
    // Même si la série de l'exo remplacé a été supprimée depuis, la liste ne
    // change pas sous les doigts : l'exo d'origine reste, vide.
    const emptied = captureReducer(reloaded, { type: 'undo-last-set', exerciseId: first.exerciseId });
    expect(ids(replayLayout(upperA, emptied.layout!, () => machine))).toEqual(ids(gesture.session));
  });

  it('une disposition enregistrée avant ce changement garde le remplacement en place', () => {
    const old = [{ kind: 'swapped' as const, exerciseId: 'chest-machine', name: 'Développé machine', unilateral: false, primaryMuscles: [], replaces: first.exerciseId }];
    expect(ids(replayLayout(upperA, old, () => machine))).toEqual(['chest-machine', ...ids(upperA).slice(1)]);
  });

  it('plan retouché depuis : la cible n’est plus dans la séance, le remplaçant est ajouté à la fin', () => {
    const state = logged();
    const next = captureReducer(state, replaceExercise(state, upperA, first.exerciseId, machine)!.action);
    const without = { ...upperA, exercises: upperA.exercises.slice(1) };
    expect(ids(replayLayout(without, next.layout!, () => machine))).toEqual([...ids(without), 'chest-machine']);
  });

  it('déviations : le remplaçant est un exo « remplacé », l’exo d’origine resté dans la séance n’en est pas une', () => {
    const gesture = replaceExercise(logged(), upperA, first.exerciseId, machine)!;
    expect(deriveExerciseDeviations(templateExerciseIds(upperA), gesture.session)).toEqual([
      { kind: 'swapped', exerciseId: 'chest-machine', name: 'Développé machine', replacedExerciseId: first.exerciseId },
    ]);
  });

  it('remplacer à son tour le remplaçant commencé : il reste, le suivant s’insère après lui', () => {
    let state = logged();
    const one = replaceExercise(state, upperA, first.exerciseId, machine)!;
    state = captureReducer(state, one.action);
    state = captureReducer(state, { type: 'log-set', exerciseId: 'chest-machine', setId: 'm1', set: { weightKg: 60, reps: 10, rir: 2 } });
    const dips: SessionExercise = { ...first, exerciseId: 'dips', name: 'Dips' };
    const two = replaceExercise(state, one.session, 'chest-machine', dips)!;
    expect(ids(two.session).slice(0, 3)).toEqual([first.exerciseId, 'chest-machine', 'dips']);
    state = captureReducer(state, two.action);
    const resolve = (edit: { exerciseId: string }) => (edit.exerciseId === 'dips' ? dips : machine);
    expect(ids(replayLayout(upperA, state.layout!, resolve))).toEqual(ids(two.session));
  });
});
