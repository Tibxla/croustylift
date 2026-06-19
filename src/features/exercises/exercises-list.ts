// Logique PURE de la liste des exercices (onglet « Exercices », issue #49).
//
// Sans React ni Supabase : sépare le catalogue en exos de BASE (lecture seule)
// et exos PERSO (éditables), applique la recherche par nom et le tri français.
// Source unique de cette logique, testée (cf. exercises-list.test.ts).
//
// Rappel CONTEXT.md : un exo de base a owner_id null (catalogue commun) ; un exo
// perso a owner_id = auth.uid(). On ne FILTRE jamais sur owner_id côté client (la
// RLS scope déjà tout au user) ; owner_id ne sert ici qu'à classer base/perso.
import type { Database } from '../../lib/database.types';
import { foldAccents } from '../../domain/text';

type ExerciseRow = Database['public']['Tables']['exercises']['Row'];

/** Un exo réduit à ce dont l'onglet a besoin (forme camelCase, repliée). */
export interface ListExercise {
  id: string;
  name: string;
  /** null = exo de base (lecture seule) ; non nul = exo perso de l'user. */
  ownerId: string | null;
  /** Groupe musculaire legacy (1er muscle principal), pour l'affichage compact. */
  muscleGroup: string;
  /** Muscles principaux canoniques (issue #33). */
  primaryMuscles: string[];
  /** Mouvement unilatéral (issue #33). */
  unilateral: boolean;
}

/** Vrai si l'exo est PERSO (éditable) : owner_id non nul. */
export function isPersonalExercise(ownerId: string | null): boolean {
  return ownerId !== null;
}

/** Mappe une row `exercises` vers la forme liste, avec replis sûrs (legacy). */
export function toListExercise(row: ExerciseRow): ListExercise {
  return {
    id: row.id,
    name: row.name,
    ownerId: row.owner_id,
    muscleGroup: row.muscle_group,
    primaryMuscles: row.primary_muscles ?? [],
    unilateral: row.unilateral ?? false,
  };
}

/** Tri français stable par nom, insensible à la casse et aux accents primaires. */
function byNameFr(a: ListExercise, b: ListExercise): number {
  return a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' });
}

/**
 * Sépare le catalogue en deux groupes (base / perso) après application de la
 * recherche par nom (trim + insensible à la casse ET aux accents, via
 * foldAccents). Chaque groupe est trié par nom (ordre français). Une requête
 * vide ne filtre rien.
 */
export function filterExercises(
  catalogue: ListExercise[],
  query: string,
): { base: ListExercise[]; personal: ListExercise[] } {
  const q = foldAccents(query.trim());
  const matched = q
    ? catalogue.filter((e) => foldAccents(e.name).includes(q))
    : catalogue;

  const base = matched.filter((e) => !isPersonalExercise(e.ownerId)).sort(byNameFr);
  const personal = matched.filter((e) => isPersonalExercise(e.ownerId)).sort(byNameFr);
  return { base, personal };
}
