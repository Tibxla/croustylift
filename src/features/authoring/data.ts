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
import { executedRoutineIds } from './archive';
import {
  buildSeanceCatalog,
  currentVersionIdBySeance,
  toDuplicatedPrescriptions,
  type SeanceCatalogEntry,
} from './duplicate-seance';

export type { SeanceCatalogEntry } from './duplicate-seance';

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
 * Compte les références BLOQUANTES d'un exo : prescriptions (template),
 * performed_sets (historique réel) et dated_notes (notes datées #26). Sert à la
 * garde de suppression (issue #49) : ces FK n'ont pas de ON DELETE CASCADE,
 * supprimer un exo référencé est rejeté par la base (23503). On lit juste les
 * comptes (head + count: 'exact'), sans tirer les lignes. La RLS scope chaque
 * table au user, on n'ajoute donc aucun filtre owner.
 */
export async function countExerciseReferences(
  exerciseId: string,
): Promise<ExerciseReferenceCounts> {
  const [presc, sets, notes] = await Promise.all([
    supabase
      .from('prescriptions')
      .select('id', { count: 'exact', head: true })
      .eq('exercise_id', exerciseId),
    supabase
      .from('performed_sets')
      .select('id', { count: 'exact', head: true })
      .eq('exercise_id', exerciseId),
    supabase
      .from('dated_notes')
      .select('id', { count: 'exact', head: true })
      .eq('exercise_id', exerciseId),
  ]);
  if (presc.error) throw presc.error;
  if (sets.error) throw sets.error;
  if (notes.error) throw notes.error;
  return {
    prescriptions: presc.count ?? 0,
    performedSets: sets.count ?? 0,
    datedNotes: notes.count ?? 0,
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
 * session qui rattacherait une référence entre le compte et le DELETE), si la
 * base rejette la suppression pour violation de FK (code Postgres 23503), on
 * retraduit en message lisible plutôt que de remonter l'erreur SQL brute.
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

/**
 * Traduit une violation d'unicité de nom (Postgres 23505, index de la migration
 * 0013) en message lisible, affiché sous le champ. Toute autre erreur repart
 * telle quelle. La base tient seule la règle : pas de lecture préalable, donc
 * pas de course entre la vérification et l'écriture.
 */
export function nameConflictError(
  error: unknown,
  kind: 'routine' | 'seance',
  name: string,
): unknown {
  const isUnique =
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505';
  if (!isUnique) return error;
  const clean = name.trim().replace(/\s+/g, ' ');
  return new Error(
    kind === 'routine'
      ? `Tu as déjà une routine « ${clean} ». Choisis un autre nom.`
      : `Cette routine a déjà une séance « ${clean} ». Choisis un autre nom.`,
  );
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
  if (error) throw nameConflictError(error, 'routine', input.name);
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
  if (error) throw nameConflictError(error, 'routine', name);
  return data;
}

/**
 * Supprime une routine JAMAIS exécutée. Les séances, versions, prescriptions et
 * activations cascadent (on delete cascade). Une routine dont une séance a été
 * exécutée est refusée par la base (migration 0014, 23503) : elle s'archive
 * (ADR 0017). L'UI ne propose d'ailleurs que l'archivage dans ce cas.
 */
export async function deleteRoutine(id: string): Promise<void> {
  const { error } = await supabase.from('routines').delete().eq('id', id);
  if (error) {
    if (isForeignKeyViolation(error)) {
      throw new Error(
        'Cette routine a déjà été faite en salle : archive-la plutôt, son historique reste entier.',
      );
    }
    throw error;
  }
}

/**
 * Archive une routine (ADR 0017) : elle sort de la liste et ne peut plus devenir
 * courante, son historique reste entier. La routine courante ne s'archive pas :
 * on relit la routine courante juste avant, pour refuser avec un message clair.
 */
export async function archiveRoutine(id: string): Promise<void> {
  if ((await getCurrentRoutineId()) === id) {
    throw new Error(
      'La routine courante ne s’archive pas. Définis d’abord une autre routine comme courante.',
    );
  }
  const { error } = await supabase
    .from('routines')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

/** Désarchive une routine : elle revient dans la liste, prête à redevenir courante. */
export async function unarchiveRoutine(id: string): Promise<void> {
  const { error } = await supabase.from('routines').update({ archived_at: null }).eq('id', id);
  if (error) throw error;
}

/**
 * L'historique d'exécution du plan : les séances et les routines qui ont au
 * moins une exécution. Sert à proposer « Archiver » plutôt que « Supprimer »
 * (ADR 0017). Deux lectures à volume borné par l'historique du compte.
 */
export async function loadPlanHistory(): Promise<{
  executedSeanceIds: Set<string>;
  executedRoutineIds: Set<string>;
}> {
  const [executionsRes, seancesRes] = await Promise.all([
    supabase.from('executions').select('seance_versions ( seance_id )'),
    supabase.from('seances').select('id, routine_id'),
  ]);
  if (executionsRes.error) throw executionsRes.error;
  if (seancesRes.error) throw seancesRes.error;

  type Row = { seance_versions: { seance_id: string } | null };
  const executedSeanceIds = new Set<string>();
  for (const row of (executionsRes.data ?? []) as unknown as Row[]) {
    if (row.seance_versions) executedSeanceIds.add(row.seance_versions.seance_id);
  }
  return {
    executedSeanceIds,
    executedRoutineIds: executedRoutineIds(seancesRes.data ?? [], executedSeanceIds),
  };
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
  if (seanceErr) throw nameConflictError(seanceErr, 'seance', input.name);

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
  if (error) throw nameConflictError(error, 'seance', name);
  return data;
}

/**
 * Supprime une séance JAMAIS exécutée. Versions et prescriptions cascadent. Une
 * séance exécutée est refusée par la base (migration 0014, 23503) : elle
 * s'archive (ADR 0017).
 */
export async function deleteSeance(id: string): Promise<void> {
  const { error } = await supabase.from('seances').delete().eq('id', id);
  if (error) {
    if (isForeignKeyViolation(error)) {
      throw new Error(
        'Cette séance a déjà été faite en salle : archive-la plutôt, son historique reste entier.',
      );
    }
    throw error;
  }
}

/**
 * Archive une séance (ADR 0017) : elle ne se choisit plus en salle, son
 * historique reste entier. Une seule écriture : le trigger de la migration 0014
 * date l'archivage à l'heure du serveur et écrit l'événement que la timeline des
 * blocs rejoue (archiver une séance de la routine courante coupe un bloc).
 */
export async function archiveSeance(id: string): Promise<void> {
  const { error } = await supabase
    .from('seances')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

/**
 * Désarchive une séance : elle revient au plan, en fin de routine, et sa
 * Référence comme sa courbe reprennent. On la replace en dernière position :
 * pendant l'archivage, les séances actives ont pu être réordonnées sans elle.
 */
export async function unarchiveSeance(id: string): Promise<void> {
  const { data: seance, error: readErr } = await supabase
    .from('seances')
    .select('routine_id')
    .eq('id', id)
    .single();
  if (readErr) throw readErr;
  const siblings = await listSeances(seance.routine_id);
  const position = nextPosition(siblings.filter((s) => s.id !== id).map((s) => s.position));

  const { error } = await supabase
    .from('seances')
    .update({ archived_at: null, position })
    .eq('id', id);
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
    const id = orderedIds[position];
    if (id === undefined) continue;
    const { error } = await supabase
      .from('seances')
      .update({ position })
      .eq('id', id);
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

// =====================================================================
// Duplication de séance (ADR 0015)
// =====================================================================

/**
 * Catalogue des séances copiables : TOUTES les séances de l'utilisateur, toutes
 * routines confondues (RLS scope déjà au compte). Quatre requêtes à volume fixe
 * plutôt qu'une par séance : le comptage des exos et le choix de la version
 * courante se font ensuite à froid, dans `buildSeanceCatalog` (pur, testé).
 */
export async function loadSeanceCatalog(): Promise<SeanceCatalogEntry[]> {
  const [routines, seancesRes, versionsRes, currentRoutineId] = await Promise.all([
    listRoutines(),
    supabase.from('seances').select('id, name, routine_id, position, archived_at'),
    supabase.from('seance_versions').select('id, seance_id, version'),
    getCurrentRoutineId(),
  ]);
  if (seancesRes.error) throw seancesRes.error;
  if (versionsRes.error) throw versionsRes.error;

  const versions = versionsRes.data ?? [];
  // Les prescriptions ne se chargent que pour les versions COURANTES, et
  // seulement pour compter : on ne lit que la clé étrangère. Filtrer sur toutes
  // les versions serait faux de coût, pas de résultat : `seance_versions` est
  // append-only (ADR 0001), donc une séance éditée 50 fois traînerait 50 jeux de
  // prescriptions dans le `in` (et dans l'URL) pour n'en compter qu'un. Ici la
  // borne est le nombre de séances, pas l'âge du compte. Sans version, pas de
  // requête du tout (compte neuf).
  const currentVersionIds = [...currentVersionIdBySeance(versions).values()];
  let prescriptions: { seance_version_id: string }[] = [];
  if (currentVersionIds.length > 0) {
    const { data, error } = await supabase
      .from('prescriptions')
      .select('seance_version_id')
      .in('seance_version_id', currentVersionIds);
    if (error) throw error;
    prescriptions = data ?? [];
  }

  return buildSeanceCatalog({
    routines,
    seances: seancesRes.data ?? [],
    versions,
    prescriptions,
    currentRoutineId,
  });
}

/**
 * Crée une séance dans `routineId` en repartant du contenu de `sourceSeanceId`
 * (ADR 0015). Copie franche : les deux séances sont indépendantes dès l'insert,
 * la copie n'hérite d'aucun historique (ni Référence, ni courbe) et aucun lien
 * de provenance n'est stocké.
 *
 * Ordre VOLONTAIRE, repris de l'onboarding : on LIT la source AVANT toute
 * écriture, pour que l'échec le plus probable (lecture réseau) ne laisse rien
 * derrière lui. Ce n'est PAS de l'atomicité : si `saveSeanceVersion` échoue
 * ensuite, la séance reste créée avec une version vide. C'est le pire cas déjà
 * assumé de cette fonction (cf. en-tête du fichier), un état valide du système,
 * et l'utilisateur voit sa séance vide plutôt qu'une erreur muette.
 * Une source vide donne une séance vide — exactement ce qu'une création normale
 * produit, pas un cas d'erreur.
 */
export async function duplicateSeance(
  routineId: string,
  sourceSeanceId: string,
  name: string,
): Promise<SeanceRow> {
  const source = await loadSeanceEditor(sourceSeanceId);
  const prescriptions = toDuplicatedPrescriptions(source);

  const seance = await createSeance(routineId, { name });
  if (prescriptions.length > 0) {
    await saveSeanceVersion(seance.id, prescriptions);
  }
  return seance;
}
