// Couche d'accès Supabase de la capture.
//
// Produit EXACTEMENT la forme consommée par les composants (`Session` /
// `SessionExercise`, cf. fixtures.ts) pour que l'UI reste inchangée : seule la
// SOURCE des données change (Supabase au lieu de la fixture mockée).
//
// Conventions DB (cf. ADR 0003 + migration 0001) :
//   - owner_id se remplit tout seul (default auth.uid()) — on ne l'écrit JAMAIS.
//   - RLS scope déjà tout à l'utilisateur connecté ; pas de filtre owner_id côté client.
import { supabase } from '../../lib/supabase';
import type { Database } from '../../lib/database.types';
import type { ExerciseExecution, PerformedSet } from '../../domain/types';
import { lastReference } from '../../domain/reference';
import { getCurrentRoutineId, getCurrentVersionId, listSeances } from '../authoring/data';
import { todayIso } from './state';
import type { Session, SessionExercise } from './fixtures';

export type { Session, SessionExercise } from './fixtures';

type ExerciseRow = Database['public']['Tables']['exercises']['Row'];

/** Une séance chargée pour la capture : la séance + l'id de sa version courante. */
export interface LoadedSeance {
  seance: { id: string; name: string };
  /** Version courante (= version max) de la séance. */
  seanceVersionId: string;
}

// --- Choix de la séance dans la routine courante (issue #1) -------------------
//
// En arrivant en Capture, l'user choisit QUELLE séance de sa routine courante il
// attaque, au lieu de toujours charger la 1ʳᵉ séance de la 1ʳᵉ routine. Quand il
// n'a rien d'exploitable (aucune routine courante, ou routine courante sans
// séance), la Capture affiche un ÉTAT VIDE : depuis l'onboarding (issue #3) on ne
// crée plus aucune séance en silence. Un user totalement neuf ne passe d'ailleurs
// pas par ici, App l'envoie d'abord sur l'écran de premier lancement.

/** Une séance proposée au choix en Capture : juste de quoi l'afficher et la résoudre. */
export interface SeanceChoice {
  id: string;
  name: string;
}

/**
 * Source de la Capture, dérivée de la routine courante :
 *   - `demo`   : rien à capturer (aucune routine courante, ou routine courante
 *                sans séance) -> la Capture affiche un état vide, sans rien créer ;
 *   - `choose` : la routine courante a des séances -> l'user en choisit une.
 */
export type CaptureSource =
  | { kind: 'demo' }
  | { kind: 'choose'; seances: SeanceChoice[] };

/**
 * Tranche la source de la Capture (logique PURE, testée) à partir de l'id de
 * routine courante et des séances de cette routine, déjà lus côté Supabase.
 *
 * `demo` (rien à capturer) si : aucune routine courante (`null`) OU routine
 * courante sans séance. Sinon : choix parmi les séances de la routine courante.
 */
export function decideCaptureSource(
  currentRoutineId: string | null,
  seances: SeanceChoice[],
): CaptureSource {
  if (currentRoutineId === null || seances.length === 0) {
    return { kind: 'demo' };
  }
  return { kind: 'choose', seances };
}

/**
 * Lit la routine courante (getCurrentRoutineId) et ses séances, puis tranche la
 * source de la Capture via `decideCaptureSource`. C'est le point d'entrée de
 * l'écran : il dit s'il faut proposer un choix ou afficher l'état vide.
 */
export async function loadCaptureSource(): Promise<CaptureSource> {
  const routineId = await getCurrentRoutineId();
  if (routineId === null) return decideCaptureSource(null, []);

  const seances = await listSeances(routineId);
  const choices: SeanceChoice[] = seances.map((s) => ({ id: s.id, name: s.name }));
  return decideCaptureSource(routineId, choices);
}

/**
 * Résout une séance choisie vers sa version courante (= version max), prête à
 * être chargée par `loadSeanceForCapture`. Réutilise `getCurrentVersionId` de
 * l'authoring (pas de duplication de la résolution « version courante »).
 * Lève si la séance n'a aucune version (template incomplet, ne devrait pas
 * arriver : createSeance crée toujours une v1).
 */
export async function loadChosenSeance(seance: SeanceChoice): Promise<LoadedSeance> {
  const versionId = await getCurrentVersionId(seance.id);
  if (!versionId) {
    throw new Error(`Séance ${seance.id} sans version : template incomplet.`);
  }
  return { seance: { id: seance.id, name: seance.name }, seanceVersionId: versionId };
}

// --- Lecture du catalogue -----------------------------------------------------

/** Catalogue visible par l'user : exos de base (owner_id null) + perso (RLS). */
export async function listExercises(): Promise<ExerciseRow[]> {
  const { data, error } = await supabase.from('exercises').select('*');
  if (error) throw error;
  return data ?? [];
}

// --- Chargement de la séance pour la capture ----------------------------------

type PrescriptionWithExercise = {
  exercise_id: string;
  position: number;
  sets_min: number;
  sets_max: number;
  reps_min: number;
  reps_max: number;
  rir_min: number;
  rir_max: number;
  exercises: { name: string } | null;
};

/**
 * Charge les prescriptions d'une version de séance, jointes au nom de l'exo,
 * triées par position, dans la forme `SessionExercise` attendue par l'UI.
 * La `reference` est laissée à `null` ici — `loadReference` la remplit par exo.
 */
export async function loadSeanceForCapture(
  seance: { id: string; name: string },
  seanceVersionId: string,
): Promise<Session> {
  const { data, error } = await supabase
    .from('prescriptions')
    .select(
      'exercise_id, position, sets_min, sets_max, reps_min, reps_max, rir_min, rir_max, exercises ( name )',
    )
    .eq('seance_version_id', seanceVersionId)
    .order('position', { ascending: true });
  if (error) throw error;

  const rows = (data ?? []) as unknown as PrescriptionWithExercise[];

  const exercises: SessionExercise[] = rows.map((row) => ({
    exerciseId: row.exercise_id,
    name: row.exercises?.name ?? '(exercice inconnu)',
    prescription: {
      sets: { min: row.sets_min, max: row.sets_max },
      reps: { min: row.reps_min, max: row.reps_max },
      rir: { min: row.rir_min, max: row.rir_max },
    },
    reference: null,
  }));

  return { id: seance.id, name: seance.name, exercises };
}

// --- Référence (dernière perf réelle) -----------------------------------------

/**
 * Référence d'un exo : sa dernière performance réelle, dérivée de l'historique.
 * Lit les executions de l'user + leurs performed_sets pour cet exo, mappe vers
 * `ExerciseExecution[]` du domaine, puis applique `lastReference`.
 * User neuf (aucune perf) -> `null` (« première fois »).
 */
export async function loadReference(exerciseId: string): Promise<PerformedSet[] | null> {
  const { data, error } = await supabase
    .from('performed_sets')
    .select('weight_kg, reps, rir, set_order, execution_id, executions ( performed_on )')
    .eq('exercise_id', exerciseId);
  if (error) throw error;

  type SetRow = {
    weight_kg: number;
    reps: number;
    rir: number;
    set_order: number;
    execution_id: string;
    executions: { performed_on: string } | null;
  };
  const rows = (data ?? []) as unknown as SetRow[];
  if (rows.length === 0) return null;

  // Regroupe les séries par exécution (une ExerciseExecution = un jour).
  const byExecution = new Map<string, ExerciseExecution>();
  for (const row of rows) {
    const date = row.executions?.performed_on;
    if (!date) continue; // garde-fou : exécution orpheline.
    let exec = byExecution.get(row.execution_id);
    if (!exec) {
      exec = { date, exerciseId, sets: [] };
      byExecution.set(row.execution_id, exec);
    }
    exec.sets.push({
      weightKg: Number(row.weight_kg),
      reps: row.reps,
      rir: row.rir,
      order: row.set_order,
    });
  }

  return lastReference([...byExecution.values()], exerciseId);
}

// --- Exécution du jour --------------------------------------------------------
//
// NOTE : l'id d'exécution n'est plus résolu côté serveur via un « find or
// create » du jour. Depuis l'ajout de l'outbox (ADR 0003), il est GÉNÉRÉ CÔTÉ
// CLIENT au démarrage de la session (state.executionId) et posé via
// `upsertExecution`, pour qu'une séance loggée offline remonte sans collision.

/**
 * Charge le réalisé déjà persisté de l'exécution du jour, par exerciseId, dans
 * la forme du reducer (`PerformedSet[]` triés par order). Sert à RÉHYDRATER la
 * capture au montage : c'est Supabase qui fait foi après un reload. Renvoie une
 * map vide si aucune exécution n'existe encore aujourd'hui.
 */
export async function loadTodayProgress(
  seanceVersionId: string,
): Promise<Record<string, PerformedSet[]>> {
  const today = todayIso();

  const { data: exec, error: execErr } = await supabase
    .from('executions')
    .select('id')
    .eq('seance_version_id', seanceVersionId)
    .eq('performed_on', today)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (execErr) throw execErr;
  if (!exec) return {};

  const { data, error } = await supabase
    .from('performed_sets')
    .select('exercise_id, weight_kg, reps, rir, set_order')
    .eq('execution_id', exec.id)
    .order('set_order', { ascending: true });
  if (error) throw error;

  const byExercise: Record<string, PerformedSet[]> = {};
  for (const row of data ?? []) {
    const list = byExercise[row.exercise_id] ?? (byExercise[row.exercise_id] = []);
    list.push({
      weightKg: Number(row.weight_kg),
      reps: row.reps,
      rir: row.rir,
      order: row.set_order,
    });
  }
  for (const id of Object.keys(byExercise)) {
    byExercise[id].sort((a, b) => a.order - b.order);
  }
  return byExercise;
}

// --- Écriture idempotente (rejouable par l'outbox) ----------------------------
//
// Toutes ces fonctions sont IDEMPOTENTES par `id` (UUID client, cf. ADR 0003) :
// l'outbox peut les rejouer sans crainte de doublon ni d'effet de bord. Elles
// sont les `SyncFns` consommées par `flush()` ; le mapping op→fonction se fait
// dans CaptureScreen.

/**
 * Crée (ou ré-affirme) l'exécution du jour, par son id client. `upsert` avec
 * `onConflict: 'id'` : rejouer la même op est sans effet (la ligne existe déjà,
 * ses colonnes identiques). owner_id se remplit via default auth.uid().
 */
export async function upsertExecution(params: {
  id: string;
  seanceVersionId: string;
  performedOn: string;
}): Promise<void> {
  const { error } = await supabase.from('executions').upsert(
    {
      id: params.id,
      seance_version_id: params.seanceVersionId,
      performed_on: params.performedOn,
    },
    { onConflict: 'id' },
  );
  if (error) throw error;
}

/**
 * Insère une série loggée, par son id client. `upsert` avec `onConflict: 'id'` :
 * rejouer l'op (retry après coupure) ne crée pas de doublon, elle ré-affirme la
 * même ligne. owner_id via default auth.uid().
 */
export async function upsertSet(params: {
  id: string;
  executionId: string;
  exerciseId: string;
  setOrder: number;
  weightKg: number;
  reps: number;
  rir: number;
}): Promise<void> {
  const { error } = await supabase.from('performed_sets').upsert(
    {
      id: params.id,
      execution_id: params.executionId,
      exercise_id: params.exerciseId,
      set_order: params.setOrder,
      weight_kg: params.weightKg,
      reps: params.reps,
      rir: params.rir,
    },
    { onConflict: 'id' },
  );
  if (error) throw error;
}

/**
 * Supprime une série par son id (« annuler »). Idempotent : supprimer une ligne
 * déjà absente ne fait rien et ne lève pas (delete par id ciblé).
 */
export async function deleteSetById(id: string): Promise<void> {
  const { error } = await supabase.from('performed_sets').delete().eq('id', id);
  if (error) throw error;
}

/**
 * Pose les métriques de fin (BPM moyen, durée) sur l'exécution, par id. Update
 * idempotent : rejouer pose les mêmes valeurs. Un champ omis (`undefined`)
 * laisse la colonne inchangée plutôt que de l'effacer.
 */
export async function updateExecution(params: {
  id: string;
  bpmAvg?: number | null;
  durationMin?: number | null;
}): Promise<void> {
  const patch: Database['public']['Tables']['executions']['Update'] = {};
  if (params.bpmAvg !== undefined) patch.bpm_avg = params.bpmAvg;
  if (params.durationMin !== undefined) patch.duration_min = params.durationMin;

  // Rien à poser : on évite un update vide (no-op réseau).
  if (Object.keys(patch).length === 0) return;

  const { error } = await supabase.from('executions').update(patch).eq('id', params.id);
  if (error) throw error;
}
