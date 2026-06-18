// Édition de la séance à la volée : ajout / swap d'un exo hors template (issue #36).
//
// Logique PURE : on manipule la Session en mémoire (jamais la base, jamais le
// template versionné). Les déviations (exo ajouté / remplacé) sont DÉRIVÉES par
// diff entre la liste réelle et le template d'origine (cf. ADR 0002).
import { describe, it, expect } from 'vitest';
import type { Session, SessionExercise } from './fixtures';
import {
  addExercise,
  swapExercise,
  deriveExerciseDeviations,
  templateExerciseIds,
} from './session-edit';

// --- Fabriques ---------------------------------------------------------------

const mkExercise = (id: string, name: string): SessionExercise => ({
  exerciseId: id,
  name,
  prescription: { sets: { min: 3, max: 4 }, reps: { min: 8, max: 12 }, rir: { min: 1, max: 2 } },
  reference: null,
  perExerciseNote: '',
});

const baseSession = (): Session => ({
  id: 'session-1',
  name: 'Upper A',
  exercises: [mkExercise('bench-press', 'Développé couché'), mkExercise('seated-row', 'Tirage')],
});

// --- templateExerciseIds -----------------------------------------------------

describe('templateExerciseIds', () => {
  it('capture les ids du template dans l’ordre, pour servir de référence au diff', () => {
    expect(templateExerciseIds(baseSession())).toEqual(['bench-press', 'seated-row']);
  });
});

// --- addExercise -------------------------------------------------------------

describe('addExercise', () => {
  it('ajoute l’exo à la fin de la séance', () => {
    const next = addExercise(baseSession(), mkExercise('curl', 'Curl biceps'));
    expect(next.exercises.map((e) => e.exerciseId)).toEqual([
      'bench-press',
      'seated-row',
      'curl',
    ]);
  });

  it('marque l’exo ajouté avec origin "added"', () => {
    const next = addExercise(baseSession(), mkExercise('curl', 'Curl biceps'));
    const added = next.exercises.find((e) => e.exerciseId === 'curl');
    expect(added?.origin).toBe('added');
  });

  it('ne mute pas la séance d’origine (immutabilité)', () => {
    const session = baseSession();
    addExercise(session, mkExercise('curl', 'Curl biceps'));
    expect(session.exercises).toHaveLength(2);
  });

  it('est sans effet si l’exo est déjà dans la séance (pas de doublon)', () => {
    const next = addExercise(baseSession(), mkExercise('bench-press', 'Développé couché'));
    expect(next.exercises.map((e) => e.exerciseId)).toEqual(['bench-press', 'seated-row']);
  });
});

// --- swapExercise ------------------------------------------------------------

describe('swapExercise', () => {
  it('remplace l’exo cible par le nouvel exo, à la même position', () => {
    const next = swapExercise(baseSession(), 'bench-press', mkExercise('dip', 'Dips'));
    expect(next.exercises.map((e) => e.exerciseId)).toEqual(['dip', 'seated-row']);
  });

  it('marque le remplaçant avec origin "swapped" et garde la trace de l’exo remplacé', () => {
    const next = swapExercise(baseSession(), 'bench-press', mkExercise('dip', 'Dips'));
    const dip = next.exercises.find((e) => e.exerciseId === 'dip');
    expect(dip?.origin).toBe('swapped');
    expect(dip?.swappedFrom).toBe('bench-press');
  });

  it('ne mute pas la séance d’origine', () => {
    const session = baseSession();
    swapExercise(session, 'bench-press', mkExercise('dip', 'Dips'));
    expect(session.exercises.map((e) => e.exerciseId)).toEqual(['bench-press', 'seated-row']);
  });

  it('est sans effet si l’exo cible est absent de la séance', () => {
    const next = swapExercise(baseSession(), 'inexistant', mkExercise('dip', 'Dips'));
    expect(next.exercises.map((e) => e.exerciseId)).toEqual(['bench-press', 'seated-row']);
  });
});

// --- deriveExerciseDeviations ------------------------------------------------

describe('deriveExerciseDeviations', () => {
  it('aucune déviation quand la séance est restée le template d’origine', () => {
    const template = templateExerciseIds(baseSession());
    expect(deriveExerciseDeviations(template, baseSession())).toEqual([]);
  });

  it('dérive un "added" pour un exo hors template', () => {
    const template = templateExerciseIds(baseSession());
    const session = addExercise(baseSession(), mkExercise('curl', 'Curl biceps'));
    expect(deriveExerciseDeviations(template, session)).toEqual([
      { kind: 'added', exerciseId: 'curl', name: 'Curl biceps' },
    ]);
  });

  it('dérive un "swapped" (avec l’exo remplacé) pour un exo échangé', () => {
    const template = templateExerciseIds(baseSession());
    const session = swapExercise(baseSession(), 'bench-press', mkExercise('dip', 'Dips'));
    expect(deriveExerciseDeviations(template, session)).toEqual([
      { kind: 'swapped', exerciseId: 'dip', name: 'Dips', replacedExerciseId: 'bench-press' },
    ]);
  });

  it('cumule plusieurs déviations dans l’ordre de la séance', () => {
    const template = templateExerciseIds(baseSession());
    let session = swapExercise(baseSession(), 'seated-row', mkExercise('pulldown', 'Tirage vertical'));
    session = addExercise(session, mkExercise('curl', 'Curl biceps'));
    expect(deriveExerciseDeviations(template, session)).toEqual([
      {
        kind: 'swapped',
        exerciseId: 'pulldown',
        name: 'Tirage vertical',
        replacedExerciseId: 'seated-row',
      },
      { kind: 'added', exerciseId: 'curl', name: 'Curl biceps' },
    ]);
  });
});
