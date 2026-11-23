// Tests unitaires du reducer de capture et de ses helpers (getProgress, statusOf).
//
// Pas de localStorage, pas de React : logique pure uniquement.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  captureReducer,
  getProgress,
  getDatedNote,
  statusOf,
  initialState,
  isExecutionStarted,
  isPristine,
  isResumable,
  LAUNCH_EXPIRY_MS,
  shouldReanchorLaunch,
  adoptedVersionId,
  capturePersistFailing,
  persistedVersionIds,
  pruneStaleCaptureStates,
  applyQueuedSets,
  reconcileDatedNotes,
  reconcileProgress,
  clearCaptureState,
  clearOwnCaptureState,
  hydratedState,
  mergeProgress,
  loadPersisted,
  persist,
  clearPersisted,
  clearPersistedExecution,
  nextSetOrder,
  pendingSide,
  previousDayIso,
  resolveCaptureDate,
  type CaptureState,
  type ExerciseProgress,
  type HydratedProgress,
} from './state';
import { upperA } from './fixtures';
import { saveLocalAccount } from '../../lib/local-account';

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

// --- captureReducer — log-set UNILATÉRAL (issue #46) -------------------------

describe('captureReducer — log-set unilatéral', () => {
  // Un exo unilatéral : une SÉRIE = côté gauche PUIS droite, valeurs distinctes,
  // les deux partagent le MÊME order.
  const left1 = { weightKg: 28, reps: 10, rir: 2, side: 'left' as const };
  const right1 = { weightKg: 32, reps: 10, rir: 2, side: 'right' as const };
  const left2 = { weightKg: 27, reps: 9, rir: 1, side: 'left' as const };
  const right2 = { weightKg: 31, reps: 9, rir: 1, side: 'right' as const };

  it('gauche puis droite d’une 1ʳᵉ série partagent order=1, side conservé', () => {
    let state = mkState();
    state = captureReducer(state, { type: 'log-set', exerciseId: 'curl', setId: 'l1', set: left1 });
    state = captureReducer(state, { type: 'log-set', exerciseId: 'curl', setId: 'r1', set: right1 });

    const p = getProgress(state, 'curl');
    expect(p.sets).toHaveLength(2);
    expect(p.sets[0]).toEqual({ ...left1, order: 1 });
    expect(p.sets[1]).toEqual({ ...right1, order: 1 });
    expect(p.setIds).toEqual(['l1', 'r1']);
  });

  it('2ᵉ série unilatérale : gauche puis droite partagent order=2', () => {
    let state = mkState();
    state = captureReducer(state, { type: 'log-set', exerciseId: 'curl', setId: 'l1', set: left1 });
    state = captureReducer(state, { type: 'log-set', exerciseId: 'curl', setId: 'r1', set: right1 });
    state = captureReducer(state, { type: 'log-set', exerciseId: 'curl', setId: 'l2', set: left2 });
    state = captureReducer(state, { type: 'log-set', exerciseId: 'curl', setId: 'r2', set: right2 });

    const p = getProgress(state, 'curl');
    expect(p.sets.map((s) => s.order)).toEqual([1, 1, 2, 2]);
    expect(p.sets.map((s) => s.side)).toEqual(['left', 'right', 'left', 'right']);
  });

  it('garde des valeurs distinctes entre gauche et droite d’une même série', () => {
    let state = mkState();
    state = captureReducer(state, { type: 'log-set', exerciseId: 'curl', setId: 'l1', set: left1 });
    state = captureReducer(state, { type: 'log-set', exerciseId: 'curl', setId: 'r1', set: right1 });

    const p = getProgress(state, 'curl');
    expect(p.sets[0]!.weightKg).toBe(28);
    expect(p.sets[1]!.weightKg).toBe(32);
  });
});

// --- nextSetOrder (pur) ------------------------------------------------------

describe('nextSetOrder', () => {
  const empty: ExerciseProgress = { sets: [], setIds: [], skipped: false };

  it('bilatéral : incrémente simplement (sets.length + 1)', () => {
    expect(nextSetOrder(empty, undefined)).toBe(1);
    const p: ExerciseProgress = {
      sets: [{ weightKg: 80, reps: 8, rir: 2, order: 1 }],
      setIds: ['s1'],
      skipped: false,
    };
    expect(nextSetOrder(p, undefined)).toBe(2);
  });

  it('unilatéral, côté gauche : ouvre une nouvelle série (max order + 1)', () => {
    expect(nextSetOrder(empty, 'left')).toBe(1);
    const p: ExerciseProgress = {
      sets: [
        { weightKg: 28, reps: 10, rir: 2, order: 1, side: 'left' },
        { weightKg: 32, reps: 10, rir: 2, order: 1, side: 'right' },
      ],
      setIds: ['l1', 'r1'],
      skipped: false,
    };
    // série 1 complète -> gauche ouvre la série 2
    expect(nextSetOrder(p, 'left')).toBe(2);
  });

  it('unilatéral, côté droit : complète la série gauche en attente (même order)', () => {
    const p: ExerciseProgress = {
      sets: [{ weightKg: 28, reps: 10, rir: 2, order: 1, side: 'left' }],
      setIds: ['l1'],
      skipped: false,
    };
    // un gauche attend son droit -> droite réutilise order=1
    expect(nextSetOrder(p, 'right')).toBe(1);
  });

  it('unilatéral, droite sans gauche en attente (dégénéré) : nouvelle série', () => {
    expect(nextSetOrder(empty, 'right')).toBe(1);
  });
});

// --- pendingSide -------------------------------------------------------------

describe('pendingSide', () => {
  it('null quand aucune série n’est entamée', () => {
    expect(pendingSide({ sets: [], setIds: [], skipped: false })).toBeNull();
  });

  it('"left" quand la prochaine saisie est un nouveau côté gauche', () => {
    const p: ExerciseProgress = {
      sets: [
        { weightKg: 28, reps: 10, rir: 2, order: 1, side: 'left' },
        { weightKg: 32, reps: 10, rir: 2, order: 1, side: 'right' },
      ],
      setIds: ['l1', 'r1'],
      skipped: false,
    };
    // série 1 complète -> on attend le gauche de la série 2
    expect(pendingSide(p)).toBe('left');
  });

  it('"right" quand un côté gauche attend son droit', () => {
    const p: ExerciseProgress = {
      sets: [{ weightKg: 28, reps: 10, rir: 2, order: 1, side: 'left' }],
      setIds: ['l1'],
      skipped: false,
    };
    expect(pendingSide(p)).toBe('right');
  });
});

// --- captureReducer — set-dated-note -----------------------------------------

describe('captureReducer — set-dated-note', () => {
  it('pose la note datée d’un exo (id client + corps) et la relit via getDatedNote', () => {
    const state = mkState();
    expect(getDatedNote(state, 'bench-press')).toBeNull();

    const next = captureReducer(state, {
      type: 'set-dated-note',
      exerciseId: 'bench-press',
      noteId: 'note-1',
      body: 'dos un peu raide',
    });

    expect(getDatedNote(next, 'bench-press')).toEqual({
      id: 'note-1',
      body: 'dos un peu raide',
    });
  });

  it('réécrit la note du même exo en gardant le même id (édition en place)', () => {
    let state = mkState();
    state = captureReducer(state, {
      type: 'set-dated-note',
      exerciseId: 'bench-press',
      noteId: 'note-1',
      body: 'première version',
    });
    state = captureReducer(state, {
      type: 'set-dated-note',
      exerciseId: 'bench-press',
      noteId: 'note-1',
      body: 'corrigée',
    });
    expect(getDatedNote(state, 'bench-press')).toEqual({ id: 'note-1', body: 'corrigée' });
  });

  it('n’écrase pas la note d’un autre exo', () => {
    let state = mkState();
    state = captureReducer(state, {
      type: 'set-dated-note',
      exerciseId: 'bench-press',
      noteId: 'note-1',
      body: 'note couché',
    });
    state = captureReducer(state, {
      type: 'set-dated-note',
      exerciseId: 'seated-row',
      noteId: 'note-2',
      body: 'note tirage',
    });
    expect(getDatedNote(state, 'bench-press')).toEqual({ id: 'note-1', body: 'note couché' });
    expect(getDatedNote(state, 'seated-row')).toEqual({ id: 'note-2', body: 'note tirage' });
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

  // Unilatéral (ADR 0005) : une série logique = 2 lignes G+D au MÊME order.
  // L'undo travaille LIGNE PAR LIGNE (cohérent avec la saisie côté par côté et
  // le compteur 0,5/1) : un undo retire le dernier côté, le suivant le premier.
  const left = { weightKg: 28, reps: 10, rir: 2, side: 'left' as const };
  const right = { weightKg: 32, reps: 10, rir: 2, side: 'right' as const };

  it('unilatéral : un undo après G+D retire un seul côté (série à 0,5)', () => {
    let state = mkState();
    state = captureReducer(state, { type: 'log-set', exerciseId: 'curl', setId: 'l1', set: left });
    state = captureReducer(state, { type: 'log-set', exerciseId: 'curl', setId: 'r1', set: right });
    state = captureReducer(state, { type: 'undo-last-set', exerciseId: 'curl' });

    const p = getProgress(state, 'curl');
    // Il reste UNE ligne (le côté gauche, loggé en premier) à l'order 1.
    expect(p.sets).toHaveLength(1);
    expect(p.sets[0]).toEqual({ ...left, order: 1 });
    expect(p.setIds).toEqual(['l1']);
  });

  it('unilatéral : un 2ᵉ undo retire le côté restant (plus aucune série)', () => {
    let state = mkState();
    state = captureReducer(state, { type: 'log-set', exerciseId: 'curl', setId: 'l1', set: left });
    state = captureReducer(state, { type: 'log-set', exerciseId: 'curl', setId: 'r1', set: right });
    state = captureReducer(state, { type: 'undo-last-set', exerciseId: 'curl' });
    state = captureReducer(state, { type: 'undo-last-set', exerciseId: 'curl' });

    const p = getProgress(state, 'curl');
    expect(p.sets).toEqual([]);
    expect(p.setIds).toEqual([]);
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

  it('vide les notes datées (elles visaient l’exécution précédente, désormais close)', () => {
    let state = mkState();
    state = captureReducer(state, {
      type: 'set-dated-note',
      exerciseId: 'bench-press',
      noteId: 'note-1',
      body: 'note du jour',
    });
    const after = captureReducer(state, { type: 'reset', executionId: 'exec-new' });
    expect(getDatedNote(after, 'bench-press')).toBeNull();
  });

  it('lève la clôture : une séance neuve repart en cours (closedAt null)', () => {
    const closed = captureReducer(mkState(), { type: 'close', closedAt: 1_700_000 });
    const after = captureReducer(closed, { type: 'reset', executionId: 'exec-3' });
    expect(after.closedAt).toBeNull();
  });
});

// --- captureReducer — close --------------------------------------------------

describe('captureReducer — close', () => {
  it('fige closedAt EN MÉMOIRE (récap immédiat ; pas restauré — ADR 0009)', () => {
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

// --- hydratedState (réhydratation depuis la base) ----------------------------

describe('hydratedState', () => {
  // Un réalisé réhydraté porte l'id RÉEL de chaque ligne (bug H2/F1) : c'est lui
  // qui rend la série annulable (deleteSet) au reload / après une clôture.
  const hydrated: Record<string, HydratedProgress> = {
    'bench-press': {
      sets: [
        { weightKg: 80, reps: 8, rir: 2, order: 1 },
        { weightKg: 82.5, reps: 6, rir: 1, order: 2 },
      ],
      setIds: ['real-1', 'real-2'],
    },
  };

  it('pose les setIds = ids RÉELS de la base (plus jamais null)', () => {
    const state = hydratedState(upperA, hydrated, {}, '2026-06-18', 'exec-real');
    const p = getProgress(state, 'bench-press');
    expect(p.sets).toHaveLength(2);
    expect(p.setIds).toEqual(['real-1', 'real-2']);
    // Aucun id null : toute série réhydratée est annulable en base.
    expect(p.setIds.every((id) => id !== null)).toBe(true);
  });

  it('adopte l’executionId RÉEL fourni quand une exécution existe en base (bug H1)', () => {
    const state = hydratedState(upperA, hydrated, {}, '2026-06-18', 'exec-real');
    expect(state.executionId).toBe('exec-real');
  });

  it('séance neuve (aucun executionId fourni) → un id client neuf, défini', () => {
    const state = hydratedState(upperA, {}, {}, '2026-06-18');
    expect(typeof state.executionId).toBe('string');
    expect(state.executionId.length).toBeGreaterThan(0);
    // Pas de progrès à réhydrater : capture vierge sous la date donnée.
    expect(state.progress).toEqual({});
    expect(state.date).toBe('2026-06-18');
  });

  it('ignore un exo sans série (réalisé vide) et porte les notes datées', () => {
    const state = hydratedState(
      upperA,
      { 'bench-press': { sets: [], setIds: [] }, ...hydrated },
      { 'bench-press': { id: 'note-1', body: 'fatigué' } },
      '2026-06-18',
      'exec-real',
    );
    // L'exo à 0 série n'entre pas dans le progrès (cf. hydratedState).
    expect(Object.keys(state.progress)).toEqual(['bench-press']);
    expect(getProgress(state, 'bench-press').sets).toHaveLength(2);
    expect(getDatedNote(state, 'bench-press')).toEqual({ id: 'note-1', body: 'fatigué' });
    expect(state.closedAt).toBeNull();
  });
});

// --- mergeProgress (fusion Supabase ↔ cache local au montage) -----------------

describe('mergeProgress', () => {
  // États « en cours » : `a` = hydraté de Supabase (ids réels), `b` = cache local
  // (ids client). On fabrique `b` à partir de `a` puis on le déforme par exo.
  const supa = (
    progress: Record<string, HydratedProgress>,
    executionId = 'exec-supa',
  ): CaptureState => hydratedState(upperA, progress, {}, '2026-06-18', executionId);

  const local = (overrides: Partial<CaptureState>): CaptureState => ({
    ...supa({}, 'exec-local'),
    startedAt: 555_000,
    ...overrides,
  });

  it('garde le réalisé le PLUS AVANCÉ par exo', () => {
    const a = supa({
      'bench-press': {
        sets: [{ weightKg: 80, reps: 8, rir: 2, order: 1 }],
        setIds: ['real-1'],
      },
    });
    const b = local({
      progress: {
        'bench-press': {
          sets: [
            { weightKg: 80, reps: 8, rir: 2, order: 1 },
            { weightKg: 82, reps: 6, rir: 1, order: 2 },
          ],
          setIds: ['c-1', 'c-2'],
          skipped: false,
        },
      },
    });
    const merged = mergeProgress(a, b);
    // b est plus long → on le garde.
    expect(getProgress(merged, 'bench-press').sets).toHaveLength(2);
  });

  it('executionId et startedAt viennent du LOCAL (exécution en cours, ops en outbox)', () => {
    const a = supa({});
    const b = local({});
    const merged = mergeProgress(a, b);
    expect(merged.executionId).toBe('exec-local');
    expect(merged.startedAt).toBe(555_000);
  });

  it('à longueur égale, garde la base Supabase (a) qui porte les ids réels', () => {
    const a = supa({
      'bench-press': {
        sets: [
          { weightKg: 80, reps: 8, rir: 2, order: 1 },
          { weightKg: 82, reps: 6, rir: 1, order: 2 },
        ],
        setIds: ['real-1', 'real-2'],
      },
    });
    // Local de même longueur mais ids client : à égalité, Supabase fait foi.
    const b = local({
      progress: {
        'bench-press': {
          sets: [
            { weightKg: 80, reps: 8, rir: 2, order: 1 },
            { weightKg: 82, reps: 6, rir: 1, order: 2 },
          ],
          setIds: ['c-1', 'c-2'],
          skipped: false,
        },
      },
    });
    const merged = mergeProgress(a, b);
    expect(getProgress(merged, 'bench-press').setIds).toEqual(['real-1', 'real-2']);
  });

  it('complète un setId null de la base la plus avancée par l’id de l’autre source', () => {
    // Base la plus avancée = local (3 séries) MAIS son 1ᵉʳ id manque (cache ancien
    // format). On le complète par l'id réel de la base au même index : aucune série
    // ne reste sans id annulable (objectif du fix H2/F1).
    const a = supa({
      'bench-press': {
        sets: [
          { weightKg: 80, reps: 8, rir: 2, order: 1 },
          { weightKg: 82, reps: 6, rir: 1, order: 2 },
        ],
        setIds: ['real-1', 'real-2'],
      },
    });
    const b = local({
      progress: {
        'bench-press': {
          sets: [
            { weightKg: 80, reps: 8, rir: 2, order: 1 },
            { weightKg: 82, reps: 6, rir: 1, order: 2 },
            { weightKg: 84, reps: 5, rir: 0, order: 3 },
          ],
          setIds: [null, 'c-2', 'c-3'],
          skipped: false,
        },
      },
    });
    const merged = mergeProgress(a, b);
    const p = getProgress(merged, 'bench-press');
    expect(p.sets).toHaveLength(3);
    // index 0 : null du local complété par real-1 ; les autres gardent l'id local ;
    // index 2 : la base n'a pas de 3ᵉ id → reste l'id client local (c-3).
    expect(p.setIds).toEqual(['real-1', 'c-2', 'c-3']);
  });

  it('unilatéral : complète un setId null par (order, side), pas par index (ordre G/D croisé)', () => {
    // base = local (plus avancé, 3 séries) en ordre de SAISIE (droite d'abord, #63),
    // avec l'id de la série GAUCHE@1 manquant (cache ancien format).
    const b = local({
      progress: {
        curl: {
          sets: [
            { weightKg: 20, reps: 12, rir: 2, order: 1, side: 'right' },
            { weightKg: 20, reps: 12, rir: 2, order: 1, side: 'left' },
            { weightKg: 20, reps: 10, rir: 1, order: 2, side: 'right' },
          ],
          setIds: ['c-r1', null, 'c-r2'],
          skipped: false,
        },
      },
    });
    // other = Supabase, TRIÉ (gauche avant droite) : ordre DIFFÉRENT du local.
    const a = supa({
      curl: {
        sets: [
          { weightKg: 20, reps: 12, rir: 2, order: 1, side: 'left' },
          { weightKg: 20, reps: 12, rir: 2, order: 1, side: 'right' },
        ],
        setIds: ['real-l1', 'real-r1'],
      },
    });
    const merged = mergeProgress(a, b);
    // L'id manquant (gauche@1) est complété par l'id GAUCHE de la base (real-l1),
    // PAS par l'id au même index (real-r1 = la droite) : alignement par (order, side).
    // L'alignement par index brut aurait croisé les côtés → undo de la mauvaise ligne.
    expect(getProgress(merged, 'curl').setIds).toEqual(['c-r1', 'real-l1', 'c-r2']);
  });

  it('un exo présent dans une seule source est conservé tel quel', () => {
    const a = supa({
      'bench-press': {
        sets: [{ weightKg: 80, reps: 8, rir: 2, order: 1 }],
        setIds: ['real-1'],
      },
    });
    const b = local({}); // aucun progrès local
    const merged = mergeProgress(a, b);
    expect(getProgress(merged, 'bench-press').setIds).toEqual(['real-1']);
  });

  it('reste « en cours » : closedAt null après fusion', () => {
    const merged = mergeProgress(supa({}), local({}));
    expect(merged.closedAt).toBeNull();
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

// --- clearPersistedExecution (suppression d'une exécution depuis le journal) ---
//
// Le bug : supprimer depuis le journal l'exécution que la Capture tient encore en
// cours laissait son état local. Il prime à la réhydratation, donc la série
// suivante recréait l'exécution supprimée sous le même id.

describe('clearPersistedExecution', () => {
  const DATE = '2026-06-18';

  beforeEach(() => {
    (globalThis as unknown as { localStorage: Storage }).localStorage =
      new IndexableMemoryStorage() as unknown as Storage;
  });

  it('efface l’état de capture qui porte cette exécution : la séance repart vierge', () => {
    persist(mkState({ executionId: 'exec-supprimee' }));
    expect(loadPersisted(upperA, DATE)?.executionId).toBe('exec-supprimee');

    clearPersistedExecution('exec-supprimee');
    expect(loadPersisted(upperA, DATE)).toBeNull();
  });

  it('laisse l’état d’une AUTRE exécution, et tout ce qui n’est pas un état de capture', () => {
    persist(mkState({ executionId: 'exec-en-cours' }));
    persist(mkState({ sessionId: 'autre-seance', executionId: 'exec-supprimee' }));
    localStorage.setItem('croustylift:outbox', '[{"type":"deleteExecution","id":"exec-supprimee"}]');

    clearPersistedExecution('exec-supprimee');
    expect(loadPersisted(upperA, DATE)?.executionId).toBe('exec-en-cours');
    expect(localStorage.getItem(`croustylift:capture:autre-seance:${DATE}`)).toBeNull();
    expect(localStorage.getItem('croustylift:outbox')).not.toBeNull();
  });

  it('un état illisible ne bloque pas le balayage', () => {
    localStorage.setItem('croustylift:capture:cassee:2026-06-17', '{pas du json');
    persist(mkState({ executionId: 'exec-supprimee' }));

    clearPersistedExecution('exec-supprimee');
    expect(loadPersisted(upperA, DATE)).toBeNull();
    expect(localStorage.getItem('croustylift:capture:cassee:2026-06-17')).not.toBeNull();
  });
});

// --- persist / loadPersisted (survie au background + clôture transitoire) -----
//
// ADR 0009 : une séance EN COURS se restaure (offline : on ne perd pas les séries
// loggées sur un reload). Une séance CLÔTURÉE ne se restaure JAMAIS : son cache est
// nettoyé à la clôture (câblage CaptureScreen) et `loadPersisted` force `closedAt`
// à null, de sorte qu'un vieux cache porteur d'un closedAt ne ressuscite pas
// l'écran « Séance terminée ». Même polyfill localStorage indexable que ci-dessus.

describe('persist / loadPersisted', () => {
  const DATE = '2026-06-18';

  beforeEach(() => {
    (globalThis as unknown as { localStorage: Storage }).localStorage =
      new IndexableMemoryStorage() as unknown as Storage;
  });

  it('restaure une séance EN COURS : les séries loggées sont préservées', () => {
    let state = mkState();
    state = captureReducer(state, {
      type: 'log-set',
      exerciseId: 'bench-press',
      setId: 's1',
      set: set1,
    });
    persist(state);

    const restored = loadPersisted(upperA, DATE);
    expect(restored).not.toBeNull();
    const p = getProgress(restored as CaptureState, 'bench-press');
    expect(p.sets).toHaveLength(1);
    expect(p.sets[0]).toMatchObject({ ...set1, order: 1 });
    expect(p.setIds).toEqual(['s1']);
    // L'exécution en cours garde son id (les ops d'outbox visent cette exécution).
    expect((restored as CaptureState).executionId).toBe(state.executionId);
    expect((restored as CaptureState).closedAt).toBeNull();
  });

  it('ne restaure PAS la clôture : un cache porteur d’un closedAt revient « en cours »', () => {
    // Cache d'un état close (pré-ADR, ou écrit avant le nettoyage) : le load doit
    // l'ignorer et forcer closedAt à null (capture vierge, pas « Séance terminée »).
    const closed = captureReducer(mkState(), { type: 'close', closedAt: 1_700_500 });
    persist(closed);

    const restored = loadPersisted(upperA, DATE);
    expect(restored).not.toBeNull();
    expect((restored as CaptureState).closedAt).toBeNull();
  });

  it('clearPersisted purge le cache : le remontage repart vierge (loadPersisted null)', () => {
    // Geste de clôture câblé : le state est posé close, puis le cache nettoyé.
    let state = mkState();
    state = captureReducer(state, {
      type: 'log-set',
      exerciseId: 'bench-press',
      setId: 's1',
      set: set1,
    });
    persist(state);
    expect(loadPersisted(upperA, DATE)).not.toBeNull();

    // Clôture transitoire : on nettoie plutôt que de persister l'état close.
    clearPersisted(upperA, DATE);
    expect(loadPersisted(upperA, DATE)).toBeNull();
  });

  it('rien de persisté → null (capture vierge au premier montage)', () => {
    expect(loadPersisted(upperA, DATE)).toBeNull();
  });
  it('l’état persisté par un autre compte n’est pas restauré', () => {
    saveLocalAccount({ userId: 'user-a', email: 'a@exemple.com' });
    const state = captureReducer(mkState(), {
      type: 'log-set',
      exerciseId: 'bench-press',
      setId: 's1',
      set: set1,
    });
    persist(state);
    expect(loadPersisted(upperA, DATE)).not.toBeNull();

    // Un autre compte reconnu sur l'appareil : la capture de A n'est pas la sienne.
    saveLocalAccount({ userId: 'user-b', email: 'b@exemple.com' });
    expect(loadPersisted(upperA, DATE)).toBeNull();

    // Le compte d'origine revenu la retrouve.
    saveLocalAccount({ userId: 'user-a', email: 'a@exemple.com' });
    expect(loadPersisted(upperA, DATE)?.progress['bench-press']?.sets).toHaveLength(1);
  });

  it('un état persisté sans compte (ancien format) reste restauré', () => {
    localStorage.setItem(`croustylift:capture:${upperA.id}:${DATE}`, JSON.stringify(mkState()));
    saveLocalAccount({ userId: 'user-a', email: 'a@exemple.com' });

    expect(loadPersisted(upperA, DATE)).not.toBeNull();
  });
});

// --- previousDayIso (pur) ----------------------------------------------------
// La veille d'une date ISO, dérivée de l'argument (pas de Date.now()) → testable.

describe('previousDayIso', () => {
  it('recule d’un jour dans le même mois', () => {
    expect(previousDayIso('2026-06-19')).toBe('2026-06-18');
  });

  it('passe la frontière de mois (1er du mois -> dernier du mois précédent)', () => {
    expect(previousDayIso('2026-07-01')).toBe('2026-06-30');
  });

  it('passe la frontière d’année (1er janvier -> 31 décembre)', () => {
    expect(previousDayIso('2026-01-01')).toBe('2025-12-31');
  });

  it('gère le 29 février d’une année bissextile', () => {
    expect(previousDayIso('2024-03-01')).toBe('2024-02-29');
  });
});

// --- resolveCaptureDate (frontière minuit, bug F10) --------------------------
//
// Une séance entamée la veille et NON clôturée doit pouvoir être reprise après
// minuit : si rien n'est persisté pour `today`, on retombe sur le cache de la
// veille (s'il existe et n'est pas clôturé), en conservant SA date. Une veille
// clôturée a vu son cache nettoyé → rien à reprendre, capture vierge du jour.
// Même polyfill localStorage indexable que plus haut.

describe('isResumable (ADR 0011 : expiration d’un lancement)', () => {
  const NOW = 2_000_000_000_000;
  it('reprenable dès qu’une série est loggée, quel que soit l’âge du lancement', () => {
    const withSet = captureReducer(mkState({ startedAt: 1 }), {
      type: 'log-set',
      exerciseId: 'bench-press',
      setId: 's1',
      set: set1,
    });
    expect(isResumable(withSet, NOW)).toBe(true);
  });

  it('lancement vide récent (<1h) reprenable, expiré (>1h) non', () => {
    const recent = mkState({ startedAt: NOW - (LAUNCH_EXPIRY_MS - 1) });
    const expired = mkState({ startedAt: NOW - (LAUNCH_EXPIRY_MS + 1) });
    expect(isResumable(recent, NOW)).toBe(true);
    expect(isResumable(expired, NOW)).toBe(false);
  });
});

// --- Chrono : jamais réancré une fois l'exécution née (ADR 0011) -------------
//
// Bug : le réancrage testait une ref de MONTAGE (« aucune op d'exécution enfilée
// depuis ce montage »), remise à zéro à chaque changement d'onglet. Sur une
// séance de plus d'1 h, la série suivant un passage par l'Analyse réancrait
// `startedAt` et l'upsert réécrivait `started_at` en base : 1 h 30 de séance
// devenaient 25 min.

describe('isExecutionStarted (l’exécution existe déjà, en base ou en file)', () => {
  const fresh = mkState({ executionId: 'exec-1' });

  it('lancement sans rien : pas encore née', () => {
    expect(isExecutionStarted(fresh, null, [])).toBe(false);
  });

  it('une série dans l’état restauré : née', () => {
    const withSet = captureReducer(fresh, {
      type: 'log-set',
      exerciseId: 'bench-press',
      setId: 's1',
      set: set1,
    });
    expect(isExecutionStarted(withSet, null, [])).toBe(true);
  });

  it('une note datée dans l’état restauré : née (la note a enfilé l’exécution)', () => {
    const withNote = captureReducer(fresh, {
      type: 'set-dated-note',
      exerciseId: 'bench-press',
      noteId: 'n1',
      body: 'épaule sensible',
    });
    expect(isExecutionStarted(withNote, null, [])).toBe(true);
  });

  it('exécution du jour réhydratée de la base sous le même id : née', () => {
    expect(isExecutionStarted(fresh, 'exec-1', [])).toBe(true);
  });

  it('son upsertExecution attend encore en outbox : née', () => {
    expect(isExecutionStarted(fresh, null, [{ type: 'upsertExecution', id: 'exec-1' }])).toBe(true);
  });

  it('une AUTRE exécution en base ou en file ne compte pas', () => {
    expect(isExecutionStarted(fresh, 'exec-autre', [])).toBe(false);
    expect(
      isExecutionStarted(fresh, null, [
        { type: 'upsertExecution', id: 'exec-autre' },
        // Même id mais autre type d'op (une suppression) : pas une naissance.
        { type: 'deleteExecution', id: 'exec-1' },
      ]),
    ).toBe(false);
  });
});

describe('shouldReanchorLaunch', () => {
  const NOW = 2_000_000_000_000;
  const launchedLongAgo = mkState({ startedAt: NOW - (LAUNCH_EXPIRY_MS + 5 * 60_000) });

  it('lancement expiré SANS exécution : on réancre sur le premier set (ADR 0011)', () => {
    expect(shouldReanchorLaunch(launchedLongAgo, false, NOW)).toBe(true);
  });

  it('séance de plus d’1 h déjà entamée, écran remonté : JAMAIS réancrée', () => {
    expect(shouldReanchorLaunch(launchedLongAgo, true, NOW)).toBe(false);
  });

  it('lancement récent : pas de réancrage', () => {
    const recent = mkState({ startedAt: NOW - (LAUNCH_EXPIRY_MS - 1) });
    expect(shouldReanchorLaunch(recent, false, NOW)).toBe(false);
  });
});

describe('resolveCaptureDate', () => {
  const TODAY = '2026-06-19';
  const YESTERDAY = '2026-06-18';

  beforeEach(() => {
    (globalThis as unknown as { localStorage: Storage }).localStorage =
      new IndexableMemoryStorage() as unknown as Storage;
  });

  it('cas NOMINAL : cache d’aujourd’hui présent (en cours) → on adopte today (veille ignorée)', () => {
    // Deux séances EN COURS (chacune une série loggée → reprenables, ADR 0011),
    // aujourd'hui et la veille : today doit primer.
    const todayState = captureReducer(mkState({ date: TODAY }), {
      type: 'log-set',
      exerciseId: 'bench-press',
      setId: 's1',
      set: set1,
    });
    persist(todayState);
    const yesterdayState = captureReducer(mkState({ date: YESTERDAY }), {
      type: 'log-set',
      exerciseId: 'bench-press',
      setId: 's2',
      set: set1,
    });
    persist(yesterdayState);

    const { date, restored } = resolveCaptureDate(upperA, TODAY);
    expect(date).toBe(TODAY);
    expect(restored).not.toBeNull();
    expect((restored as CaptureState).date).toBe(TODAY);
  });

  it('lancement vide EXPIRÉ (>1h, aucune série) → pas de restauration (on repropose le lancement)', () => {
    // Un cache « lancé mais rien loggé » dont le lancement (startedAt fixé très
    // ancien) date de plus d'1 h : il a expiré (ADR 0011), on repart vierge.
    persist(mkState({ date: TODAY, startedAt: 1_000_000 }));

    const { date, restored } = resolveCaptureDate(upperA, TODAY);
    expect(date).toBe(TODAY);
    expect(restored).toBeNull();
  });

  it('lancement RÉCENT sans série (<1h) → reprise (le chrono vient de démarrer)', () => {
    // Lancé il y a un instant, pas encore de série : reprenable (on continue).
    persist(mkState({ date: TODAY, startedAt: Date.now() }));

    const { restored } = resolveCaptureDate(upperA, TODAY);
    expect(restored).not.toBeNull();
  });

  it('frontière minuit : rien pour today + veille NON clôturée → on reprend la veille (date = veille)', () => {
    // Logge une série hier, persiste sous la date d'hier, rien aujourd'hui.
    let yesterdayState = mkState({ date: YESTERDAY });
    yesterdayState = captureReducer(yesterdayState, {
      type: 'log-set',
      exerciseId: 'bench-press',
      setId: 's1',
      set: set1,
    });
    persist(yesterdayState);

    const { date, restored } = resolveCaptureDate(upperA, TODAY);
    expect(date).toBe(YESTERDAY);
    expect(restored).not.toBeNull();
    // La date adoptée est celle de la veille : les ops continueront de viser la
    // bonne `performed_on`, et la série loggée hier est bien restaurée.
    expect((restored as CaptureState).date).toBe(YESTERDAY);
    expect(getProgress(restored as CaptureState, 'bench-press').sets).toHaveLength(1);
  });

  it('veille CLÔTURÉE → pas de restauration (capture vierge du jour)', () => {
    // Geste de clôture câblé (ADR 0009) : on persiste l'état d'hier puis le cache
    // est NETTOYÉ (clearPersisted). Le lendemain, plus rien à reprendre pour la
    // veille → on repart vierge sous today, jamais sur la séance close d'hier.
    let yesterdayState = mkState({ date: YESTERDAY });
    yesterdayState = captureReducer(yesterdayState, {
      type: 'log-set',
      exerciseId: 'bench-press',
      setId: 's1',
      set: set1,
    });
    persist(yesterdayState);
    clearPersisted(upperA, YESTERDAY);

    const { date, restored } = resolveCaptureDate(upperA, TODAY);
    expect(date).toBe(TODAY);
    expect(restored).toBeNull();
  });

  it('rien nulle part → capture vierge sous today (premier montage)', () => {
    const { date, restored } = resolveCaptureDate(upperA, TODAY);
    expect(date).toBe(TODAY);
    expect(restored).toBeNull();
  });
});

describe('clearOwnCaptureState (purge de la Déconnexion)', () => {
  beforeEach(() => {
    (globalThis as unknown as { localStorage: Storage }).localStorage =
      new IndexableMemoryStorage() as unknown as Storage;
    saveLocalAccount({ userId: 'user-a', email: 'a@exemple.com' });
  });

  it('retire la capture du compte reconnu et les états sans compte, garde celle d’un autre', () => {
    const put = (key: string, ownerId?: string) =>
      localStorage.setItem(
        `croustylift:capture:${key}`,
        JSON.stringify({ sessionId: key, ...(ownerId ? { ownerId } : {}) }),
      );
    put('seance-a:2026-11-23', 'user-a');
    put('seance-b:2026-11-22', 'user-b');
    put('seance-ancienne:2026-11-01');
    localStorage.setItem('croustylift:outbox', '[]');

    clearOwnCaptureState();

    expect(localStorage.getItem('croustylift:capture:seance-a:2026-11-23')).toBeNull();
    expect(localStorage.getItem('croustylift:capture:seance-ancienne:2026-11-01')).toBeNull();
    expect(localStorage.getItem('croustylift:capture:seance-b:2026-11-22')).not.toBeNull();
    // Rien d'autre que le préfixe capture n'est touché.
    expect(localStorage.getItem('croustylift:outbox')).toBe('[]');
  });
});

describe('persist, stockage plein', () => {
  beforeEach(() => {
    (globalThis as unknown as { localStorage: Storage }).localStorage =
      new IndexableMemoryStorage() as unknown as Storage;
    saveLocalAccount({ userId: 'user-a', email: 'a@exemple.com' });
  });

  it('le refus du stockage est signalé, puis levé dès qu’une sauvegarde passe', () => {
    const state = initialState(upperA, '2026-11-23');
    const store = localStorage as unknown as { setItem: (k: string, v: string) => void };
    const write = store.setItem.bind(localStorage);
    let full = true;
    store.setItem = (k, v) => {
      if (full && k.startsWith('croustylift:capture:')) throw new Error('QuotaExceededError');
      write(k, v);
    };

    persist(state);
    expect(capturePersistFailing()).toBe(true);

    full = false;
    persist(state);
    expect(capturePersistFailing()).toBe(false);
    expect(loadPersisted(upperA, '2026-11-23')?.executionId).toBe(state.executionId);
  });

  it('les copies de lecture cèdent la place à la séance en cours', () => {
    const state = initialState(upperA, '2026-11-23');
    const COPY = 'croustylift:readcache:user-a:exo-execs:e1';
    localStorage.setItem(COPY, 'copie');
    const store = localStorage as unknown as { setItem: (k: string, v: string) => void };
    const write = store.setItem.bind(localStorage);
    store.setItem = (k, v) => {
      // Plein tant que la copie de lecture occupe la place.
      if (localStorage.getItem(COPY) !== null) throw new Error('QuotaExceededError');
      write(k, v);
    };

    persist(state);

    expect(capturePersistFailing()).toBe(false);
    expect(localStorage.getItem(COPY)).toBeNull();
    expect(loadPersisted(upperA, '2026-11-23')?.executionId).toBe(state.executionId);
  });
});

// Séance retouchée en plein entraînement : l'exécution garde sa version de
// naissance (ADR 0021), la Capture doit recharger le template de CETTE version.
describe('version de séance de l’exécution adoptée', () => {
  beforeEach(() => {
    (globalThis as unknown as { localStorage: Storage }).localStorage =
      new IndexableMemoryStorage() as unknown as Storage;
    saveLocalAccount({ userId: 'user-a', email: 'a@exemple.com' });
  });

  const local = (extra: Partial<CaptureState> = {}): CaptureState => ({
    ...initialState(upperA, '2026-11-23'),
    executionId: 'exec-1',
    ...extra,
  });

  it('la version survit à la sauvegarde, à la restauration et à la fusion avec la base', () => {
    persist(local({ seanceVersionId: 'v1' }));
    const restored = loadPersisted(upperA, '2026-11-23');
    expect(restored?.seanceVersionId).toBe('v1');

    // La base hydrate sous la version courante que l'écran vient de charger.
    const fromBase = { ...hydratedState(upperA, {}, {}, '2026-11-23', 'exec-1'), seanceVersionId: 'v2' };
    expect(mergeProgress(fromBase, restored!).seanceVersionId).toBe('v1');
  });

  it('fusion avec un état local d’avant ce champ : la version de la base est gardée', () => {
    const fromBase = { ...hydratedState(upperA, {}, {}, '2026-11-23', 'exec-1'), seanceVersionId: 'v1' };
    expect(mergeProgress(fromBase, local()).seanceVersionId).toBe('v1');
  });

  it('état local qui porte sa version : c’est elle, même si le plan est passé en v2', () => {
    expect(
      adoptedVersionId({
        restored: local({ seanceVersionId: 'v1' }),
        pendingOps: [],
        today: { executionId: 'exec-1', seanceVersionId: 'v1' },
        currentVersionId: 'v2',
      }),
    ).toBe('v1');
  });

  it('état local d’avant ce champ : la version de sa création encore en file', () => {
    expect(
      adoptedVersionId({
        restored: local(),
        pendingOps: [
          { type: 'upsertExecution', id: 'autre', seanceVersionId: 'v9' },
          { type: 'upsertExecution', id: 'exec-1', seanceVersionId: 'v1' },
        ],
        today: null,
        currentVersionId: 'v2',
      }),
    ).toBe('v1');
  });

  it('état local d’avant ce champ, création déjà partie : la version lue en base pour la même exécution', () => {
    expect(
      adoptedVersionId({
        restored: local(),
        pendingOps: [],
        today: { executionId: 'exec-1', seanceVersionId: 'v1' },
        currentVersionId: 'v2',
      }),
    ).toBe('v1');
  });

  it('la version d’une AUTRE exécution rendue par la base ne s’applique pas à l’état local', () => {
    expect(
      adoptedVersionId({
        restored: local(),
        pendingOps: [],
        today: { executionId: 'exec-autre', seanceVersionId: 'v1' },
        currentVersionId: 'v2',
      }),
    ).toBe('v2');
  });

  it('sans état local : la version de l’exécution ouverte trouvée en base', () => {
    expect(
      adoptedVersionId({
        restored: null,
        pendingOps: [],
        today: { executionId: 'exec-1', seanceVersionId: 'v1' },
        currentVersionId: 'v2',
      }),
    ).toBe('v1');
  });

  it('séance neuve : la version courante', () => {
    expect(
      adoptedVersionId({ restored: null, pendingOps: [], today: null, currentVersionId: 'v2' }),
    ).toBe('v2');
  });

  it('persistedVersionIds liste les versions des séances en cours sur l’appareil', () => {
    persist(local({ seanceVersionId: 'v1' }));
    persist({ ...local({ seanceVersionId: 'v7' }), sessionId: 'autre-seance' });
    persist({ ...local(), sessionId: 'sans-version' });

    expect(persistedVersionIds().sort()).toEqual(['v1', 'v7']);
  });
});

describe('pruneStaleCaptureStates (séance oubliée sans clôture)', () => {
  beforeEach(() => {
    (globalThis as unknown as { localStorage: Storage }).localStorage =
      new IndexableMemoryStorage() as unknown as Storage;
    saveLocalAccount({ userId: 'user-a', email: 'a@exemple.com' });
  });

  const put = (date: string, ownerId = 'user-a') =>
    localStorage.setItem(
      `croustylift:capture:seance-1:${date}`,
      JSON.stringify({ sessionId: 'seance-1', date, ownerId }),
    );
  const has = (date: string) => localStorage.getItem(`croustylift:capture:seance-1:${date}`) !== null;

  it('garde le jour même et la veille (reprenables), retire les états plus anciens', () => {
    put('2026-11-23');
    put('2026-11-22');
    put('2026-11-21');
    put('2026-10-02');

    pruneStaleCaptureStates('2026-11-23');

    expect(has('2026-11-23')).toBe(true);
    expect(has('2026-11-22')).toBe(true);
    expect(has('2026-11-21')).toBe(false);
    expect(has('2026-10-02')).toBe(false);
  });

  it('ne touche pas à l’état d’un autre compte, même ancien', () => {
    put('2026-10-02', 'user-b');

    pruneStaleCaptureStates('2026-11-23');

    expect(has('2026-10-02')).toBe(true);
  });
});

// Exo ajouté ou remplacé en cours de séance (signalement utilisateur 3) : la
// disposition est un journal de gestes, persisté avec l'état, donc lié à son
// exécution. Sans lui, l'exo disparaissait au changement d'onglet.
describe('disposition de la séance (exos ajoutés ou remplacés)', () => {
  beforeEach(() => {
    (globalThis as unknown as { localStorage: Storage }).localStorage =
      new IndexableMemoryStorage() as unknown as Storage;
    saveLocalAccount({ userId: 'user-a', email: 'a@exemple.com' });
  });

  const curl = { exerciseId: 'curl', name: 'Curl', unilateral: true, primaryMuscles: ['biceps'] };
  const dips = { exerciseId: 'dips', name: 'Dips', unilateral: false, primaryMuscles: ['triceps'] };
  const edited = () => {
    let state: CaptureState = { ...initialState(upperA, '2026-11-23'), executionId: 'exec-1' };
    state = captureReducer(state, { type: 'edit-layout', edit: { kind: 'added', ...curl } });
    state = captureReducer(state, {
      type: 'edit-layout',
      edit: { kind: 'swapped', replaces: 'bench-press', ...dips },
    });
    return state;
  };

  it('le reducer enregistre les gestes dans l’ordre', () => {
    expect(edited().layout).toEqual([
      { kind: 'added', ...curl },
      { kind: 'swapped', replaces: 'bench-press', ...dips },
    ]);
  });

  it('la disposition survit à la sauvegarde et à la restauration', () => {
    persist(edited());
    expect(loadPersisted(upperA, '2026-11-23')?.layout).toEqual(edited().layout);
  });

  it('à la fusion avec la base, c’est la disposition de l’état local qui est gardée', () => {
    const fromBase = hydratedState(upperA, {}, {}, '2026-11-23', 'exec-1');
    expect(mergeProgress(fromBase, edited()).layout).toEqual(edited().layout);
    // L'état hydraté de la base seule n'en porte aucune.
    expect(fromBase.layout).toBeUndefined();
  });

  it('une nouvelle exécution (reset) repart sans disposition', () => {
    expect(captureReducer(edited(), { type: 'reset', executionId: 'exec-2' }).layout).toBeUndefined();
  });

  it('les entrées mal formées d’un état persisté sont écartées', () => {
    const key = 'croustylift:capture:' + upperA.id + ':2026-11-23';
    localStorage.setItem(
      key,
      JSON.stringify({
        ...edited(),
        layout: [
          { kind: 'added', ...curl },
          { kind: 'added', name: 'Sans id' },
          { kind: 'inconnu', ...dips },
          { kind: 'swapped', ...dips },
          'pas un objet',
        ],
      }),
    );

    // Un remplacement sans cible (`replaces`) n'est pas rejouable : écarté.
    expect(loadPersisted(upperA, '2026-11-23')?.layout).toEqual([{ kind: 'added', ...curl }]);
  });

  it('un état persisté avant ce champ se restaure sans disposition', () => {
    const state: CaptureState = { ...initialState(upperA, '2026-11-23'), executionId: 'exec-1' };
    persist(state);
    expect(loadPersisted(upperA, '2026-11-23')?.layout).toBeUndefined();
  });
});

// Reprise EN LIGNE d'une exécution que l'appareil tient déjà : la base a
// répondu, elle fait foi pour ses séries, et les opérations locales encore en
// attente s'appliquent par-dessus, par identifiant. La fusion « la liste la plus
// longue gagne » (mergeProgress) ne reste que le repli sans réponse de la base.
describe('reconcileProgress (la base fait foi, plus les écritures en attente)', () => {
  const set = (order: number, weightKg = 80) => ({ weightKg, reps: 8, rir: 2, order });
  const local = (ids: (string | null)[], skipped = false): Record<string, ExerciseProgress> => ({
    bench: { sets: ids.map((_, i) => set(i + 1)), setIds: ids, skipped },
  });
  const base = (ids: string[]): Record<string, HydratedProgress> =>
    ids.length === 0 ? {} : { bench: { sets: ids.map((_, i) => set(i + 1)), setIds: ids } };
  const ids = (progress: Record<string, ExerciseProgress>) => progress.bench?.setIds;

  it('série supprimée depuis le Journal, suppression acquittée : elle ne revient pas en Capture', () => {
    // Le cache local porte encore deux séries ; la base n'en rend plus qu'une et
    // rien n'attend en file. Avant : la liste la plus longue (le cache) gagnait.
    const progress = reconcileProgress(local(['s1', 's2']), base(['s1']), { pendingSetIds: [] });

    expect(ids(progress)).toEqual(['s1']);
    expect(nextSetOrder(progress.bench!, undefined)).toBe(2);
  });

  it('série loggée hors ligne, pas encore envoyée : elle reste (son insertion attend)', () => {
    const progress = reconcileProgress(local(['s1', 's2']), base(['s1']), { pendingSetIds: ['s2'] });

    expect(ids(progress)).toEqual(['s1', 's2']);
  });

  it('série écrite ailleurs (journal, autre appareil) : elle arrive, le rang suivant la compte', () => {
    const progress = reconcileProgress(local(['s1']), base(['s1', 's-ailleurs']), {
      pendingSetIds: [],
    });

    expect(ids(progress)).toEqual(['s1', 's-ailleurs']);
    expect(nextSetOrder(progress.bench!, undefined)).toBe(3);
  });

  it('toutes les séries d’un exo supprimées ailleurs : l’exo sort du réalisé', () => {
    expect(reconcileProgress(local(['s1']), base([]), { pendingSetIds: [] })).toEqual({});
  });

  it('un exo passé reste passé, même sans série', () => {
    const progress = reconcileProgress(local([], true), base([]), { pendingSetIds: [] });
    expect(progress.bench).toEqual({ sets: [], setIds: [], skipped: true });
  });

  it('une série locale sans id (cache d’ancien format) reste si la base n’a rien à ce rang', () => {
    const progress = reconcileProgress(local([null, null]), base(['s1']), { pendingSetIds: [] });
    // Rang 1 : la base l'a (avec son id). Rang 2 : inconnu de la base, gardé.
    expect(ids(progress)).toEqual(['s1', null]);
  });

  describe('réponse TARDIVE, appliquée à un tableau déjà monté', () => {
    it('une série loggée pendant le trajet de la lecture est gardée, même déjà acquittée', () => {
      // Au départ de la lecture : s1. Pendant le trajet : s2 loggée ET acquittée
      // (absente de la réponse, partie avant ; absente de la file, déjà vidée).
      const progress = reconcileProgress(local(['s1', 's2']), base(['s1']), {
        pendingSetIds: [],
        knownAtDeparture: ['s1'],
      });

      expect(ids(progress)).toEqual(['s1', 's2']);
    });

    it('une série annulée pendant le trajet ne revient pas, même si la réponse la porte encore', () => {
      const progress = reconcileProgress(local(['s1']), base(['s1', 's2']), {
        pendingSetIds: [],
        knownAtDeparture: ['s1', 's2'],
      });

      expect(ids(progress)).toEqual(['s1']);
    });

    it('la série écrite ailleurs avant le départ arrive : le rang suivant ne double pas', () => {
      // A tient s1. B a synchronisé s2. La lecture de A répond après 4 s.
      const progress = reconcileProgress(local(['s1']), base(['s1', 's2-de-b']), {
        pendingSetIds: [],
        knownAtDeparture: ['s1'],
      });

      expect(nextSetOrder(progress.bench!, undefined)).toBe(3);
    });
  });

  it('le reducer applique une réponse tardive sans toucher au reste de l’état', () => {
    const state: CaptureState = {
      ...initialState(upperA, '2026-11-23'),
      executionId: 'exec-1',
      activeExerciseId: 'bench',
      progress: local(['s1']),
      layout: [{ kind: 'added', exerciseId: 'curl', name: 'Curl', unilateral: false, primaryMuscles: [] }],
    };

    const next = captureReducer(state, {
      type: 'reconcile-progress',
      base: base(['s1', 's2-de-b']),
      pendingSetIds: [],
      knownAtDeparture: ['s1'],
    });

    expect(next.progress.bench?.setIds).toEqual(['s1', 's2-de-b']);
    expect(next.activeExerciseId).toBe('bench');
    expect(next.layout).toEqual(state.layout);
    expect(next.executionId).toBe('exec-1');
  });
});

// Une série ajoutée depuis le Journal à l'exécution en cours, encore en file :
// ni la base ni l'état de la Capture ne la portent. Le tableau repris l'ignorait
// et la série suivante prenait son rang.
describe('applyQueuedSets (écritures de séries en file appliquées au réalisé)', () => {
  const ps = (order: number, side?: 'left' | 'right') => ({ weightKg: 80, reps: 8, rir: 2, order, ...(side ? { side } : {}) });
  const insert = (id: string, setOrder: number, over: Record<string, unknown> = {}) =>
    ({ type: 'insertSet', id, executionId: 'exec-1', exerciseId: 'bench', setOrder, weightKg: 80, reps: 8, rir: 2, ...over }) as const;
  const tableau = (ids: (string | null)[], skipped = false) => ({
    bench: { sets: ids.map((_, i) => ps(i + 1)), setIds: ids, skipped },
  });
  const nextOrder = (progress: Record<string, { sets: { order: number }[] }>) =>
    Math.max(0, ...(progress.bench?.sets.map((s) => s.order) ?? [])) + 1;

  it('base muette (hors ligne) : la série du Journal entre, le rang suivant est le 3', () => {
    // La Capture a loggé le rang 1 ; le Journal a ajouté le rang 2, encore en file.
    const progress = applyQueuedSets(tableau(['s1']), [insert('s1', 1), insert('s2-journal', 2)], 'exec-1');
    expect(progress.bench?.setIds).toEqual(['s1', 's2-journal']);
    expect(progress.bench?.sets.map((s) => s.order)).toEqual([1, 2]);
    expect(nextOrder(progress)).toBe(3);
  });

  it('base répondue sans la série (pas encore envoyée) : elle entre aussi', () => {
    // Réalisé réconcilié avec la base : rang 1 seulement.
    const reconciled = reconcileProgress(tableau(['s1']), { bench: { sets: [ps(1)], setIds: ['s1'] } }, {
      pendingSetIds: ['s2-journal'],
    });
    const progress = applyQueuedSets(reconciled, [insert('s2-journal', 2)], 'exec-1');
    expect(progress.bench?.setIds).toEqual(['s1', 's2-journal']);
    expect(nextOrder(progress)).toBe(3);
  });

  it('tableau vide, série en file sur un exo jamais ouvert : l’exo apparaît avec sa série', () => {
    const progress = applyQueuedSets({}, [insert('s1-journal', 1, { exerciseId: 'squat' })], 'exec-1');
    expect(progress.squat).toEqual({ sets: [ps(1)], setIds: ['s1-journal'], skipped: false });
  });

  it('une série déjà au tableau n’est pas doublée, et rien ne change', () => {
    const before = tableau(['s1', 's2']);
    expect(applyQueuedSets(before, [insert('s1', 1), insert('s2', 2)], 'exec-1')).toBe(before);
  });

  it('une correction en file (même id, autres valeurs) remplace la série', () => {
    const progress = applyQueuedSets(tableau(['s1']), [insert('s1', 1, { weightKg: 85 })], 'exec-1');
    expect(progress.bench?.sets).toEqual([{ ...ps(1), weightKg: 85 }]);
    expect(progress.bench?.setIds).toEqual(['s1']);
  });

  it('ordre de la file : insérée puis supprimée, la série ne revient pas', () => {
    const before = tableau(['s1']);
    const progress = applyQueuedSets(before, [insert('s2', 2), { type: 'deleteSet', id: 's2' }], 'exec-1');
    expect(progress.bench?.setIds).toEqual(['s1']);
  });

  it('une suppression en file retire une série du tableau ; l’exo vide sort, sauf s’il est passé', () => {
    expect(applyQueuedSets(tableau(['s1']), [{ type: 'deleteSet', id: 's1' }], 'exec-1')).toEqual({});
    expect(applyQueuedSets(tableau(['s1'], true), [{ type: 'deleteSet', id: 's1' }], 'exec-1')).toEqual({
      bench: { sets: [], setIds: [], skipped: true },
    });
  });

  it('les séries d’une AUTRE exécution ne sont pas prises', () => {
    const before = tableau(['s1']);
    expect(applyQueuedSets(before, [insert('ailleurs', 2, { executionId: 'exec-2' })], 'exec-1')).toBe(before);
  });

  it('unilatéral : retri par rang puis gauche avant droite', () => {
    const before = {
      curl: { sets: [ps(1, 'left'), ps(2, 'left')], setIds: ['l1', 'l2'], skipped: false },
    };
    const progress = applyQueuedSets(before, [insert('r1', 1, { exerciseId: 'curl', side: 'right' })], 'exec-1');
    expect(progress.curl?.setIds).toEqual(['l1', 'r1', 'l2']);
    expect(progress.curl?.sets.map((s) => `${s.order}${s.side}`)).toEqual(['1left', '1right', '2left']);
  });

  it('une série sans id (cache d’ancien format) reste en place', () => {
    const progress = applyQueuedSets(tableau([null]), [insert('s2', 2)], 'exec-1');
    expect(progress.bench?.setIds).toEqual([null, 's2']);
  });
});

describe('reconcileDatedNotes (réponse tardive : le local prime, l’inconnu est adopté)', () => {
  const baseNote = { id: 'id-historique', body: 'écrite sous l’ancien client' };

  it('une note de la base que l’état local ignorait est adoptée, avec son id', () => {
    expect(reconcileDatedNotes({}, { bench: baseNote }, [])).toEqual({ bench: baseNote });
  });

  it('une édition locale est préservée, la base ne l’écrase pas', () => {
    const local = { bench: { id: 'id-local', body: 'en cours de saisie' } };
    const next = reconcileDatedNotes(local, { bench: baseNote }, []);
    expect(next).toBe(local);
  });

  it('une note vidée localement reste vidée (un effacement est une édition)', () => {
    const local = { bench: { id: 'id-local', body: '' } };
    expect(reconcileDatedNotes(local, { bench: baseNote }, [])).toBe(local);
  });

  it('une écriture de la note attend en file : la base, déjà périmée, n’est pas adoptée', () => {
    // Par exo (op actuelle) ou par id de note (op d'effacement d'un bundle antérieur).
    expect(reconcileDatedNotes({}, { bench: baseNote }, ['bench'])).toEqual({});
    expect(reconcileDatedNotes({}, { bench: baseNote }, ['id-historique'])).toEqual({});
  });

  it('chaque exo est jugé séparément', () => {
    const local = { bench: { id: 'id-local', body: 'la mienne' } };
    const next = reconcileDatedNotes(
      local,
      { bench: baseNote, squat: { id: 'n-squat', body: 'talons au sol' }, row: { id: 'n-row', body: 'x' } },
      ['row'],
    );
    expect(next).toEqual({
      bench: { id: 'id-local', body: 'la mienne' },
      squat: { id: 'n-squat', body: 'talons au sol' },
    });
  });

  it('rien à adopter : l’état local est rendu tel quel', () => {
    const local = { bench: { id: 'id-local', body: 'x' } };
    expect(reconcileDatedNotes(local, {}, [])).toBe(local);
  });

  it('le reducer réconcilie les notes avec les séries, sans toucher une note locale', () => {
    const state: CaptureState = {
      ...initialState(upperA, '2026-11-23'),
      executionId: 'exec-1',
      datedNotes: { bench: { id: 'id-local', body: 'en cours' } },
    };
    const next = captureReducer(state, {
      type: 'reconcile-progress',
      base: {},
      pendingSetIds: [],
      knownAtDeparture: [],
      datedNotes: { bench: baseNote, squat: { id: 'n-squat', body: 'talons au sol' } },
      pendingNoteKeys: [],
    });
    expect(next.datedNotes).toEqual({
      bench: { id: 'id-local', body: 'en cours' },
      squat: { id: 'n-squat', body: 'talons au sol' },
    });
  });

  it('une réponse tardive sans notes (ancienne forme de l’action) laisse les notes en place', () => {
    const state: CaptureState = {
      ...initialState(upperA, '2026-11-23'),
      datedNotes: { bench: { id: 'id-local', body: 'en cours' } },
    };
    const next = captureReducer(state, {
      type: 'reconcile-progress',
      base: {},
      pendingSetIds: [],
      knownAtDeparture: [],
    });
    expect(next.datedNotes).toBe(state.datedNotes);
  });
});

describe('isPristine (état abandonnable sans rien perdre)', () => {
  const fresh = (): CaptureState => initialState(upperA, '2026-11-23');

  it('séance neuve tout juste ouverte : intacte', () => {
    expect(isPristine(fresh())).toBe(true);
  });

  it('un exo ouvert (son brouillon a pu être réglé) : plus intacte', () => {
    expect(isPristine(captureReducer(fresh(), { type: 'open-exercise', exerciseId: 'bench-press' }))).toBe(false);
  });

  it('un exo ajouté ou remplacé : plus intacte', () => {
    const edited = captureReducer(fresh(), {
      type: 'edit-layout',
      edit: { kind: 'added', exerciseId: 'curl', name: 'Curl', unilateral: false, primaryMuscles: [] },
    });
    expect(isPristine(edited)).toBe(false);
  });

  it('un exo passé, une série ou une note : plus intacte', () => {
    expect(isPristine(captureReducer(fresh(), { type: 'skip-exercise', exerciseId: 'bench-press' }))).toBe(false);
    expect(
      isPristine(
        captureReducer(fresh(), {
          type: 'log-set',
          exerciseId: 'bench-press',
          setId: 's1',
          set: { weightKg: 80, reps: 8, rir: 2 },
        }),
      ),
    ).toBe(false);
    expect(
      isPristine(
        captureReducer(fresh(), { type: 'set-dated-note', exerciseId: 'bench-press', noteId: 'n1', body: 'x' }),
      ),
    ).toBe(false);
  });

  it('revenu au sélecteur sans rien avoir fait : de nouveau intacte', () => {
    let state = captureReducer(fresh(), { type: 'open-exercise', exerciseId: 'bench-press' });
    state = captureReducer(state, { type: 'back-to-picker' });
    expect(isPristine(state)).toBe(true);
  });
});
