// Couche d'accès Supabase des OVERRIDES d'exos de base (issue #50).
//
// Un exo de BASE (owner_id null) est commun à tous : on ne l'édite jamais. Pour
// qu'un user le personnalise (nom, unilatéral, muscles principaux), on stocke un
// override par (user, exo) dans `exercise_overrides`. La RÈGLE de fusion vit dans
// le domaine pur (domain/exercise-override.ts) ; ce module ne fait que LIRE/ÉCRIRE
// les overrides et ADAPTER le snake_case DB <-> la forme camelCase du domaine.
//
// Conventions DB (cf. ADR 0003 + migration 0007) :
//   - user_id se remplit tout seul (default auth.uid()) — on ne l'écrit JAMAIS.
//   - RLS scope déjà tout à l'user connecté ; pas de filtre user_id côté client.
//   - upsert par (user_id, exercise_id) : ré-éditer écrase l'unique ligne.
import { supabase } from '../../lib/supabase';
import type { Database } from '../../lib/database.types';
import {
  diffExerciseOverride,
  isOverridden,
  mergeExerciseOverride,
  type ExerciseOverrideValues,
  type ExerciseShared,
} from '../../domain/exercise-override';

type ExerciseRow = Database['public']['Tables']['exercises']['Row'];
type OverrideRow = Database['public']['Tables']['exercise_overrides']['Row'];

export type { ExerciseOverrideValues } from '../../domain/exercise-override';

/** Adapte une ligne `exercise_overrides` (snake_case, nullable) vers la forme du domaine. */
function rowToOverrideValues(row: OverrideRow): ExerciseOverrideValues {
  return {
    name: row.name,
    unilateral: row.unilateral,
    primaryMuscles: row.primary_muscles,
  };
}

/**
 * Charge TOUS les overrides du user courant, indexés par `exercise_id`, prêts à
 * fusionner avec le catalogue. RLS scope déjà à l'user : on lit tout sans filtre.
 * Une map (et non une liste) pour une fusion O(1) à la lecture du catalogue.
 */
export async function loadExerciseOverrides(): Promise<Map<string, ExerciseOverrideValues>> {
  const { data, error } = await supabase
    .from('exercise_overrides')
    .select('exercise_id, name, unilateral, primary_muscles');
  if (error) throw error;

  const byExercise = new Map<string, ExerciseOverrideValues>();
  for (const row of data ?? []) {
    byExercise.set(row.exercise_id, {
      name: row.name,
      unilateral: row.unilateral,
      primaryMuscles: row.primary_muscles,
    });
  }
  return byExercise;
}

/**
 * Charge l'override d'UN exo (ou `null` si aucun), pour pré-remplir le formulaire
 * d'édition d'un exo de base. `maybeSingle` car au plus un override par (user, exo).
 */
export async function loadExerciseOverride(
  exerciseId: string,
): Promise<ExerciseOverrideValues | null> {
  const { data, error } = await supabase
    .from('exercise_overrides')
    .select('exercise_id, name, unilateral, primary_muscles')
    .eq('exercise_id', exerciseId)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToOverrideValues(data as OverrideRow) : null;
}

/**
 * Applique l'override (per-user) aux CHAMPS PARTAGÉS d'une row exercice de base
 * (snake_case <-> domaine). Réutilise la règle PURE `mergeExerciseOverride`.
 * Renvoie la même row avec name / unilateral / primary_muscles surchargés. Un exo
 * PERSO ne reçoit pas d'override (on ne l'appelle que pour les exos de base), mais
 * la fonction reste neutre si aucun override n'est fourni.
 */
export function mergeRowWithOverride(
  row: ExerciseRow,
  override: ExerciseOverrideValues | null,
): ExerciseRow {
  const shared: ExerciseShared = {
    name: row.name,
    unilateral: row.unilateral ?? false,
    primaryMuscles: row.primary_muscles ?? [],
  };
  const merged = mergeExerciseOverride(shared, override);
  return {
    ...row,
    name: merged.name,
    unilateral: merged.unilateral,
    primary_muscles: merged.primaryMuscles,
  };
}

/**
 * Charge UNE row exercice DÉJÀ FUSIONNÉE avec son override per-user (issue #50),
 * par son id (`null` si l'exo n'existe pas / n'est pas visible). Sert au chemin
 * « ajout d'un exo à la volée » en Capture, où l'appelant ne dispose que de l'id
 * et du nom : on relit la row pour récupérer ses champs partagés personnalisés
 * (unilatéral, muscles) au lieu de retomber sur des replis. La RLS scope la
 * lecture à l'user (exo de base global OU perso à soi).
 */
export async function loadMergedExerciseRow(
  exerciseId: string,
): Promise<ExerciseRow | null> {
  const [{ data, error }, override] = await Promise.all([
    supabase.from('exercises').select('*').eq('id', exerciseId).maybeSingle(),
    loadExerciseOverride(exerciseId),
  ]);
  if (error) throw error;
  if (!data) return null;
  return mergeRowWithOverride(data as ExerciseRow, override);
}

/** Lit les CHAMPS PARTAGÉS d'un exo de base, NON fusionnés (la ligne de base est la référence du diff). */
async function loadSharedBase(exerciseId: string): Promise<ExerciseShared> {
  const { data, error } = await supabase
    .from('exercises')
    .select('name, unilateral, primary_muscles')
    .eq('id', exerciseId)
    .single();
  if (error) throw error;
  const row = data as Pick<ExerciseRow, 'name' | 'unilateral' | 'primary_muscles'>;
  return {
    name: row.name,
    unilateral: row.unilateral ?? false,
    primaryMuscles: row.primary_muscles ?? [],
  };
}

/**
 * Crée ou met à jour l'override d'un exo de base (per-user) en ne persistant que
 * les champs RÉELLEMENT DIVERGENTS de la base (ADR 0007). Le formulaire renvoie la
 * saisie COMPLÈTE (pré-remplie avec les valeurs déjà fusionnées) ; si on stockait
 * ces trois champs tels quels, tout override deviendrait TOTAL et figerait les
 * champs non touchés à leur valeur du moment (une correction ultérieure du
 * catalogue de base ne serait plus jamais vue). On lit donc la ligne de BASE non
 * fusionnée, on calcule l'override minimal (`diffExerciseOverride` met `null` sur
 * chaque champ égal à la base), et :
 *   - tout revient à la base (override vide) -> on SUPPRIME la ligne (= reset),
 *     plutôt que de stocker un override fantôme tout-`null` ;
 *   - sinon `upsert` par (user_id, exercise_id) : ré-éditer écrase l'unique ligne.
 * `user_id` est OMIS (posé par default auth.uid(), jamais réécrit).
 */
export async function upsertExerciseOverride(
  exerciseId: string,
  values: { name: string; primaryMuscles: string[]; unilateral: boolean },
): Promise<void> {
  const base = await loadSharedBase(exerciseId);
  const override = diffExerciseOverride(base, {
    name: values.name,
    unilateral: values.unilateral,
    primaryMuscles: values.primaryMuscles,
  });

  // Aucun champ ne diverge plus de la base : c'est un reset, on retire l'override.
  if (!isOverridden(override)) {
    await resetExerciseOverride(exerciseId);
    return;
  }

  const { error } = await supabase.from('exercise_overrides').upsert(
    {
      exercise_id: exerciseId,
      name: override.name,
      unilateral: override.unilateral,
      primary_muscles: override.primaryMuscles,
    },
    { onConflict: 'user_id,exercise_id' },
  );
  if (error) throw error;
}

/**
 * Réinitialise un exo de base à sa version partagée : supprime l'override du user.
 * Idempotent (delete par exercise_id ciblé, RLS scope à l'user) : réinitialiser
 * un exo déjà non personnalisé ne fait rien et ne lève pas.
 */
export async function resetExerciseOverride(exerciseId: string): Promise<void> {
  const { error } = await supabase
    .from('exercise_overrides')
    .delete()
    .eq('exercise_id', exerciseId);
  if (error) throw error;
}
