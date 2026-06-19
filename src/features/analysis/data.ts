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
import { buildRawLog, type RawLogEntry } from './raw-log';
import { buildSessionMetrics, type SessionMetricPoint } from './session-metrics';
import type { ExerciseExecution, E1rmPoint, Block } from '../../domain/types';
import { loadExerciseOverrides } from '../exercises/overrides';
import {
  mergeExerciseOverride,
  type ExerciseOverrideValues,
} from '../../domain/exercise-override';

/**
 * Nom d'exo personnalisé per-user (issue #50), via la règle PURE de fusion. Seul
 * le nom est concerné en analyse : l'unilatéral / les muscles n'y servent pas
 * (la courbe e1RM côté faible #46 dérive de `side` déjà loggé, pas du champ exo).
 * On passe des valeurs neutres pour les autres champs (jamais utilisées ici).
 */
function overriddenName(
  name: string,
  override: ExerciseOverrideValues | undefined,
): string {
  return mergeExerciseOverride(
    { name, unilateral: false, primaryMuscles: [] },
    override ?? null,
  ).name;
}

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
  const [{ data, error }, overrides] = await Promise.all([
    supabase.from('performed_sets').select('exercise_id, exercises ( name )'),
    // Nom personnalisé per-user (issue #50) : l'analyse affiche le même nom que
    // partout ailleurs (catalogue, Capture, log brut).
    loadExerciseOverrides(),
  ]);
  if (error) throw error;

  type Row = { exercise_id: string; exercises: { name: string } | null };
  const rows = (data ?? []) as unknown as Row[];

  const byId = new Map<string, TrainedExercise>();
  for (const row of rows) {
    if (byId.has(row.exercise_id)) continue;
    byId.set(row.exercise_id, {
      exerciseId: row.exercise_id,
      name: overriddenName(
        row.exercises?.name ?? '(exercice inconnu)',
        overrides.get(row.exercise_id),
      ),
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
    .select('weight_kg, reps, rir, set_order, side, execution_id, executions ( performed_on )')
    .eq('exercise_id', exerciseId);
  if (error) throw error;

  type SetRow = {
    weight_kg: number;
    reps: number;
    rir: number;
    set_order: number;
    side: string | null;
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
      // Côté unilatéral (issue #46) : la courbe primaire suit le côté faible
      // (weakSideE1rm) -> le domaine a besoin des deux côtés. null = bilatéral.
      side: row.side === 'left' || row.side === 'right' ? row.side : undefined,
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

// --- Comparaison de deux blocs d'un exo (cf. issue #6) ------------------------

/** Les données brutes pour comparer les blocs d'un exo : ses exécutions + les blocs. */
export interface BlockComparisonData {
  executions: ExerciseExecution[];
  blocks: Block[];
}

/**
 * Charge de quoi comparer les blocs d'un exo : ses exécutions passées et la
 * liste des blocs de l'user (lus en parallèle). Le DÉCOUPAGE par bloc, les
 * pentes %/semaine et le verdict sont calculés par le domaine pur
 * (`summarizeBlocks` / `compareBlocks`) à partir de ces données ; cette couche
 * ne fait que les charger. Les blocs ne dépendent pas de l'exo (ils suivent la
 * config de template, cf. ADR 0001), seules les exécutions sont filtrées par exo.
 */
export async function loadBlockComparisonData(
  exerciseId: string,
): Promise<BlockComparisonData> {
  const [executions, blocks] = await Promise.all([
    loadExerciseExecutions(exerciseId),
    loadBlocks(),
  ]);
  return { executions, blocks };
}

// --- Log brut des lifts (cf. issue #27) ---------------------------------------

/**
 * Le log brut enrichi de l'user (cf. issue #32) : toutes ses séries loggées,
 * regroupées par exécution puis par exo (cf. `buildRawLog`), chaque exécution
 * portant ses métadonnées de séance (nom, BPM, durée) pour l'en-tête de récap.
 * On lit `performed_sets` joint à la date + métriques de l'exécution, au nom de
 * l'exo, et au nom de la séance via `executions → seance_versions → seances`
 * (calque `loadExerciseExecutions`, sans filtre d'exo : on veut TOUT
 * l'historique). RLS scope déjà à l'user connecté. Le BPM, la durée et le nom de
 * séance sont OPTIONNELS (exécution hors-template, métriques facultatives) et
 * restent `null` pour ne pas inventer de récap. Le regroupement/tri est fait par
 * le module pur `buildRawLog` ; cette couche ne fait que mapper et déléguer.
 */
export async function loadRawLog(): Promise<RawLogEntry[]> {
  const [{ data, error }, overrides] = await Promise.all([
    supabase
      .from('performed_sets')
      .select(
        'weight_kg, reps, rir, set_order, side, execution_id, exercise_id, exercises ( name ), executions ( performed_on, bpm_avg, duration_min, seance_versions ( seances ( name ) ) )',
      ),
    // Nom personnalisé per-user (issue #50) : le log brut affiche le nom override.
    loadExerciseOverrides(),
  ]);
  if (error) throw error;

  type Row = {
    weight_kg: number;
    reps: number;
    rir: number;
    set_order: number;
    side: string | null;
    execution_id: string;
    exercise_id: string;
    exercises: { name: string } | null;
    executions: {
      performed_on: string;
      bpm_avg: number | null;
      duration_min: number | null;
      seance_versions: { seances: { name: string } | null } | null;
    } | null;
  };
  const rows = (data ?? []) as unknown as Row[];

  return buildRawLog(
    rows.flatMap((row) => {
      const execution = row.executions;
      if (!execution) return []; // garde-fou : série orpheline d'exécution.
      return [
        {
          executionId: row.execution_id,
          date: execution.performed_on,
          exerciseId: row.exercise_id,
          exerciseName: overriddenName(
            row.exercises?.name ?? '(exercice inconnu)',
            overrides.get(row.exercise_id),
          ),
          sessionName: execution.seance_versions?.seances?.name ?? null,
          bpmAvg: execution.bpm_avg === null ? null : Number(execution.bpm_avg),
          durationMin:
            execution.duration_min === null ? null : Number(execution.duration_min),
          set: {
            weightKg: Number(row.weight_kg),
            reps: row.reps,
            rir: row.rir,
            order: row.set_order,
            // Côté unilatéral (ADR 0005) : deux lignes au même order, libellées
            // G/D dans le journal. null (bilatéral) -> undefined, comme ailleurs.
            side: row.side === 'left' || row.side === 'right' ? row.side : undefined,
          },
        },
      ];
    }),
  );
}

// --- BPM moyen + durée de séance (cf. issue #28) ------------------------------

/**
 * Les points BPM/durée de l'user dans le temps (cf. `buildSessionMetrics`). On
 * lit directement `executions` (date + les deux métriques de séance), scopé RLS.
 * Le filtrage (au moins une métrique) et le tri sont faits par le module pur ;
 * cette couche ne fait que mapper et déléguer. Renvoie [] si aucune métrique :
 * l'UI n'affiche alors pas de graphe.
 */
export async function loadSessionMetrics(): Promise<SessionMetricPoint[]> {
  const { data, error } = await supabase
    .from('executions')
    .select('performed_on, bpm_avg, duration_min');
  if (error) throw error;

  type Row = {
    performed_on: string;
    bpm_avg: number | null;
    duration_min: number | null;
  };
  const rows = (data ?? []) as unknown as Row[];

  return buildSessionMetrics(
    rows.map((row) => ({
      date: row.performed_on,
      bpmAvg: row.bpm_avg === null ? null : Number(row.bpm_avg),
      durationMin: row.duration_min === null ? null : Number(row.duration_min),
    })),
  );
}
