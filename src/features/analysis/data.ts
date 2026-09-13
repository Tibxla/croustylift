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
 * La progression d'un exo DANS UNE séance donnée (décision 2026-07-31, issue
 * #67) : sa courbe e1RM (1ʳᵉ série), sa pente %/semaine et sa courbe secondaire
 * (séries 2+), dérivées des seules exécutions de cette séance — un même exo n'a
 * pas la même perf selon le contexte de fatigue de la séance (cf. CONTEXT.md
 * « Référence », même logique que le scope de la Capture).
 * `weeklyRate` vaut `null` sans assez de points pour ajuster une droite ;
 * `secondaryCurve` est `[]` sans série 2+.
 */
export interface SeanceCurve {
  /** Id de la séance (toutes versions), ou `null` si la séance n'est plus résoluble. */
  seanceId: string | null;
  seanceName: string;
  /** Nom de la routine de la séance, `null` pour « Hors séance ». */
  routineName: string | null;
  /**
   * Libellé de la courbe sur la carte (légende, tooltip, readout héros) : le nom
   * de la séance, suivi de « · routine » sur TOUTES les entrées dès que la carte
   * mêle plusieurs routines (ADR 0016). Un nom de séance n'est unique que dans
   * sa routine : sans ce suffixe, « Push » de PPL et de PPL v2 se confondraient.
   */
  label: string;
  curve: E1rmPoint[];
  secondaryCurve: E1rmPoint[];
  weeklyRate: number | null;
  /** Date du dernier point : départage la séance mise en avant (l'accent). */
  lastDate: string;
}

/**
 * Analyse complète d'un exo : une courbe PAR SÉANCE où il a été exécuté. La
 * première entrée est la séance la plus récemment exécutée — c'est ELLE qui
 * porte l'accent, le readout héros, la pente et le graphe secondaire dans l'UI ;
 * les autres se superposent en subordonné. Jamais vide pour un exo entraîné
 * (au moins une série loggée → au moins un point quelque part).
 */
export interface ExerciseAnalysis extends TrainedExercise {
  seanceCurves: SeanceCurve[];
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

/** Ce qu'il faut savoir d'une séance pour la libeller : son nom et sa routine. */
export interface SeanceInfo {
  name: string;
  routineId: string | null;
  routineName: string | null;
}

/** Exécutions d'un exo + séances rencontrées (pour libeller les courbes). */
export interface LoadedExecutions {
  executions: ExerciseExecution[];
  /** seanceId -> nom et routine, pour toutes les séances présentes dans `executions`. */
  seances: Map<string, SeanceInfo>;
}

/**
 * Les exécutions passées de l'user pour cet exo, dans la forme du domaine
 * (`ExerciseExecution[]`, une par jour, séries triées par order), chacune
 * portant sa SÉANCE (`seanceId`, via executions → seance_versions → seance_id :
 * les versions sont des retouches du même template) — le scope des courbes par
 * séance (issue #67). Porte aussi `createdAt`/`id` : sans eux le tie-break de
 * `compareCurvePoints` (deux exécutions le même jour) était inopérant côté
 * Analyse. Les noms de séances remontent à part (le domaine reste sans nom).
 */
export async function loadExerciseExecutions(
  exerciseId: string,
): Promise<LoadedExecutions> {
  const { data, error } = await supabase
    .from('performed_sets')
    .select(
      'weight_kg, reps, rir, set_order, side, execution_id, executions ( performed_on, created_at, seance_versions ( seance_id, seances ( name, routine_id, routines ( name ) ) ) )',
    )
    .eq('exercise_id', exerciseId);
  if (error) throw error;

  type SetRow = {
    weight_kg: number;
    reps: number;
    rir: number;
    set_order: number;
    side: string | null;
    execution_id: string;
    executions: {
      performed_on: string;
      created_at: string;
      seance_versions: {
        seance_id: string;
        seances: {
          name: string;
          routine_id: string;
          routines: { name: string } | null;
        } | null;
      } | null;
    } | null;
  };
  const rows = (data ?? []) as unknown as SetRow[];

  const byExecution = new Map<string, ExerciseExecution>();
  const seances = new Map<string, SeanceInfo>();
  for (const row of rows) {
    const execution = row.executions;
    if (!execution) continue; // garde-fou : exécution orpheline.
    const seanceId = execution.seance_versions?.seance_id;
    if (seanceId && !seances.has(seanceId)) {
      const seance = execution.seance_versions?.seances;
      seances.set(seanceId, {
        name: seance?.name ?? '(séance inconnue)',
        routineId: seance?.routine_id ?? null,
        routineName: seance?.routines?.name ?? null,
      });
    }
    let exec = byExecution.get(row.execution_id);
    if (!exec) {
      exec = {
        date: execution.performed_on,
        exerciseId,
        sets: [],
        createdAt: execution.created_at,
        id: row.execution_id,
        seanceId,
      };
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

  return { executions: [...byExecution.values()], seances };
}

// --- Composition domaine ------------------------------------------------------

/**
 * Dérive l'analyse d'un exo PAR SÉANCE (issue #67) : ses exécutions groupées
 * par `seanceId`, chaque groupe passé aux fonctions testées du domaine (courbe
 * primaire + pente + courbe secondaire). Les exécutions sans séance résoluble
 * forment un groupe « Hors séance » (jamais de donnée écartée en silence). Tri :
 * la séance la plus récemment exécutée d'abord (elle porte l'accent dans l'UI),
 * libellé en départage pour rester stable. Pure : pas d'accès réseau.
 */
export function analyzeExecutions(
  exercise: TrainedExercise,
  executions: ExerciseExecution[],
  seances: ReadonlyMap<string, SeanceInfo>,
): ExerciseAnalysis {
  const groups = new Map<string | null, ExerciseExecution[]>();
  for (const execution of executions) {
    const key = execution.seanceId ?? null;
    const group = groups.get(key);
    if (group) group.push(execution);
    else groups.set(key, [execution]);
  }

  const seanceCurves: SeanceCurve[] = [];
  const routineIds = new Set<string>();
  for (const [seanceId, group] of groups) {
    const curve = buildPrimaryCurve(group, exercise.exerciseId);
    // Un groupe sans point (exécutions vides / autre exo) n'est pas une courbe.
    if (curve.length === 0) continue;
    const info = seanceId === null ? null : seances.get(seanceId);
    if (info?.routineId) routineIds.add(info.routineId);
    const seanceName =
      seanceId === null ? 'Hors séance' : info?.name ?? '(séance inconnue)';
    seanceCurves.push({
      seanceId,
      seanceName,
      routineName: info?.routineName ?? null,
      label: seanceName,
      curve,
      secondaryCurve: buildSecondaryCurve(group, exercise.exerciseId),
      weeklyRate: weeklyProgressionRate(curve),
      lastDate: curve[curve.length - 1]?.date ?? '',
    });
  }

  // La règle porte sur la carte entière, courbes masquées comprises : un libellé
  // ne change pas selon ce qu'on affiche.
  if (routineIds.size > 1) {
    for (const sc of seanceCurves) {
      if (sc.seanceId !== null && sc.routineName) {
        sc.label = `${sc.seanceName} · ${sc.routineName}`;
      }
    }
  }

  seanceCurves.sort(
    (a, b) =>
      b.lastDate.localeCompare(a.lastDate) || a.label.localeCompare(b.label, 'fr'),
  );

  return { ...exercise, seanceCurves };
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
      const { executions, seances } = await loadExerciseExecutions(exercise.exerciseId);
      return analyzeExecutions(exercise, executions, seances);
    }),
  );

  return analyses;
}

// --- Blocs (config de template inchangée, cf. ADR 0001) -----------------------

/**
 * Les blocs de l'user : périodes continues de configuration de template
 * inchangée. On LIT le journal des changements de plan (activations de routine +
 * versions de séances + archivages de séances + le lien séance->routine), on construit la timeline de
 * configs via le module pur `buildConfigTimeline`, puis on la passe à
 * `detectBlocks`. Aucune lecture d'exécution ici : une déviation ne peut pas
 * créer de bloc (cf. ADR 0001). Pas de logique de calcul dans cette couche.
 */
export async function loadBlocks(): Promise<Block[]> {
  const [activationsRes, versionsRes, seancesRes, archivesRes] = await Promise.all([
    supabase.from('routine_activations').select('activated_at, routine_id'),
    supabase.from('seance_versions').select('created_at, seance_id'),
    supabase.from('seances').select('id, routine_id'),
    // Archivages datés (ADR 0017) : archiver une séance de la routine courante
    // change la configuration du template, donc coupe un bloc.
    supabase.from('seance_archive_events').select('occurred_at, seance_id, archived'),
  ]);
  if (activationsRes.error) throw activationsRes.error;
  if (versionsRes.error) throw versionsRes.error;
  if (seancesRes.error) throw seancesRes.error;
  if (archivesRes.error) throw archivesRes.error;

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
    seanceArchiveEvents: (archivesRes.data ?? []).map((r) => ({
      occurredAt: r.occurred_at,
      seanceId: r.seance_id,
      archived: r.archived,
    })),
  });

  return detectBlocks(timeline);
}

// --- Comparaison de deux blocs d'un exo (cf. issue #6) ------------------------

/** Les données brutes pour comparer les blocs d'un exo : ses exécutions, les blocs, les séances. */
export interface BlockComparisonData {
  executions: ExerciseExecution[];
  blocks: Block[];
  /** seanceId -> nom et routine, pour libeller chaque option « séance · routine · dates ». */
  seances: Map<string, SeanceInfo>;
}

/**
 * Charge de quoi comparer les blocs d'un exo : ses exécutions passées (toutes
 * séances), la liste des blocs de l'user et le nom de chaque séance avec sa
 * routine (lus en parallèle). Les couples bloc + séance, les pentes %/semaine et
 * le verdict sont calculés par le domaine pur (`summarizeBlockSeances` /
 * `compareBlockSeances`) : chaque option lit UNE séance dans UN bloc, ce qui
 * permet de comparer deux routines sans mêler deux contextes de fatigue dans une
 * même pente (ADR 0016). Les blocs ne dépendent pas de l'exo (ADR 0001).
 */
export async function loadBlockComparisonData(
  exerciseId: string,
): Promise<BlockComparisonData> {
  const [{ executions, seances }, blocks] = await Promise.all([
    loadExerciseExecutions(exerciseId),
    loadBlocks(),
  ]);
  return { executions, blocks, seances };
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
        'weight_kg, reps, rir, set_order, side, execution_id, exercise_id, exercises ( name ), executions ( performed_on, bpm_avg, duration_min, seance_versions ( seances ( name, routines ( name ) ) ) )',
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
      seance_versions: {
        seances: { name: string; routines: { name: string } | null } | null;
      } | null;
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
          routineName: execution.seance_versions?.seances?.routines?.name ?? null,
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
  // On compte les séries par exécution (`performed_sets(count)`) : une exécution
  // SANS série n'est pas un point (garde « exécution vide », cf. buildSessionMetrics
  // + CONTEXT.md). Sans ce décompte, une orpheline (durée posée mais zéro série)
  // s'afficherait sur le graphe alors qu'elle n'apparaît pas au journal.
  const { data, error } = await supabase
    .from('executions')
    .select('performed_on, bpm_avg, duration_min, performed_sets(count)');
  if (error) throw error;

  type Row = {
    performed_on: string;
    bpm_avg: number | null;
    duration_min: number | null;
    // PostgREST renvoie l'agrégat `count` sous forme de tableau à un élément.
    performed_sets: { count: number }[] | null;
  };
  const rows = (data ?? []) as unknown as Row[];

  return buildSessionMetrics(
    rows.map((row) => ({
      date: row.performed_on,
      bpmAvg: row.bpm_avg === null ? null : Number(row.bpm_avg),
      durationMin: row.duration_min === null ? null : Number(row.duration_min),
      hasSets: (row.performed_sets?.[0]?.count ?? 0) > 0,
    })),
  );
}
