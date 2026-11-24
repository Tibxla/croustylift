// Quitter la séance en cours : « Changer de séance » quand rien n'est saisi,
// « Annuler la séance » (confirmée) sinon.
import { describe, expect, it } from 'vitest';
import { upperA } from './fixtures';
import { leaveSession, nothingEntered } from './session-gestures';
import { captureReducer, initialState, type CaptureState } from './state';

const fresh = (): CaptureState => ({ ...initialState(upperA, '2026-11-25'), executionId: 'exec-1' });
const log = (state: CaptureState, setId = 's1') =>
  captureReducer(state, { type: 'log-set', exerciseId: 'bench-press', setId, set: { weightKg: 80, reps: 8, rir: 2 } });
const added = { kind: 'added' as const, exerciseId: 'curl', name: 'Curl', unilateral: false, primaryMuscles: [] };

describe('nothingEntered (rien n’est saisi)', () => {
  it('séance tout juste lancée : rien', () => {
    expect(nothingEntered(fresh())).toBe(true);
  });

  it('ouvrir un exo ou le passer n’est pas une saisie', () => {
    const opened = captureReducer(fresh(), { type: 'open-exercise', exerciseId: 'bench-press' });
    expect(nothingEntered(opened)).toBe(true);
    expect(nothingEntered(captureReducer(opened, { type: 'skip-exercise', exerciseId: 'bench-press' }))).toBe(true);
  });

  it('une série loggée : quelque chose est saisi', () => {
    expect(nothingEntered(log(fresh()))).toBe(false);
  });

  it('série loggée puis annulée : plus rien de saisi', () => {
    const undone = captureReducer(log(fresh()), { type: 'undo-last-set', exerciseId: 'bench-press' });
    expect(nothingEntered(undone)).toBe(true);
  });

  it('une note du jour écrite compte ; une note vidée ne compte plus', () => {
    const noted = captureReducer(fresh(), { type: 'set-dated-note', exerciseId: 'bench-press', noteId: 'n1', body: 'épaule raide' });
    expect(nothingEntered(noted)).toBe(false);
    const emptied = captureReducer(noted, { type: 'set-dated-note', exerciseId: 'bench-press', noteId: 'n1', body: '  ' });
    expect(nothingEntered(emptied)).toBe(true);
  });

  it('un exo ajouté ou remplacé compte : dans le doute, on confirme', () => {
    expect(nothingEntered(captureReducer(fresh(), { type: 'edit-layout', edit: added }))).toBe(false);
  });
});

describe('leaveSession', () => {
  it('rien saisi, exécution jamais née : « changer », sans confirmation et sans aucune écriture', () => {
    expect(leaveSession(fresh(), { executionStarted: false })).toEqual({
      kind: 'change',
      needsConfirmation: false,
      executionId: 'exec-1',
      ops: [],
    });
  });

  it('des séries : « annuler », à confirmer, et l’exécution est supprimée avec ses exos nommés', () => {
    const plan = leaveSession(log(fresh()), { executionStarted: true });
    expect(plan).toEqual({
      kind: 'cancel',
      needsConfirmation: true,
      executionId: 'exec-1',
      ops: [{ type: 'deleteExecution', id: 'exec-1', exerciseIds: ['bench-press'] }],
    });
  });

  it('série loggée puis annulée : rien de saisi, mais l’exécution est née : « changer » la supprime quand même', () => {
    const undone = captureReducer(log(fresh()), { type: 'undo-last-set', exerciseId: 'bench-press' });
    const plan = leaveSession(undone, { executionStarted: true });
    expect(plan.kind).toBe('change');
    expect(plan.needsConfirmation).toBe(false);
    expect(plan.ops).toEqual([{ type: 'deleteExecution', id: 'exec-1', exerciseIds: ['bench-press'] }]);
  });

  it('note du jour vidée : rien de saisi, exécution née (la note l’a créée) : supprimée', () => {
    let state = captureReducer(fresh(), { type: 'set-dated-note', exerciseId: 'squat', noteId: 'n1', body: 'x' });
    state = captureReducer(state, { type: 'set-dated-note', exerciseId: 'squat', noteId: 'n1', body: '' });
    const plan = leaveSession(state, { executionStarted: true });
    expect(plan.kind).toBe('change');
    expect(plan.ops).toEqual([{ type: 'deleteExecution', id: 'exec-1', exerciseIds: ['squat'] }]);
  });

  it('exo ajouté sans série : « annuler », à confirmer ; rien à supprimer si l’exécution n’est pas née', () => {
    const state = captureReducer(fresh(), { type: 'edit-layout', edit: added });
    expect(leaveSession(state, { executionStarted: false })).toMatchObject({
      kind: 'cancel',
      needsConfirmation: true,
      ops: [],
    });
  });

  it('l’état dit qu’une exécution existe même si l’écran l’ignore : on la supprime', () => {
    // Séries présentes : l'exécution a forcément été enfilée, quoi que dise le drapeau.
    expect(leaveSession(log(fresh()), { executionStarted: false }).ops).toHaveLength(1);
  });
});
