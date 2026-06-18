// Tests unitaires du reducer de capture et de ses helpers (getProgress, statusOf).
//
// Pas de localStorage, pas de React : logique pure uniquement.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  captureReducer,
  getProgress,
  statusOf,
  initialState,
  clearCaptureState,
  type CaptureState,
  type ExerciseProgress,
} from './state';
import { upperA } from './fixtures';

// --- Fabriques ---------------------------------------------------------------

/** État initial minimal pour les tests du reducer. */
function mkState(overrides?: Partial<CaptureState>): CaptureState {
  return {
    ...initialState(upperA, '2026-06-18'),
    // On fixe startedAt pour que les tests soient déterministes.
    startedAt: 1_000_000,
    ...overrides,
  };
}

/** Une série minimale, sans l'ordre (le reducer l'affecte). */
const set1 = { weightKg: 80, reps: 8, rir: 2 };
const set2 = { weightKg: 82.5, reps: 6, rir: 1 };

// --- getProgress -------------------------------------------------------------

describe('getProgress', () => {
  it('retourne un progrès vide pour un exercice inconnu', () => {
    const state = mkState();
    const p = getProgress(state, 'inexistant');
    expect(p.sets).toEqual([]);
    expect(p.setIds).toEqual([]);
    expect(p.skipped).toBe(false);
  });

  it('retourne le progrès existant pour un exercice connu', () => {
    const state = mkState();
    const after = captureReducer(state, {
      type: 'log-set',
      exerciseId: 'bench-press',
      setId: 'sid-1',
      set: set1,
    });
    const p = getProgress(after, 'bench-press');
    expect(p.sets).toHaveLength(1);
    expect(p.sets[0]).toMatchObject({ weightKg: 80, reps: 8, rir: 2, order: 1 });
  });
});

// --- statusOf ----------------------------------------------------------------

describe('statusOf', () => {
  const empty: ExerciseProgress = { sets: [], setIds: [], skipped: false };

  it('todo : aucune série, non passé', () => {
    expect(statusOf(empty, 3)).toBe('todo');
  });

  it('skipped : marqué passé, indépendamment des séries', () => {
    const p: ExerciseProgress = { sets: [], setIds: [], skipped: true };
    expect(statusOf(p, 3)).toBe('skipped');
  });

  it('in-progress : des séries mais pas encore le min prescrit', () => {
    const p: ExerciseProgress = {
      sets: [{ weightKg: 80, reps: 8, rir: 2, order: 1 }],
      setIds: ['s1'],
      skipped: false,
    };
    expect(statusOf(p, 3)).toBe('in-progress');
  });

  it('done : atteint exactement le min prescrit', () => {
    const sets = [
      { weightKg: 80, reps: 8, rir: 2, order: 1 },
      { weightKg: 80, reps: 8, rir: 2, order: 2 },
      { weightKg: 80, reps: 8, rir: 2, order: 3 },
    ];
    const p: ExerciseProgress = { sets, setIds: ['s1', 's2', 's3'], skipped: false };
    expect(statusOf(p, 3)).toBe('done');
  });

  it('done : dépasse le min prescrit', () => {
    const sets = [
      { weightKg: 80, reps: 8, rir: 2, order: 1 },
      { weightKg: 80, reps: 8, rir: 2, order: 2 },
      { weightKg: 80, reps: 8, rir: 2, order: 3 },
      { weightKg: 80, reps: 8, rir: 2, order: 4 },
    ];
    const p: ExerciseProgress = { sets, setIds: ['s1', 's2', 's3', 's4'], skipped: false };
    // prescribedMin = 3, 4 séries loggées -> done
    expect(statusOf(p, 3)).toBe('done');
  });

  it('skipped prime sur tout le reste (même si des séries sont loggées)', () => {
    const sets = [{ weightKg: 80, reps: 8, rir: 2, order: 1 }];
    const p: ExerciseProgress = { sets, setIds: ['s1'], skipped: true };
    expect(statusOf(p, 3)).toBe('skipped');
  });
});

// --- captureReducer — open-exercise / back-to-picker -------------------------

describe('captureReducer — navigation', () => {
  it('open-exercise : positionne activeExerciseId', () => {
    const state = mkState();
    const next = captureReducer(state, { type: 'open-exercise', exerciseId: 'bench-press' });
    expect(next.activeExerciseId).toBe('bench-press');
  });

  it('back-to-picker : remet activeExerciseId à null', () => {
    const state = mkState({ activeExerciseId: 'bench-press' });
    const next = captureReducer(state, { type: 'back-to-picker' });
    expect(next.activeExerciseId).toBeNull();
  });
});

// --- captureReducer — log-set ------------------------------------------------

describe('captureReducer — log-set', () => {
  it('logue une première série avec order=1 et préserve le setId', () => {
    const state = mkState();
    const next = captureReducer(state, {
      type: 'log-set',
      exerciseId: 'bench-press',
      setId: 'sid-a',
      set: set1,
    });
    const p = getProgress(next, 'bench-press');
    expect(p.sets).toHaveLength(1);
    expect(p.sets[0]).toEqual({ ...set1, order: 1 });
    expect(p.setIds).toEqual(['sid-a']);
    expect(p.skipped).toBe(false);
  });

  it('logue une deuxième série avec order=2 (incrémentation)', () => {
    let state = mkState();
    state = captureReducer(state, { type: 'log-set', exerciseId: 'bench-press', setId: 's1', set: set1 });
    state = captureReducer(state, { type: 'log-set', exerciseId: 'bench-press', setId: 's2', set: set2 });
    const p = getProgress(state, 'bench-press');
    expect(p.sets).toHaveLength(2);
    expect(p.sets[1]).toMatchObject({ ...set2, order: 2 });
    expect(p.setIds).toEqual(['s1', 's2']);
  });

  it('ne touche pas les autres exercices', () => {
    const state = mkState();
    const next = captureReducer(state, {
      type: 'log-set',
      exerciseId: 'bench-press',
      setId: 's1',
      set: set1,
    });
    const other = getProgress(next, 'seated-row');
    expect(other.sets).toHaveLength(0);
  });

  it('efface le flag skipped si on logue sur un exo passé', () => {
    let state = mkState();
    state = captureReducer(state, { type: 'skip-exercise', exerciseId: 'bench-press' });
    expect(getProgress(state, 'bench-press').skipped).toBe(true);
    state = captureReducer(state, { type: 'log-set', exerciseId: 'bench-press', setId: 's1', set: set1 });
    expect(getProgress(state, 'bench-press').skipped).toBe(false);
  });
});

// --- captureReducer — undo-last-set ------------------------------------------

describe('captureReducer — undo-last-set', () => {
  it('supprime la dernière série loggée', () => {
    let state = mkState();
    state = captureReducer(state, { type: 'log-set', exerciseId: 'bench-press', setId: 's1', set: set1 });
    state = captureReducer(state, { type: 'log-set', exerciseId: 'bench-press', setId: 's2', set: set2 });
    state = captureReducer(state, { type: 'undo-last-set', exerciseId: 'bench-press' });
    const p = getProgress(state, 'bench-press');
    expect(p.sets).toHaveLength(1);
    expect(p.setIds).toEqual(['s1']);
  });

  it('est idempotent si aucune série (état vide -> pas de changement)', () => {
    const state = mkState();
    const next = captureReducer(state, { type: 'undo-last-set', exerciseId: 'bench-press' });
    // Référence stable : pas de recréation d'objet quand rien ne change.
    expect(next).toBe(state);
  });

  it('ne touche pas les autres exercices', () => {
    let state = mkState();
    state = captureReducer(state, { type: 'log-set', exerciseId: 'bench-press', setId: 's1', set: set1 });
    state = captureReducer(state, { type: 'log-set', exerciseId: 'seated-row', setId: 's2', set: set1 });
    state = captureReducer(state, { type: 'undo-last-set', exerciseId: 'bench-press' });
    expect(getProgress(state, 'seated-row').sets).toHaveLength(1);
  });
});

// --- captureReducer — skip / unskip ------------------------------------------

describe('captureReducer — skip-exercise / unskip-exercise', () => {
  it('skip : marque skipped=true et revient au picker (activeExerciseId=null)', () => {
    const state = mkState({ activeExerciseId: 'bench-press' });
    const next = captureReducer(state, { type: 'skip-exercise', exerciseId: 'bench-press' });
    expect(getProgress(next, 'bench-press').skipped).toBe(true);
    expect(next.activeExerciseId).toBeNull();
  });

  it('unskip : repasse skipped à false sans toucher les séries', () => {
    let state = mkState();
    state = captureReducer(state, { type: 'log-set', exerciseId: 'bench-press', setId: 's1', set: set1 });
    state = captureReducer(state, { type: 'skip-exercise', exerciseId: 'bench-press' });
    state = captureReducer(state, { type: 'unskip-exercise', exerciseId: 'bench-press' });
    const p = getProgress(state, 'bench-press');
    expect(p.skipped).toBe(false);
    // Les séries déjà loggées sont conservées.
    expect(p.sets).toHaveLength(1);
  });
});

// --- captureReducer — reset --------------------------------------------------

describe('captureReducer — reset', () => {
  it('vide le progrès et met à jour executionId', () => {
    let state = mkState();
    state = captureReducer(state, { type: 'log-set', exerciseId: 'bench-press', setId: 's1', set: set1 });
    const after = captureReducer(state, { type: 'reset', executionId: 'exec-new' });
    expect(after.progress).toEqual({});
    expect(after.executionId).toBe('exec-new');
    expect(after.activeExerciseId).toBeNull();
  });

  it('conserve le sessionId', () => {
    const state = mkState();
    const after = captureReducer(state, { type: 'reset', executionId: 'exec-2' });
    expect(after.sessionId).toBe(state.sessionId);
  });

  it('lève la clôture : une séance neuve repart en cours (closedAt null)', () => {
    const closed = captureReducer(mkState(), { type: 'close', closedAt: 1_700_000 });
    const after = captureReducer(closed, { type: 'reset', executionId: 'exec-3' });
    expect(after.closedAt).toBeNull();
  });
});

// --- captureReducer — close --------------------------------------------------

describe('captureReducer — close', () => {
  it('fige closedAt (la clôture survit ainsi au remontage via la persistance)', () => {
    const state = mkState();
    expect(state.closedAt).toBeNull();
    const after = captureReducer(state, { type: 'close', closedAt: 1_700_500 });
    expect(after.closedAt).toBe(1_700_500);
  });

  it('conserve le réalisé loggé (la séance close reste consultable)', () => {
    let state = mkState();
    state = captureReducer(state, { type: 'log-set', exerciseId: 'bench-press', setId: 's1', set: set1 });
    const after = captureReducer(state, { type: 'close', closedAt: 1_700_600 });
    expect(getProgress(after, 'bench-press').sets).toHaveLength(1);
    expect(after.executionId).toBe(state.executionId);
  });
});

// --- progression (statut global via statusOf) --------------------------------

describe('progression globale via statusOf', () => {
  it('séquence todo -> in-progress -> done en loggant 3 séries (min=3)', () => {
    let state = mkState();
    // prescribedMin = 3 (upperA bench-press sets.min = 3)
    const exId = 'bench-press';
    const min = upperA.exercises.find((e) => e.exerciseId === exId)!.prescription.sets.min;

    expect(statusOf(getProgress(state, exId), min)).toBe('todo');

    state = captureReducer(state, { type: 'log-set', exerciseId: exId, setId: 's1', set: set1 });
    expect(statusOf(getProgress(state, exId), min)).toBe('in-progress');

    state = captureReducer(state, { type: 'log-set', exerciseId: exId, setId: 's2', set: set1 });
    expect(statusOf(getProgress(state, exId), min)).toBe('in-progress');

    state = captureReducer(state, { type: 'log-set', exerciseId: exId, setId: 's3', set: set1 });
    expect(statusOf(getProgress(state, exId), min)).toBe('done');
  });
});

// --- clearCaptureState (purge à la déconnexion) ------------------------------
//
// Env node : pas de localStorage natif → polyfill mémoire avant chaque test.
// Ici on a besoin de `length` + `key(i)` (le helper balaye toutes les clés),
// que le polyfill minimal de outbox.test.ts n'expose pas.

class IndexableMemoryStorage {
  private store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  key(i: number): string | null {
    return Array.from(this.store.keys())[i] ?? null;
  }
  getItem(k: string): string | null {
    return this.store.has(k) ? (this.store.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.store.set(k, String(v));
  }
  removeItem(k: string): void {
    this.store.delete(k);
  }
  clear(): void {
    this.store.clear();
  }
}

describe('clearCaptureState', () => {
  beforeEach(() => {
    (globalThis as unknown as { localStorage: Storage }).localStorage =
      new IndexableMemoryStorage() as unknown as Storage;
  });

  it('supprime toutes les clés croustylift:capture:* (plusieurs sessions/jours)', () => {
    localStorage.setItem('croustylift:capture:sess-1:2026-06-18', '{}');
    localStorage.setItem('croustylift:capture:sess-1:2026-06-17', '{}');
    localStorage.setItem('croustylift:capture:sess-2:2026-06-18', '{}');

    clearCaptureState();

    expect(localStorage.getItem('croustylift:capture:sess-1:2026-06-18')).toBeNull();
    expect(localStorage.getItem('croustylift:capture:sess-1:2026-06-17')).toBeNull();
    expect(localStorage.getItem('croustylift:capture:sess-2:2026-06-18')).toBeNull();
  });

  it('ne touche pas les autres clés (outbox, token Supabase, divers)', () => {
    localStorage.setItem('croustylift:capture:sess-1:2026-06-18', '{}');
    localStorage.setItem('croustylift:outbox', '[]');
    localStorage.setItem('sb-xyz-auth-token', 'jwt');
    localStorage.setItem('autre-cle', 'valeur');

    clearCaptureState();

    expect(localStorage.getItem('croustylift:capture:sess-1:2026-06-18')).toBeNull();
    // Tout le reste survit : la purge est ciblée sur le préfixe capture.
    expect(localStorage.getItem('croustylift:outbox')).toBe('[]');
    expect(localStorage.getItem('sb-xyz-auth-token')).toBe('jwt');
    expect(localStorage.getItem('autre-cle')).toBe('valeur');
  });

  it('est un no-op sans erreur quand rien n’est persisté', () => {
    expect(() => clearCaptureState()).not.toThrow();
    expect(localStorage.length).toBe(0);
  });
});
