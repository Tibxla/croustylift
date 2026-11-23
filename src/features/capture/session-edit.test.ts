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
  layoutEditOf,
  replayLayout,
  templateExerciseIds,
} from './session-edit';
import type { LayoutEdit } from './state';

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

// --- Rejeu de la disposition au remontage (signalement utilisateur 3) ----------

describe('replayLayout', () => {
  const curl = mkExercise('curl', 'Curl');
  const dips = mkExercise('dips', 'Dips');
  const catalog: Record<string, SessionExercise> = {
    curl,
    dips,
    'bench-press': mkExercise('bench-press', 'Développé couché'),
  };
  const resolve = (edit: LayoutEdit) => catalog[edit.exerciseId] ?? null;
  const ids = (session: Session) => session.exercises.map((e) => e.exerciseId);

  /** Joue les gestes en direct, comme l'écran, et rend la séance et son journal. */
  function live(gestures: [SessionExercise, string?][]): { session: Session; layout: LayoutEdit[] } {
    let session = baseSession();
    const layout: LayoutEdit[] = [];
    for (const [exercise, replaces] of gestures) {
      session = replaces ? swapExercise(session, replaces, exercise) : addExercise(session, exercise);
      layout.push(layoutEditOf(exercise, replaces));
    }
    return { session, layout };
  }

  it('sans geste : le template tel quel', () => {
    expect(replayLayout(baseSession(), [], resolve)).toEqual(baseSession());
  });

  it('un exo ajouté revient à la fin, marqué ajouté', () => {
    const { session, layout } = live([[curl]]);

    const replayed = replayLayout(baseSession(), layout, resolve);

    expect(replayed).toEqual(session);
    expect(ids(replayed)).toEqual(['bench-press', 'seated-row', 'curl']);
    expect(replayed.exercises[2]?.origin).toBe('added');
  });

  it('un exo remplacé revient à la place de celui qu’il remplace', () => {
    const { session, layout } = live([[dips, 'bench-press']]);

    const replayed = replayLayout(baseSession(), layout, resolve);

    expect(replayed).toEqual(session);
    expect(ids(replayed)).toEqual(['dips', 'seated-row']);
    expect(replayed.exercises[0]).toMatchObject({ origin: 'swapped', swappedFrom: 'bench-press' });
  });

  it('A remplacé par B puis A réajouté : A garde sa place d’ajout (il ne disparaît pas)', () => {
    const { session, layout } = live([[dips, 'bench-press'], [catalog['bench-press']!]]);

    const replayed = replayLayout(baseSession(), layout, resolve);

    expect(replayed).toEqual(session);
    expect(ids(replayed)).toEqual(['dips', 'seated-row', 'bench-press']);
  });

  it('plusieurs gestes : même liste que le direct', () => {
    const { session, layout } = live([[curl], [dips, 'seated-row']]);
    expect(replayLayout(baseSession(), layout, resolve)).toEqual(session);
  });

  it('les déviations se dérivent toujours du template seul', () => {
    const { layout } = live([[curl], [dips, 'bench-press']]);
    const replayed = replayLayout(baseSession(), layout, resolve);

    expect(deriveExerciseDeviations(templateExerciseIds(baseSession()), replayed)).toEqual([
      { kind: 'swapped', exerciseId: 'dips', name: 'Dips', replacedExerciseId: 'bench-press' },
      { kind: 'added', exerciseId: 'curl', name: 'Curl' },
    ]);
  });

  it('un exo ajouté entré au plan depuis : la ligne du template l’emporte, pas de doublon', () => {
    const template: Session = {
      ...baseSession(),
      exercises: [...baseSession().exercises, mkExercise('curl', 'Curl (au plan)')],
    };

    const replayed = replayLayout(template, [layoutEditOf(curl)], resolve);

    expect(ids(replayed)).toEqual(['bench-press', 'seated-row', 'curl']);
    expect(replayed.exercises[2]?.name).toBe('Curl (au plan)');
    expect(replayed.exercises[2]?.origin).toBeUndefined();
  });

  it('un remplaçant déjà présent dans le template ne donne pas deux fois le même exo', () => {
    const template: Session = {
      ...baseSession(),
      exercises: [...baseSession().exercises, dips],
    };

    const replayed = replayLayout(template, [layoutEditOf(dips, 'bench-press')], resolve);

    expect(ids(replayed)).toEqual(['bench-press', 'seated-row', 'dips']);
  });

  it('un remplacement dont la cible a quitté le plan devient un ajout', () => {
    const template: Session = { ...baseSession(), exercises: [mkExercise('seated-row', 'Tirage')] };

    const replayed = replayLayout(template, [layoutEditOf(dips, 'bench-press')], resolve);

    expect(ids(replayed)).toEqual(['seated-row', 'dips']);
    expect(replayed.exercises[1]?.origin).toBe('added');
  });

  it('un exo dont la lecture a échoué est laissé de côté à ce montage, les autres reviennent', () => {
    const { layout } = live([[curl], [dips, 'bench-press']]);

    const replayed = replayLayout(baseSession(), layout, (edit) =>
      edit.exerciseId === 'curl' ? null : resolve(edit),
    );

    expect(ids(replayed)).toEqual(['dips', 'seated-row']);
  });

  it('layoutEditOf garde de quoi reconstruire l’exo sans relire le catalogue', () => {
    expect(
      layoutEditOf({ ...curl, unilateral: true, primaryMuscles: ['biceps'] }, 'bench-press'),
    ).toEqual({
      kind: 'swapped',
      exerciseId: 'curl',
      name: 'Curl',
      unilateral: true,
      primaryMuscles: ['biceps'],
      replaces: 'bench-press',
    });
  });
});
