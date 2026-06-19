// Couche d'accès Supabase de l'authoring (création/édition des templates).
//
// Couvre le CRUD des routines / séances / exos perso et le VERSIONNAGE des
// prescriptions (ADR 0001). Pendant cette étape : data-layer pur, aucune UI.
//
// Conventions DB (cf. ADR 0003 + migration 0001) :
//   - owner_id se remplit tout seul (default auth.uid()) — on ne l'écrit JAMAIS.
//   - RLS scope déjà tout à l'utilisateur connecté ; pas de filtre owner_id côté client.
//   - UUID générés serveur (default gen_random_uuid()) à l'insert.
//
// Versionnage (ADR 0001), en bref :
//   - Une séance a TOUJOURS au moins une version : on crée une v1 VIDE à la
//     création de la séance pour qu'elle ait une version courante immédiatement.
//   - La « version courante » = la version au numéro le plus élevé.
//   - Éditer les prescriptions ne MUTE jamais une version existante : on crée une
//     NOUVELLE version (numéro = max + 1) et on y insère les prescriptions.
//     L'historique reste donc immuable et auditable (une perf passée sait toujours
//     sous quelle prescription elle a eu lieu).
//
// Atomicité de saveSeanceVersion : supabase-js n'offre pas de transaction
// client. On insère la version PUIS ses prescriptions en deux temps. Si l'insert
// des prescriptions échoue, la nouvelle version peut rester VIDE — c'est
// inoffensif : une version vide est un état déjà valide du système (c'est
// exactement ce qu'on crée à createSeance), elle devient juste la version
// courante sans prescription. On a préféré ce séquençage à une RPC Postgres
// dédiée pour (a) ne pas ajouter de dépendance Postgres-spécifique de plus et
// (b) ne pas toucher la base réelle via une migration dans cet environnement ;
// le coût (version vide possible) est borné et sans danger pour l'historique.
import { supabase } from '../../lib/supabase';
import type { Database } from '../../lib/database.types';
import {
  buildPersonalExerciseInsert,
  buildPersonalExerciseUpdate,
} from './exercise-input';
import {
  describeReferenceBlock,
  type ExerciseReferenceCounts,
} from '../exercises/deletion-guard';
import { loadExerciseOverrides } from '../exercises/overrides';
import {
  mergeExerciseOverride,
  type ExerciseOverrideValues,
} from '../../domain/exercise-override';

type ExerciseRow = Database['public']['Tables']['exercises']['Row'];
type RoutineRow = Database['public']['Tables']['routines']['Row'];
type SeanceRow = Database['public']['Tables']['seances']['Row'];

// =====================================================================
// Types d'entrée / sortie
// =====================================================================

/** Fourchette saisie (min, max). Une valeur fixe = min === max. */
export interface RangeInput {
  min: number;
  max: number;
}

/** Une prescription telle que saisie dans l'éditeur de séance. */
export interface PrescriptionInput {
  exerciseId: string;
  /** Rang de l'exo dans la séance (0-based, ordre d'affichage). */
  position: number;
  sets: RangeInput;
  reps: RangeInput;
  rir: RangeInput;
}

/**
 * Une prescription chargée pour l'éditeur : la prescription + le nom, le groupe
 * musculaire (legacy), les muscles principaux et le drapeau unilatéral de l'exo
 * (joints), dans la forme `PrescriptionInput` pour être ré-éditable et
 * re-sauvegardée telle quelle. `primaryMuscles` + `unilateral` alimentent le
 * décompte PRÉVU des séries (issue #37).
 */
export interface EditablePrescription extends PrescriptionInput {
  exerciseName: string;
  muscleGroup: string;
  primaryMuscles: string[];
  unilateral: boolean;
}

// =====================================================================
// Helpers purs (testés) — cf. data.test.ts
// =====================================================================

/**
 * Prochain numéro de version à partir du numéro courant le plus élevé.
 * `null` (aucune version) -> 1 (première version). Sinon max + 1.
 */
export function nextVersionNumber(currentMax: number | null): number {
  return currentMax === null ? 1 : currentMax + 1;
}

/** Prochaine `position` dans une liste : max + 1, ou 0 si vide. */
export function nextPosition(positions: number[]): number {
  return positions.length === 0 ? 0 : Math.max(...positions) + 1;
}

/** Une ligne `prescriptions` brute, avec l'exo joint, telle que renvoyée par la requête. */
interface PrescriptionRowWithExercise {
  exercise_id: string;
  position: number;
  sets_min: number;
  sets_max: number;
  reps_min: number;
  reps_max: number;
  rir_min: number;
  rir_max: number;
  exercises: {
    name: string;
    muscle_group: string;
    primary_muscles: string[];
    unilateral: boolean;
  } | null;
}

/** Mappe une ligne `prescriptions` (jointe à l'exo) vers la forme éditable. */
export function rowToEditablePrescription(
  row: PrescriptionRowWithExercise,
): EditablePrescription {
  return {
    exerciseId: row.exercise_id,
    position: row.position,
    sets: { min: row.sets_min, max: row.sets_max },
    reps: { min: row.reps_min, max: row.reps_max },
    rir: { min: row.rir_min, max: row.rir_max },
    exerciseName: row.exercises?.name ?? '(exercice inconnu)',
    muscleGroup: row.exercises?.muscle_group ?? '',
    // Décompte PRÉVU (issue #37) : la LISTE des muscles principaux (#33). Vide si
    // l'exo legacy n'a pas (encore) de primary_muscles -> il ne compte pour aucun
    // muscle, mais reste compté au total via son drapeau unilatéral.
    primaryMuscles: row.exercises?.primary_muscles ?? [],
    unilateral: row.exercises?.unilateral ?? false,
  };
}

/** Mappe une prescription saisie vers une ligne `prescriptions` à insérer (owner_id omis). */
export function prescriptionInputToRow(
  seanceVersionId: string,
  input: PrescriptionInput,
): Database['public']['Tables']['prescriptions']['Insert'] {
  return {
    seance_version_id: seanceVersionId,
    exercise_id: input.exerciseId,
    position: input.position,
    sets_min: input.sets.min,
    sets_max: input.sets.max,
    reps_min: input.reps.min,
    reps_max: input.reps.max,
    rir_min: input.rir.min,
    rir_max: input.rir.max,
  };
}

// =====================================================================
// Exercices perso
// =====================================================================

/**
 * Crée un exercice perso. `owner_id` se remplit via default auth.uid().
 *
 * Modèle étendu (issue #33) : on écrit `unilateral` + la LISTE `primary_muscles`
 * (>= 1, vocabulaire canonique) ET, pour la compat legacy, `muscle_group` = le
 * premier muscle principal. La row est construite et validée par le helper pur
 * buildPersonalExerciseInsert (cf. exercise-input.ts) ; il jette si la saisie est
 * invalide (nom vide ou aucun muscle canonique).
 */
export async function createPersonalExercise(input: {
  name: string;
  primaryMuscles: string[];
  unilateral?: boolean;
}): Promise<ExerciseRow> {
  const { data, error } = await supabase
    .from('exercises')
    .insert(buildPersonalExerciseInsert(input))
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

/**
 * Édite un exo perso (renommer et/ou changer muscles + unilatéral, issue #49).
 * La row d'update est construite et validée par buildPersonalExerciseUpdate
 * (jette si nom vide ou aucun muscle canonique) ; `owner_id` n'est JAMAIS dans
 * l'update (RLS, jamais réécrit). La RLS `exercises_update` borne déjà l'écriture
 * au propriétaire : un exo de base (owner_id null) ou d'autrui ne sera pas modifié
 * (0 ligne touchée), d'où le `.single()` qui remonte une erreur si rien ne matche.
 */
export async function updatePersonalExercise(
  id: string,
  input: { name: string; primaryMuscles: string[]; unilateral?: boolean },
): Promise<ExerciseRow> {
  const { data, error } = await supabase
    .from('exercises')
    .update(buildPersonalExerciseUpdate(input))
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

/**
 * Compte les références BLOQUANTES d'un exo : prescriptions (template) et
 * performed_sets (historique réel). Sert à la garde de suppression (issue #49) :
 * ces FK n'ont pas de ON DELETE CASCADE, supprimer un exo référencé est rejeté
 * par la base. On lit juste les comptes (head + count: 'exact'), sans tirer les
 * lignes. La RLS scope chaque table au user, on n'ajoute donc aucun filtre owner.
 */
export async function countExerciseReferences(
  exerciseId: string,
): Promise<ExerciseReferenceCounts> {
  const [presc, sets] = await Promise.all([
    supabase
      .from('prescriptions')
      .select('id', { count: 'exact', head: true })
      .eq('exercise_id', exerciseId),
    supabase
      .from('performed_sets')
      .select('id', { count: 'exact', head: true })
      .eq('exercise_id', exerciseId),
  ]);
  if (presc.error) throw presc.error;
  if (sets.error) throw sets.error;
  return {
    prescriptions: presc.count ?? 0,
    performedSets: sets.count ?? 0,
  };
}

/**
 * Supprime un exo perso, de façon SÛRE (issue #49). On compte d'abord les
 * références bloquantes : si l'exo est encore prescrit ou a un historique de
 * séries, on REFUSE avec un message clair (describeReferenceBlock) au lieu de
 * laisser la base lever une violation de FK opaque. L'historique n'est jamais
 * perdu : on demande à l'utilisateur de détacher l'exo d'abord.
 *
 * Filet de sécurité : même après le compte (course possible avec une autre
 * session ou une note datée non comptée), si la base rejette la suppression pour
 * violation de FK (code Postgres 23503), on retraduit en message lisible plutôt
 * que de remonter l'erreur SQL brute.
 */
export async function deletePersonalExercise(id: string): Promise<void> {
  const counts = await countExerciseReferences(id);
  const block = describeReferenceBlock(counts);
  if (block) throw new Error(block);

  const { error } = await supabase.from('exercises').delete().eq('id', id);
  if (error) {
    if (isForeignKeyViolation(error)) {
      throw new Error(
        'Impossible de supprimer cet exercice : il est encore utilisé ailleurs. Retire-le de tes séances avant de réessayer ; ton historique reste intact.',
      );
    }
    throw error;
  }
}

/** Vrai si l'erreur Supabase est une violation de clé étrangère (Postgres 23503). */
function isForeignKeyViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23503'
  );
}

// =====================================================================
// Routines
// =====================================================================

/** Toutes les routines de l'user (RLS), de la plus ancienne à la plus récente. */
export async function listRoutines(): Promise<RoutineRow[]> {
  const { data, error } = await supabase
    .from('routines')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** Crée une routine. owner_id via default auth.uid(). */
export async function createRoutine(input: { name: string }): Promise<RoutineRow> {
  const { data, error } = await supabase
    .from('routines')
    .insert({ name: input.name })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

/** Renomme une routine. */
export async function renameRoutine(id: string, name: string): Promise<RoutineRow> {
  const { data, error } = await supabase
    .from('routines')
    .update({ name })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

/**
 * Supprime une routine. Les séances, versions, prescriptions et activations
 * cascadent (on delete cascade) ; les executions de ses versions passent à
 * seance_version_id null (on delete set null) — l'historique réel survit.
 */
export async function deleteRoutine(id: string): Promise<void> {
  const { error } = await supabase.from('routines').delete().eq('id', id);
  if (error) throw error;
}

// --- Routine courante (timeline routine_activations, ADR 0001) ----------------

/**
 * Désigne `routineId` comme routine courante : insère une ligne d'activation
 * (activated_at = now par défaut). On NE met PAS à jour une ligne existante :
 * chaque activation est un point de la timeline qui sert à dériver les blocs.
 */
export async function setCurrentRoutine(routineId: string): Promise<void> {
  const { error } = await supabase
    .from('routine_activations')
    .insert({ routine_id: routineId });
  if (error) throw error;
}

/** Id de la routine courante = activation la plus récente, ou null si aucune. */
export async function getCurrentRoutineId(): Promise<string | null> {
  const { data, error } = await supabase
    .from('routine_activations')
    .select('routine_id')
    .order('activated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.routine_id ?? null;
}

// =====================================================================
// Séances
// =====================================================================

/** Séances d'une routine, triées par position croissante. */
export async function listSeances(routineId: string): Promise<SeanceRow[]> {
  const { data, error } = await supabase
    .from('seances')
    .select('*')
    .eq('routine_id', routineId)
    .order('position', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/**
 * Crée une séance en fin de routine (position = max + 1) ET sa version v1 VIDE,
 * pour qu'elle ait toujours une version courante (cf. invariant ADR 0001).
 * Renvoie la séance créée.
 *
 * Pas de transaction client : si l'insert de la version échouait après la
 * séance, on aurait une séance sans version (template incomplet). On insère donc
 * la version juste après et on remonte l'erreur telle quelle le cas échéant.
 */
export async function createSeance(
  routineId: string,
  input: { name: string },
): Promise<SeanceRow> {
  const existing = await listSeances(routineId);
  const position = nextPosition(existing.map((s) => s.position));

  const { data: seance, error: seanceErr } = await supabase
    .from('seances')
    .insert({ routine_id: routineId, name: input.name, position })
    .select('*')
    .single();
  if (seanceErr) throw seanceErr;

  const { error: versionErr } = await supabase
    .from('seance_versions')
    .insert({ seance_id: seance.id, version: 1 });
  if (versionErr) throw versionErr;

  return seance;
}

/** Renomme une séance. */
export async function renameSeance(id: string, name: string): Promise<SeanceRow> {
  const { data, error } = await supabase
    .from('seances')
    .update({ name })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

/**
 * Supprime une séance. Versions et prescriptions cascadent ; les executions de
 * ses versions passent à seance_version_id null (on delete set null).
 */
export async function deleteSeance(id: string): Promise<void> {
  const { error } = await supabase.from('seances').delete().eq('id', id);
  if (error) throw error;
}

/**
 * Réordonne les séances d'une routine : réécrit `position` selon l'ordre fourni
 * (index 0 = première). `orderedIds` doit lister les séances de la routine ;
 * les positions sont réassignées 0..n-1. Une mise à jour par séance (pas de bulk
 * upsert pour ne pas risquer d'écrire owner_id via un upsert mal formé).
 */
export async function reorderSeances(
  _routineId: string,
  orderedIds: string[],
): Promise<void> {
  for (let position = 0; position < orderedIds.length; position++) {
    const { error } = await supabase
      .from('seances')
      .update({ position })
      .eq('id', orderedIds[position]);
    if (error) throw error;
  }
}

// =====================================================================
// Versions + prescriptions (le cœur — ADR 0001)
// =====================================================================

/** Numéro de version courant le plus élevé d'une séance, ou null si aucune version. */
async function currentMaxVersion(seanceId: string): Promise<number | null> {
  const { data, error } = await supabase
    .from('seance_versions')
    .select('version')
    .eq('seance_id', seanceId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.version ?? null;
}

/** Id de la version courante (numéro le plus élevé) d'une séance, ou null si aucune. */
export async function getCurrentVersionId(seanceId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('seance_versions')
    .select('id')
    .eq('seance_id', seanceId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

/**
 * Charge les prescriptions de la VERSION COURANTE d'une séance, jointes au nom
 * et au groupe musculaire de l'exo, triées par position, sous forme éditable.
 * Séance sans version -> []. Version vide (v1 fraîche) -> [].
 */
export async function loadSeanceEditor(seanceId: string): Promise<EditablePrescription[]> {
  const versionId = await getCurrentVersionId(seanceId);
  if (!versionId) return [];

  const [{ data, error }, overrides] = await Promise.all([
    supabase
      .from('prescriptions')
      .select(
        'exercise_id, position, sets_min, sets_max, reps_min, reps_max, rir_min, rir_max, exercises ( name, muscle_group, primary_muscles, unilateral )',
      )
      .eq('seance_version_id', versionId)
      .order('position', { ascending: true }),
    // Fusion override per-user (issue #50) : le décompte PRÉVU des séries (#37)
    // doit refléter les muscles / l'unilatéral personnalisés, comme la Capture.
    loadExerciseOverrides(),
  ]);
  if (error) throw error;

  const rows = (data ?? []) as unknown as PrescriptionRowWithExercise[];
  return rows.map((row) => applyOverrideToEditable(rowToEditablePrescription(row), overrides));
}

/**
 * Surcharge les champs partagés (nom, muscles, unilatéral) d'une prescription
 * éditable avec l'override per-user de son exo, via la règle PURE de fusion. La
 * fourchette de séries/reps/RIR (propre à la prescription) n'est pas concernée.
 */
function applyOverrideToEditable(
  presc: EditablePrescription,
  overrides: Map<string, ExerciseOverrideValues>,
): EditablePrescription {
  const merged = mergeExerciseOverride(
    {
      name: presc.exerciseName,
      unilateral: presc.unilateral,
      primaryMuscles: presc.primaryMuscles,
    },
    overrides.get(presc.exerciseId) ?? null,
  );
  return {
    ...presc,
    exerciseName: merged.name,
    unilateral: merged.unilateral,
    primaryMuscles: merged.primaryMuscles,
  };
}

/**
 * Enregistre une édition de séance en créant une NOUVELLE version (immutabilité
 * de l'historique, ADR 0001) :
 *   1. lit le numéro de version max actuel,
 *   2. insère une version au numéro max + 1 (ou 1 si aucune),
 *   3. insère les prescriptions saisies dans cette nouvelle version.
 *
 * Ne mute JAMAIS une version existante ni ses prescriptions. Renvoie l'id de la
 * nouvelle version. Une liste vide crée une version vide valide (template sans
 * exo prescrit) — symétrique de la v1 créée par createSeance.
 *
 * Pas de transaction client : si l'étape 3 échoue, la version créée à l'étape 2
 * reste en base, vide. C'est inoffensif (cf. en-tête du fichier) : elle devient
 * la version courante sans prescription, état déjà valide du système.
 */
export async function saveSeanceVersion(
  seanceId: string,
  prescriptions: PrescriptionInput[],
): Promise<string> {
  const currentMax = await currentMaxVersion(seanceId);
  const version = nextVersionNumber(currentMax);

  const { data: created, error: versionErr } = await supabase
    .from('seance_versions')
    .insert({ seance_id: seanceId, version })
    .select('id')
    .single();
  if (versionErr) throw versionErr;

  if (prescriptions.length > 0) {
    const rows = prescriptions.map((p) => prescriptionInputToRow(created.id, p));
    const { error: prescErr } = await supabase.from('prescriptions').insert(rows);
    if (prescErr) throw prescErr;
  }

  return created.id;
}
