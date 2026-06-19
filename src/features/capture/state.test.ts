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
  clearCaptureState,
  hydratedState,
  mergeProgress,
  loadPersisted,
  persist,
  clearPersisted,
  nextSetOrder,
  pendingSide,
  previousDayIso,
  resolveCaptureDate,
  resolveExerciseNoteSave,
  type CaptureState,
  type ExerciseProgress,
  type HydratedProgress,
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
    expect(p.sets[0].weightKg).toBe(28);
    expect(p.sets[1].weightKg).toBe(32);
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
});

// --- resolveExerciseNoteSave -------------------------------------------------
// Décision pure de sauvegarde de la NOTE D'INSTRUCTIONS d'un exo (issue #52),
// éditée sur place en Capture. Compare les corps NORMALISÉS pour éviter un appel
// réseau inutile et un faux « modifié » dû aux espaces de bord / fins de ligne.

describe('resolveExerciseNoteSave', () => {
  it('détecte un vrai changement et renvoie le corps normalisé', () => {
    const r = resolveExerciseNoteSave('Prise serrée.', 'Prise large.');
    expect(r.changed).toBe(true);
    expect(r.nextBody).toBe('Prise large.');
  });

  it('création depuis aucune note : changement, corps normalisé', () => {
    const r = resolveExerciseNoteSave('', '  Coudes rentrés.  ');
    expect(r.changed).toBe(true);
    expect(r.nextBody).toBe('Coudes rentrés.');
  });

  it('aucun changement quand seuls les espaces de bord diffèrent', () => {
    const r = resolveExerciseNoteSave('Prise serrée.', '  Prise serrée. ');
    expect(r.changed).toBe(false);
    expect(r.nextBody).toBe('Prise serrée.');
  });

  it('aucun changement quand seules les fins de ligne diffèrent (\\r\\n vs \\n)', () => {
    const r = resolveExerciseNoteSave('Ligne 1\nLigne 2', 'Ligne 1\r\nLigne 2');
    expect(r.changed).toBe(false);
  });

  it('vider une note existante : changement vers le corps vide (suppression)', () => {
    const r = resolveExerciseNoteSave('Prise serrée.', '   ');
    expect(r.changed).toBe(true);
    expect(r.nextBody).toBe('');
  });

  it('vide -> vide : aucun changement (rien à persister)', () => {
    const r = resolveExerciseNoteSave('', '   ');
    expect(r.changed).toBe(false);
    expect(r.nextBody).toBe('');
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

describe('resolveCaptureDate', () => {
  const TODAY = '2026-06-19';
  const YESTERDAY = '2026-06-18';

  beforeEach(() => {
    (globalThis as unknown as { localStorage: Storage }).localStorage =
      new IndexableMemoryStorage() as unknown as Storage;
  });

  it('cas NOMINAL : cache d’aujourd’hui présent → on adopte today (veille ignorée)', () => {
    // Une séance en cours du jour, ET un cache de la veille : today doit primer.
    persist(mkState({ date: TODAY }));
    persist(mkState({ date: YESTERDAY }));

    const { date, restored } = resolveCaptureDate(upperA, TODAY);
    expect(date).toBe(TODAY);
    expect(restored).not.toBeNull();
    expect((restored as CaptureState).date).toBe(TODAY);
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
