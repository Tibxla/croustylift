// Gestes sur les EXOS de la séance en cours. Ici : remettre un exo passé.
import { beforeEach, describe, expect, it } from 'vitest';
import { upperA } from './fixtures';
import { restoreSkippedExercise } from './exercise-gestures';
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
