import { describe, it, expect } from 'vitest';
import {
  FIELD_FLOOR,
  defaultFields,
  rangeToField,
  setMin,
  setMax,
  toggleMode,
  fieldToRange,
  rowsToPrescriptionInputs,
  rowsToPlannedExercises,
  moveRow,
  type FieldValue,
  type EditorRow,
} from './prescription-edit';

// Tests de caractérisation : ils figent le comportement RÉEL de la logique pure
// de l'éditeur (défauts produit, planchers, garde min ≤ max, mapping, move). Si
// un comportement change, ces tests doivent casser sciemment.

// Petite fabrique de ligne d'éditeur pour les tests de liste (move / mapping).
function row(over: Partial<EditorRow> = {}): EditorRow {
  return {
    rowId: 'r',
    exerciseId: 'ex',
    exerciseName: 'Exo',
    muscleGroup: 'groupe',
    primaryMuscles: ['pectoraux'],
    unilateral: false,
    sets: { mode: 'fixe', min: 3, max: 3 },
    reps: { mode: 'fourchette', min: 8, max: 12 },
    rir: { mode: 'fixe', min: 2, max: 2 },
    ...over,
  };
}

describe('defaultFields — défauts produit d un exo ajouté', () => {
  it('séries fixe 1, reps fourchette 5–10, RIR fixe 2', () => {
    expect(defaultFields()).toEqual({
      sets: { mode: 'fixe', min: 1, max: 1 },
      reps: { mode: 'fourchette', min: 5, max: 10 },
      rir: { mode: 'fixe', min: 2, max: 2 },
    });
  });

  it('renvoie un objet neuf à chaque appel (pas de référence partagée)', () => {
    const a = defaultFields();
    const b = defaultFields();
    expect(a.sets).not.toBe(b.sets);
    expect(a.reps).not.toBe(b.reps);
  });
});

describe('FIELD_FLOOR — planchers métier', () => {
  it('séries ≥ 1, reps ≥ 1, RIR ≥ 0', () => {
    expect(FIELD_FLOOR).toEqual({ sets: 1, reps: 1, rir: 0 });
  });
});

describe('rangeToField — déduction du mode au chargement', () => {
  it('min === max => fixe', () => {
    expect(rangeToField({ min: 3, max: 3 })).toEqual({ mode: 'fixe', min: 3, max: 3 });
  });

  it('min !== max => fourchette', () => {
    expect(rangeToField({ min: 8, max: 12 })).toEqual({
      mode: 'fourchette',
      min: 8,
      max: 12,
    });
  });
});

describe('setMin — plancher + garde min ≤ max (POUSSE le max)', () => {
  it('applique le plancher quand la saisie passe sous le plancher (séries)', () => {
    const field: FieldValue = { mode: 'fixe', min: 3, max: 3 };
    expect(setMin(field, 0, FIELD_FLOOR.sets)).toEqual({ mode: 'fixe', min: 1, max: 1 });
    expect(setMin(field, -5, FIELD_FLOOR.sets)).toEqual({ mode: 'fixe', min: 1, max: 1 });
  });

  it('RIR : plancher 0 (le min peut descendre à 0, pas en dessous)', () => {
    const field: FieldValue = { mode: 'fixe', min: 2, max: 2 };
    expect(setMin(field, 0, FIELD_FLOOR.rir)).toEqual({ mode: 'fixe', min: 0, max: 0 });
    expect(setMin(field, -3, FIELD_FLOOR.rir)).toEqual({ mode: 'fixe', min: 0, max: 0 });
  });

  it('mode fixe : max suit toujours min', () => {
    const field: FieldValue = { mode: 'fixe', min: 3, max: 3 };
    expect(setMin(field, 5, FIELD_FLOOR.sets)).toEqual({ mode: 'fixe', min: 5, max: 5 });
  });

  it('fourchette : min sous le max => max inchangé', () => {
    const field: FieldValue = { mode: 'fourchette', min: 8, max: 12 };
    expect(setMin(field, 9, FIELD_FLOOR.reps)).toEqual({
      mode: 'fourchette',
      min: 9,
      max: 12,
    });
  });

  it('fourchette : monter le min AU-DESSUS du max POUSSE le max au niveau du min', () => {
    const field: FieldValue = { mode: 'fourchette', min: 8, max: 12 };
    expect(setMin(field, 15, FIELD_FLOOR.reps)).toEqual({
      mode: 'fourchette',
      min: 15,
      max: 15,
    });
  });

  it('fourchette : min === max accepté (borne pincée)', () => {
    const field: FieldValue = { mode: 'fourchette', min: 8, max: 12 };
    expect(setMin(field, 12, FIELD_FLOOR.reps)).toEqual({
      mode: 'fourchette',
      min: 12,
      max: 12,
    });
  });
});

describe('setMax — plancher + garde min ≤ max (TIRE le min)', () => {
  it('mode fixe : pas de max indépendant, le champ est renvoyé tel quel', () => {
    const field: FieldValue = { mode: 'fixe', min: 3, max: 3 };
    expect(setMax(field, 10, FIELD_FLOOR.sets)).toBe(field);
  });

  it('fourchette : max au-dessus du min => min inchangé', () => {
    const field: FieldValue = { mode: 'fourchette', min: 8, max: 12 };
    expect(setMax(field, 15, FIELD_FLOOR.reps)).toEqual({
      mode: 'fourchette',
      min: 8,
      max: 15,
    });
  });

  it('fourchette : descendre le max SOUS le min TIRE le min vers le bas', () => {
    const field: FieldValue = { mode: 'fourchette', min: 8, max: 12 };
    expect(setMax(field, 5, FIELD_FLOOR.reps)).toEqual({
      mode: 'fourchette',
      min: 5,
      max: 5,
    });
  });

  it('fourchette : le plancher s applique d abord au max, puis le min est tiré au max', () => {
    // raw 0 sous le plancher reps (1) => max plancher = 1 ; min tiré à 1.
    const field: FieldValue = { mode: 'fourchette', min: 8, max: 12 };
    expect(setMax(field, 0, FIELD_FLOOR.reps)).toEqual({
      mode: 'fourchette',
      min: 1,
      max: 1,
    });
  });
});

describe('toggleMode — fixe ⇄ fourchette préserve la borne max', () => {
  it('fixe -> fourchette conserve le max précédemment saisi', () => {
    // Champ déjà passé en fourchette (max=12) repassé en fixe (max écrasé par min=8)
    // puis re-fourchette : le max d origine n est PAS retrouvé (fixe l a écrasé)…
    const fixeWithRememberedMax: FieldValue = { mode: 'fixe', min: 8, max: 12 };
    // …mais si le FieldValue garde encore max=12 (fixe a min<max), toggle le restaure.
    expect(toggleMode(fixeWithRememberedMax)).toEqual({
      mode: 'fourchette',
      min: 8,
      max: 12,
    });
  });

  it('fixe -> fourchette : si max < min (incohérent) le max est remonté au min', () => {
    const field: FieldValue = { mode: 'fixe', min: 10, max: 4 };
    expect(toggleMode(field)).toEqual({ mode: 'fourchette', min: 10, max: 10 });
  });

  it('fourchette -> fixe écrase le max par le min (valeur fixe = min courant)', () => {
    const field: FieldValue = { mode: 'fourchette', min: 8, max: 12 };
    expect(toggleMode(field)).toEqual({ mode: 'fixe', min: 8, max: 8 });
  });

  it('aller-retour fourchette -> fixe -> fourchette PERD le max (écrasé en fixe)', () => {
    // Caractérisation : le max n est préservé QUE tant qu on ne repasse pas par fixe.
    const start: FieldValue = { mode: 'fourchette', min: 8, max: 12 };
    const asFixe = toggleMode(start); // { fixe, 8, 8 }
    const back = toggleMode(asFixe); // { fourchette, 8, 8 } — max=12 perdu
    expect(back).toEqual({ mode: 'fourchette', min: 8, max: 8 });
  });
});

describe('fieldToRange — aplatissement', () => {
  it('fixe => min === max (le max est ignoré)', () => {
    expect(fieldToRange({ mode: 'fixe', min: 3, max: 99 })).toEqual({ min: 3, max: 3 });
  });

  it('fourchette => min/max conservés', () => {
    expect(fieldToRange({ mode: 'fourchette', min: 8, max: 12 })).toEqual({
      min: 8,
      max: 12,
    });
  });
});

describe('rowsToPrescriptionInputs — mapping vers PrescriptionInput[]', () => {
  it('réassigne position 0..n-1 selon l ordre courant et aplatit fixe en min===max', () => {
    const rows: EditorRow[] = [
      row({
        rowId: 'a',
        exerciseId: 'ex-a',
        sets: { mode: 'fixe', min: 3, max: 3 },
        reps: { mode: 'fourchette', min: 8, max: 12 },
        rir: { mode: 'fixe', min: 2, max: 2 },
      }),
      row({
        rowId: 'b',
        exerciseId: 'ex-b',
        sets: { mode: 'fourchette', min: 3, max: 5 },
        reps: { mode: 'fixe', min: 6, max: 6 },
        rir: { mode: 'fourchette', min: 0, max: 2 },
      }),
    ];
    expect(rowsToPrescriptionInputs(rows)).toEqual([
      {
        exerciseId: 'ex-a',
        position: 0,
        sets: { min: 3, max: 3 },
        reps: { min: 8, max: 12 },
        rir: { min: 2, max: 2 },
      },
      {
        exerciseId: 'ex-b',
        position: 1,
        sets: { min: 3, max: 5 },
        reps: { min: 6, max: 6 },
        rir: { min: 0, max: 2 },
      },
    ]);
  });

  it('liste vide => []', () => {
    expect(rowsToPrescriptionInputs([])).toEqual([]);
  });

  it('un champ fixe avec max résiduel != min est bien aplati (min === max)', () => {
    const rows = [row({ exerciseId: 'ex-x', sets: { mode: 'fixe', min: 4, max: 9 } })];
    const out = rowsToPrescriptionInputs(rows);
    expect(out[0]!.sets).toEqual({ min: 4, max: 4 });
  });
});

describe('rowsToPlannedExercises — mapping vers le décompte PRÉVU (issues #37, #60)', () => {
  it('porte unilateral + muscles, et aplatit séries ET reps en fourchette (reps pour la pondération #60)', () => {
    const rows: EditorRow[] = [
      row({
        exerciseId: 'ex-a',
        primaryMuscles: ['pectoraux', 'triceps'],
        unilateral: false,
        sets: { mode: 'fourchette', min: 3, max: 4 },
        reps: { mode: 'fourchette', min: 8, max: 12 },
      }),
      row({
        exerciseId: 'ex-b',
        primaryMuscles: ['quadriceps'],
        unilateral: true,
        sets: { mode: 'fixe', min: 3, max: 3 },
        reps: { mode: 'fixe', min: 6, max: 6 },
      }),
    ];
    expect(rowsToPlannedExercises(rows)).toEqual([
      {
        unilateral: false,
        primaryMuscles: ['pectoraux', 'triceps'],
        sets: { min: 3, max: 4 },
        reps: { min: 8, max: 12 },
      },
      {
        unilateral: true,
        primaryMuscles: ['quadriceps'],
        sets: { min: 3, max: 3 },
        reps: { min: 6, max: 6 },
      },
    ]);
  });

  it('un champ fixe avec max résiduel est aplati (min === max), comme à la sauvegarde', () => {
    const rows = [row({ sets: { mode: 'fixe', min: 4, max: 9 } })];
    expect(rowsToPlannedExercises(rows)[0]!.sets).toEqual({ min: 4, max: 4 });
  });

  it('liste vide => []', () => {
    expect(rowsToPlannedExercises([])).toEqual([]);
  });
});

describe('moveRow — réordonnancement, bornes du tableau', () => {
  const base: EditorRow[] = [
    row({ rowId: 'a', exerciseId: 'a' }),
    row({ rowId: 'b', exerciseId: 'b' }),
    row({ rowId: 'c', exerciseId: 'c' }),
  ];

  it('descend un élément (direction +1)', () => {
    const out = moveRow(base, 0, 1);
    expect(out.map((r) => r.rowId)).toEqual(['b', 'a', 'c']);
  });

  it('monte un élément (direction -1)', () => {
    const out = moveRow(base, 2, -1);
    expect(out.map((r) => r.rowId)).toEqual(['a', 'c', 'b']);
  });

  it('renvoie une copie immuable (n altère pas l entrée)', () => {
    const out = moveRow(base, 0, 1);
    expect(out).not.toBe(base);
    expect(base.map((r) => r.rowId)).toEqual(['a', 'b', 'c']);
  });

  it('borne haute : descendre le dernier ne sort pas du tableau (renvoie la même réf)', () => {
    const out = moveRow(base, 2, 1);
    expect(out).toBe(base);
  });

  it('borne basse : monter le premier ne sort pas du tableau (renvoie la même réf)', () => {
    const out = moveRow(base, 0, -1);
    expect(out).toBe(base);
  });
});
