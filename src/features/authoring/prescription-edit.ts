// Logique PURE de l'éditeur de prescriptions (sans React, sans Supabase) — la
// partie testable de SeanceEditor. On garde ici : le modèle d'état éditable, les
// défauts produit, la garde min ≤ max et le mapping vers PrescriptionInput[].
//
// Décisions (cf. brief) :
//   - Une prescription se saisit en 3 champs (séries, reps, RIR), chacun en mode
//     « fixe » (un Stepper, min === max) ou « fourchette » (deux Steppers, min/max).
//     On garde donc en mémoire à la fois le mode ET min/max pour ne pas perdre la
//     borne max quand on repasse en fixe puis re-fourchette.
//   - Planchers métier : séries min ≥ 1, reps min ≥ 1, RIR min ≥ 0.
//   - Défaut d'un exo ajouté : séries fixe 3, reps fourchette 8 à 12, RIR fixe 2.
import type { PrescriptionInput, RangeInput } from './data';
import type { PlannedExercise } from '../../domain/set-count';

/** Les trois grandeurs prescrites. Sert de clé pour les planchers métier. */
export type FieldKey = 'sets' | 'reps' | 'rir';

/** Plancher de la borne min de chaque grandeur (cf. contraintes produit). */
export const FIELD_FLOOR: Record<FieldKey, number> = {
  sets: 1,
  reps: 1,
  rir: 0,
};

/** Un champ saisissable : son mode (fixe/fourchette) et ses bornes min/max. */
export interface FieldValue {
  mode: 'fixe' | 'fourchette';
  min: number;
  max: number;
}

/** Une ligne d'exo prescrit telle qu'éditée. `rowId` est une clé React stable. */
export interface EditorRow {
  /** Identité de ligne, stable même si l'exo n'a pas (encore) d'id DB distinct. */
  rowId: string;
  exerciseId: string;
  exerciseName: string;
  muscleGroup: string;
  /**
   * Muscles principaux de l'exo (LISTE, issue #33), vocabulaire canonique. Sert
   * au décompte PRÉVU des séries par muscle (issue #37). Vide si l'exo legacy
   * n'a pas (encore) de `primary_muscles` rempli.
   */
  primaryMuscles: string[];
  /** Mouvement unilatéral (issue #33) : pèse double au décompte total (issue #37). */
  unilateral: boolean;
  sets: FieldValue;
  reps: FieldValue;
  rir: FieldValue;
}

/** Prescription par défaut d'un exo fraîchement ajouté (cf. brief). */
export function defaultFields(): { sets: FieldValue; reps: FieldValue; rir: FieldValue } {
  return {
    sets: { mode: 'fixe', min: 1, max: 1 },
    reps: { mode: 'fourchette', min: 5, max: 10 },
    rir: { mode: 'fixe', min: 2, max: 2 },
  };
}

/** Une RangeInput chargée -> FieldValue : mode déduit (min === max => fixe). */
export function rangeToField(range: RangeInput): FieldValue {
  return {
    mode: range.min === range.max ? 'fixe' : 'fourchette',
    min: range.min,
    max: range.max,
  };
}

/**
 * Pose la borne `min`, plancher métier appliqué, et garantit min ≤ max : si le
 * nouveau min dépasse max, on POUSSE max au niveau du min (plutôt que de refuser
 * la saisie). En mode fixe, max suit toujours min.
 */
export function setMin(field: FieldValue, raw: number, floor: number): FieldValue {
  const min = Math.max(floor, raw);
  if (field.mode === 'fixe') return { ...field, min, max: min };
  return { ...field, min, max: Math.max(min, field.max) };
}

/**
 * Pose la borne `max` (fourchette uniquement), et garantit min ≤ max : si le
 * nouveau max passe sous min, on TIRE min vers le bas (en respectant le plancher).
 */
export function setMax(field: FieldValue, raw: number, floor: number): FieldValue {
  if (field.mode === 'fixe') return field; // pas de max indépendant en fixe.
  const max = Math.max(floor, raw);
  return { ...field, max, min: Math.min(field.min, max) };
}

/**
 * Bascule le mode d'un champ. fixe -> fourchette conserve min/max (max ≥ min
 * garanti). fourchette -> fixe écrase max par min (la valeur fixe = le min courant).
 */
export function toggleMode(field: FieldValue): FieldValue {
  if (field.mode === 'fixe') {
    return { mode: 'fourchette', min: field.min, max: Math.max(field.min, field.max) };
  }
  return { mode: 'fixe', min: field.min, max: field.min };
}

/** Un FieldValue -> la RangeInput envoyée à la DB (fixe => min === max). */
export function fieldToRange(field: FieldValue): RangeInput {
  return field.mode === 'fixe'
    ? { min: field.min, max: field.min }
    : { min: field.min, max: field.max };
}

/**
 * Mappe l'état éditable (liste ordonnée) vers les PrescriptionInput à sauver :
 * `position` réassignée 0..n-1 selon l'ordre courant, fourchettes aplaties.
 */
export function rowsToPrescriptionInputs(rows: EditorRow[]): PrescriptionInput[] {
  return rows.map((row, index) => ({
    exerciseId: row.exerciseId,
    position: index,
    sets: fieldToRange(row.sets),
    reps: fieldToRange(row.reps),
    rir: fieldToRange(row.rir),
  }));
}

/**
 * Mappe l'état éditable vers les `PlannedExercise` du décompte PRÉVU (issues #37
 * et #60) : pour chaque ligne, son drapeau unilatéral, ses muscles principaux,
 * sa fourchette de séries et sa fourchette de reps prescrites (fixe = min === max,
 * via `fieldToRange`). Le décompte pondère par `reps.min` (cf. set-count.ts). Pur,
 * réutilise le même aplatissement de champ que la sauvegarde — pas de divergence
 * entre ce qui est compté et ce qui est sauvé.
 */
export function rowsToPlannedExercises(rows: EditorRow[]): PlannedExercise[] {
  return rows.map((row) => ({
    unilateral: row.unilateral,
    primaryMuscles: row.primaryMuscles,
    sets: fieldToRange(row.sets),
    reps: fieldToRange(row.reps),
  }));
}

/** Échange deux éléments d'une liste (réordonnancement ↑/↓), copie immuable. */
export function moveRow(rows: EditorRow[], index: number, direction: -1 | 1): EditorRow[] {
  const target = index + direction;
  if (target < 0 || target >= rows.length) return rows;
  const next = rows.slice();
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
