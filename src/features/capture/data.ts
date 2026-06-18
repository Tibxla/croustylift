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
import type {
  ExerciseExecution,
  PerformedSet,
  Prescription,
} from '../../domain/types';
import { lastReference } from '../../domain/reference';
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

// --- Lecture du catalogue -----------------------------------------------------

/** Catalogue visible par l'user : exos de base (owner_id null) + perso (RLS). */
export async function listExercises(): Promise<ExerciseRow[]> {
  const { data, error } = await supabase.from('exercises').select('*');
  if (error) throw error;
  return data ?? [];
}

// --- Starter idempotent -------------------------------------------------------

/** Les 4 exos de démo, par NOM (les UUID sont résolus à l'exécution, jamais hardcodés). */
const STARTER_PRESCRIPTIONS: Array<{ name: string; prescription: Prescription }> = [
  {
    name: 'Développé couché',
    prescription: { sets: { min: 3, max: 4 }, reps: { min: 8, max: 12 }, rir: { min: 1, max: 2 } },
  },
  {
    name: 'Tirage horizontal',
    prescription: { sets: { min: 3, max: 4 }, reps: { min: 10, max: 12 }, rir: { min: 1, max: 2 } },
  },
  {
    name: 'Développé militaire',
    prescription: { sets: { min: 3, max: 3 }, reps: { min: 6, max: 8 }, rir: { min: 2, max: 2 } },
  },
  {
    name: 'Curl biceps haltères',
    prescription: { sets: { min: 3, max: 4 }, reps: { min: 10, max: 15 }, rir: { min: 0, max: 1 } },
  },
];

// L'idempotence repose sur un « check puis create » : deux appels CONCURRENTS
// (double-montage React StrictMode, double-clic) verraient tous deux « aucune
// routine » et créeraient le starter en double. On sérialise donc les appels en
// vol via une promesse mémoïsée : tant qu'un ensureStarterSeance tourne, les
// suivants réutilisent son résultat. La garde est relâchée une fois résolu.
let inFlightStarter: Promise<LoadedSeance> | null = null;

/**
 * Garantit une séance de démarrage pour un user neuf.
 *
 * Idempotent : si l'user a DÉJÀ au moins une routine, on ne crée rien et on
 * renvoie la première séance de sa première routine (avec sa version max). Si
 * l'user n'a AUCUNE routine, on crée « Ma routine » + séance « Upper A » (v1) +
 * les prescriptions des 4 exos de base.
 *
 * Renvoie la séance + l'id de sa version courante (= version max).
 */
export function ensureStarterSeance(): Promise<LoadedSeance> {
  if (inFlightStarter) return inFlightStarter;
  inFlightStarter = runEnsureStarterSeance().finally(() => {
    inFlightStarter = null;
  });
  return inFlightStarter;
}

async function runEnsureStarterSeance(): Promise<LoadedSeance> {
  // 1. Une routine existe déjà ? -> on réutilise (idempotence).
  const { data: routines, error: routinesError } = await supabase
    .from('routines')
    .select('id')
    .order('created_at', { ascending: true })
    .limit(1);
  if (routinesError) throw routinesError;

  if (routines && routines.length > 0) {
    return loadFirstSeance(routines[0].id);
  }

  // 2. User neuf : on crée tout. owner_id se remplit via default auth.uid().
  const { data: routine, error: routineErr } = await supabase
    .from('routines')
    .insert({ name: 'Ma routine' })
    .select('id')
    .single();
  if (routineErr) throw routineErr;

  const { data: seance, error: seanceErr } = await supabase
    .from('seances')
    .insert({ routine_id: routine.id, name: 'Upper A', position: 0 })
    .select('id, name')
    .single();
  if (seanceErr) throw seanceErr;

  const { data: version, error: versionErr } = await supabase
    .from('seance_versions')
    .insert({ seance_id: seance.id, version: 1 })
    .select('id')
    .single();
  if (versionErr) throw versionErr;

  // Résolution des ids d'exos de base par NOM (pas de hardcode d'UUID).
  const wantedNames = STARTER_PRESCRIPTIONS.map((p) => p.name);
  const { data: baseExercises, error: exErr } = await supabase
    .from('exercises')
    .select('id, name')
    .in('name', wantedNames);
  if (exErr) throw exErr;

  const idByName = new Map((baseExercises ?? []).map((e) => [e.name, e.id]));

  const prescriptionRows = STARTER_PRESCRIPTIONS.map((p, index) => {
    const exerciseId = idByName.get(p.name);
    if (!exerciseId) {
      throw new Error(
        `Exercice de base introuvable au seed du starter : « ${p.name} ». ` +
          'Vérifie le catalogue de base (migration 0002).',
      );
    }
    return {
      seance_version_id: version.id,
      exercise_id: exerciseId,
      position: index,
      sets_min: p.prescription.sets.min,
      sets_max: p.prescription.sets.max,
      reps_min: p.prescription.reps.min,
      reps_max: p.prescription.reps.max,
      rir_min: p.prescription.rir.min,
      rir_max: p.prescription.rir.max,
    };
  });

  const { error: prescErr } = await supabase.from('prescriptions').insert(prescriptionRows);
  if (prescErr) throw prescErr;

  return {
    seance: { id: seance.id, name: seance.name },
    seanceVersionId: version.id,
  };
}

/** Première séance d'une routine + sa version max (cas user déjà initialisé). */
async function loadFirstSeance(routineId: string): Promise<LoadedSeance> {
  const { data: seance, error: seanceErr } = await supabase
    .from('seances')
    .select('id, name')
    .eq('routine_id', routineId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (seanceErr) throw seanceErr;
  if (!seance) {
    throw new Error('Routine sans séance : impossible de charger la capture.');
  }

  const versionId = await currentVersionId(seance.id);
  return { seance: { id: seance.id, name: seance.name }, seanceVersionId: versionId };
}

/** Id de la version courante (version max) d'une séance. */
async function currentVersionId(seanceId: string): Promise<string> {
  const { data, error } = await supabase
    .from('seance_versions')
    .select('id, version')
    .eq('seance_id', seanceId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new Error(`Séance ${seanceId} sans version : template incomplet.`);
  }
  return data.id;
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

/**
 * Trouve l'exécution du jour (performed_on = aujourd'hui) pour cette version de
 * séance, sinon la crée. Idempotent à l'échelle du jour. Renvoie son id.
 */
export async function findOrCreateTodayExecution(seanceVersionId: string): Promise<string> {
  const today = todayIso();

  const { data: existing, error: findErr } = await supabase
    .from('executions')
    .select('id')
    .eq('seance_version_id', seanceVersionId)
    .eq('performed_on', today)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (findErr) throw findErr;
  if (existing) return existing.id;

  const { data: created, error: createErr } = await supabase
    .from('executions')
    .insert({ seance_version_id: seanceVersionId, performed_on: today })
    .select('id')
    .single();
  if (createErr) throw createErr;
  return created.id;
}

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

// --- Écriture / annulation des séries -----------------------------------------

/** Insère une série loggée pour un exo dans une exécution. */
export async function persistSet(
  executionId: string,
  exerciseId: string,
  set: PerformedSet,
  setOrder: number,
): Promise<void> {
  const { error } = await supabase.from('performed_sets').insert({
    execution_id: executionId,
    exercise_id: exerciseId,
    set_order: setOrder,
    weight_kg: set.weightKg,
    reps: set.reps,
    rir: set.rir,
  });
  if (error) throw error;
}

/**
 * Clôture l'exécution en y posant les métriques saisies en fin de séance :
 * BPM moyen et durée (min). Toutes deux optionnelles (saisie manuelle, niveau
 * séance, cf. décisions produit) — un champ omis ou `null` laisse la colonne
 * inchangée plutôt que de l'effacer, pour qu'une seconde clôture partielle
 * n'écrase pas une valeur déjà posée. `update` typé via `Database`.
 */
export async function finishExecution(
  executionId: string,
  fields: { bpmAvg?: number | null; durationMin?: number | null },
): Promise<void> {
  const patch: Database['public']['Tables']['executions']['Update'] = {};
  if (fields.bpmAvg !== undefined) patch.bpm_avg = fields.bpmAvg;
  if (fields.durationMin !== undefined) patch.duration_min = fields.durationMin;

  // Rien à poser : on évite un update vide (no-op réseau).
  if (Object.keys(patch).length === 0) return;

  const { error } = await supabase.from('executions').update(patch).eq('id', executionId);
  if (error) throw error;
}

/**
 * Supprime la dernière série loggée de cet exo dans l'exécution (« annuler »).
 * « Dernière » = set_order le plus élevé pour ce couple (exécution, exo).
 */
export async function removeLastSet(executionId: string, exerciseId: string): Promise<void> {
  const { data: last, error: findErr } = await supabase
    .from('performed_sets')
    .select('id')
    .eq('execution_id', executionId)
    .eq('exercise_id', exerciseId)
    .order('set_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (findErr) throw findErr;
  if (!last) return; // rien à annuler.

  const { error: delErr } = await supabase.from('performed_sets').delete().eq('id', last.id);
  if (delErr) throw delErr;
}
