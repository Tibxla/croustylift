// Couche d'accès Supabase de l'analyse (surface « au calme »).
//
// On RÉUTILISE la logique du domaine déjà testée — `buildPrimaryCurve` (courbe
// e1RM de la 1ʳᵉ série), `buildSecondaryCurve` (tendance des séries 2+) et
// `weeklyProgressionRate` (pente %/semaine). Cette couche ne fait que LIRE
// Supabase, mapper vers `ExerciseExecution[]`, puis appeler le domaine. Aucune
// logique de calcul ici (cf. data.ts de la capture).
//
// Conventions DB (cf. ADR 0003 + capture/data.ts) :
//   - RLS scope déjà tout à l'utilisateur connecté ; pas de filtre owner_id.
//   - Une `ExerciseExecution` du domaine = les séries d'un exo un jour donné.
import { supabase } from '../../lib/supabase';
import { buildPrimaryCurve } from '../../domain/primary-curve';
import { buildSecondaryCurve } from '../../domain/secondary-curve';
import { weeklyProgressionRate } from '../../domain/progression';
import { detectBlocks } from '../../domain/block';
import { buildConfigTimeline } from './config-timeline';
import type { ExerciseExecution, E1rmPoint, Block } from '../../domain/types';

/** Un exercice pour lequel l'user a au moins une série loggée. */
export interface TrainedExercise {
  exerciseId: string;
  name: string;
}

/**
 * Analyse complète d'un exo : la courbe e1RM (1ʳᵉ série) + la pente %/semaine,
 * plus la courbe secondaire (tendance des séries 2+, subordonnée à la primaire).
 * `weeklyRate` vaut `null` quand il n'y a pas assez de séances pour ajuster une
 * droite (cf. `weeklyProgressionRate`) — l'UI montre alors la courbe sans pente.
 * `secondaryCurve` est `[]` quand aucune exécution n'a de série 2+ : l'UI
 * n'affiche alors aucun graphe secondaire.
 */
export interface ExerciseAnalysis extends TrainedExercise {
  curve: E1rmPoint[];
  secondaryCurve: E1rmPoint[];
  weeklyRate: number | null;
}

// --- Exercices entraînés ------------------------------------------------------

/**
 * Les exercices pour lesquels l'user a au moins une série loggée.
 *
 * On part de `performed_sets` (jointe au nom de l'exo) plutôt que de `exercises`
 * pour ne garder QUE les exos réellement travaillés (un exo du catalogue jamais
 * loggé n'a rien à analyser). On dédoublonne côté client : un même exercise_id
 * revient une fois par série, on n'en garde qu'un.
 */
export async function loadTrainedExercises(): Promise<TrainedExercise[]> {
  const { data, error } = await supabase
    .from('performed_sets')
    .select('exercise_id, exercises ( name )');
  if (error) throw error;

  type Row = { exercise_id: string; exercises: { name: string } | null };
  const rows = (data ?? []) as unknown as Row[];

  const byId = new Map<string, TrainedExercise>();
  for (const row of rows) {
    if (byId.has(row.exercise_id)) continue;
    byId.set(row.exercise_id, {
      exerciseId: row.exercise_id,
      name: row.exercises?.name ?? '(exercice inconnu)',
    });
  }

  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

// --- Exécutions passées d'un exo ----------------------------------------------

/**
 * Les exécutions passées de l'user pour cet exo, dans la forme du domaine
 * (`ExerciseExecution[]`, une par jour, séries triées par order). Calque la
 * lecture de `loadReference` (capture) : on lit les performed_sets + la date de
 * leur exécution, puis on regroupe par exécution.
 */
export async function loadExerciseExecutions(
  exerciseId: string,
): Promise<ExerciseExecution[]> {
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

  return [...byExecution.values()];
}

// --- Composition domaine ------------------------------------------------------

/**
 * Dérive l'analyse (courbe primaire + pente + courbe secondaire) d'un exo à
 * partir de ses exécutions, en passant par les fonctions testées du domaine.
 * Pure : pas d'accès réseau.
 */
export function analyzeExecutions(
  exercise: TrainedExercise,
  executions: ExerciseExecution[],
): ExerciseAnalysis {
  const curve = buildPrimaryCurve(executions, exercise.exerciseId);
  return {
    ...exercise,
    curve,
    secondaryCurve: buildSecondaryCurve(executions, exercise.exerciseId),
    weeklyRate: weeklyProgressionRate(curve),
  };
}

/**
 * Charge tous les exos entraînés et calcule leur analyse en une passe.
 * Une requête pour la liste, puis une par exo (les requêtes par exo tournent en
 * parallèle). L'UI consomme directement le tableau d'`ExerciseAnalysis`.
 */
export async function loadAnalyses(): Promise<ExerciseAnalysis[]> {
  const trained = await loadTrainedExercises();

  const analyses = await Promise.all(
    trained.map(async (exercise) => {
      const executions = await loadExerciseExecutions(exercise.exerciseId);
      return analyzeExecutions(exercise, executions);
    }),
  );

  return analyses;
}

// --- Blocs (config de template inchangée, cf. ADR 0001) -----------------------

/**
 * Les blocs de l'user : périodes continues de configuration de template
 * inchangée. On LIT le journal des changements de plan (activations de routine +
 * versions de séances + le lien séance->routine), on construit la timeline de
 * configs via le module pur `buildConfigTimeline`, puis on la passe à
 * `detectBlocks`. Aucune lecture d'exécution ici : une déviation ne peut pas
 * créer de bloc (cf. ADR 0001). Pas de logique de calcul dans cette couche.
 */
export async function loadBlocks(): Promise<Block[]> {
  const [activationsRes, versionsRes, seancesRes] = await Promise.all([
    supabase.from('routine_activations').select('activated_at, routine_id'),
    supabase.from('seance_versions').select('created_at, seance_id'),
    supabase.from('seances').select('id, routine_id'),
  ]);
  if (activationsRes.error) throw activationsRes.error;
  if (versionsRes.error) throw versionsRes.error;
  if (seancesRes.error) throw seancesRes.error;

  const timeline = buildConfigTimeline({
    activations: (activationsRes.data ?? []).map((r) => ({
      activatedAt: r.activated_at,
      routineId: r.routine_id,
    })),
    seanceVersions: (versionsRes.data ?? []).map((r) => ({
      createdAt: r.created_at,
      seanceId: r.seance_id,
    })),
    seances: (seancesRes.data ?? []).map((r) => ({
      id: r.id,
      routineId: r.routine_id,
    })),
  });

  return detectBlocks(timeline);
}
