// Logique PURE de la définition d'un exercice perso (sans React, sans Supabase).
//
// Modèle étendu (issue #33) : un exercice porte désormais
//   - `unilateral` : booléen (mouvement exécuté un côté à la fois) ;
//   - `primary_muscles` : LISTE de muscles principaux (>= 1), vocabulaire canonique
//     CONTEXT.md. PAS de muscle secondaire.
//
// Compat legacy : on conserve `muscle_group` (texte, un seul muscle) car d'autres
// modules le lisent encore (analyse, picker, affichage des lignes). Pour un exo
// créé via cette UI, `muscle_group` vaut le PREMIER muscle principal de la liste
// (l'ordre canonique garantit un choix stable et déterministe).
//
// Tout est ici déterministe et testable (cf. exercise-input.test.ts) ; la couche
// data.ts ne fait qu'appliquer `buildPersonalExerciseInsert` à l'insert Supabase.
import type { Database } from '../../lib/database.types';

/**
 * Vocabulaire canonique des 15 groupes musculaires (cf. CONTEXT.md).
 * Source unique : l'UI (filtre/sélecteur) et la validation l'importent d'ici.
 * L'ordre EST le tri canonique d'affichage et de sérialisation des sélections.
 */
export const MUSCLE_GROUPS = [
  'pectoraux',
  'avant épaule',
  'milieu épaule',
  'arrière épaule',
  'trapèzes',
  'dorsaux',
  'biceps',
  'triceps',
  'brachioradial',
  'abdominaux',
  'quadriceps',
  'ischio-jambiers',
  'adducteurs',
  'fessiers',
  'mollets',
] as const;

export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];

/** Vrai si `value` est l'un des 15 muscles canoniques. */
export function isMuscleGroup(value: string): value is MuscleGroup {
  return (MUSCLE_GROUPS as readonly string[]).includes(value);
}

/** Rang canonique d'un muscle (sa position dans MUSCLE_GROUPS). */
function canonicalRank(muscle: string): number {
  return (MUSCLE_GROUPS as readonly string[]).indexOf(muscle);
}

/** Trie une liste de muscles selon l'ordre canonique (sans muter l'entrée). */
function sortCanonical(muscles: string[]): string[] {
  return [...muscles].sort((a, b) => canonicalRank(a) - canonicalRank(b));
}

/**
 * Trie une liste de muscles selon l'ordre canonique de CONTEXT.md, sans muter
 * l'entrée. Robuste aux termes hors vocabulaire (rang -1) : on les renvoie en
 * FIN de liste (et non en tête comme un tri naïf sur l'indexOf), pour que
 * l'affichage des décomptes (issue #37) garde toujours les 15 muscles connus
 * dans leur ordre attendu. Source d'ordre unique, partagée par les deux UI.
 */
export function orderMusclesCanonical(muscles: string[]): string[] {
  const rank = (m: string) => {
    const r = canonicalRank(m);
    return r === -1 ? Number.POSITIVE_INFINITY : r;
  };
  return [...muscles].sort((a, b) => rank(a) - rank(b));
}

/**
 * Ajoute / retire `muscle` d'une sélection, en gardant la liste DÉDOUBLONNÉE et
 * triée par l'ordre canonique. Un terme hors vocabulaire est ignoré (la sélection
 * est seulement re-triée). Ne mute jamais `selection`.
 */
export function toggleMuscle(selection: string[], muscle: string): string[] {
  if (!isMuscleGroup(muscle)) return sortCanonical(selection);
  const present = selection.includes(muscle);
  const next = present
    ? selection.filter((m) => m !== muscle)
    : [...selection, muscle];
  return sortCanonical(next);
}

/** Entrée de création/édition d'un exo perso telle que saisie dans l'UI. */
export interface PersonalExerciseInput {
  name: string;
  /** Muscles principaux choisis (>= 1 attendu), vocabulaire canonique. */
  primaryMuscles: string[];
  /** Mouvement unilatéral. Défaut false (bilatéral). */
  unilateral?: boolean;
}

/** Muscles principaux retenus : canoniques uniquement, dédoublonnés, triés. */
function normalizeMuscles(primaryMuscles: string[]): string[] {
  const valid = primaryMuscles.filter(isMuscleGroup);
  return sortCanonical([...new Set(valid)]);
}

/**
 * Valide une saisie d'exo perso. Renvoie `null` si valide, sinon un message
 * d'erreur prêt à afficher (français, sans tiret long). Règles :
 *   - nom non vide (après trim) ;
 *   - au moins un muscle principal canonique.
 */
export function validatePersonalExercise(input: PersonalExerciseInput): string | null {
  if (input.name.trim().length === 0) return 'Donne un nom à l’exercice.';
  if (normalizeMuscles(input.primaryMuscles).length === 0) {
    return 'Choisis au moins un muscle principal.';
  }
  return null;
}

/**
 * Construit la row d'insert `exercises` à partir d'une saisie validée.
 * `owner_id` est OMIS (rempli par default auth.uid(), jamais écrit côté client).
 * `muscle_group` = premier muscle principal (ordre canonique) pour la compat.
 * Jette si la saisie est invalide (garde-fou : appeler validatePersonalExercise
 * avant pour un message utilisateur propre).
 */
export function buildPersonalExerciseInsert(
  input: PersonalExerciseInput,
): Database['public']['Tables']['exercises']['Insert'] {
  const error = validatePersonalExercise(input);
  if (error) throw new Error(error);

  const muscles = normalizeMuscles(input.primaryMuscles);
  return {
    name: input.name.trim(),
    muscle_group: muscles[0],
    primary_muscles: muscles,
    unilateral: input.unilateral ?? false,
  };
}
