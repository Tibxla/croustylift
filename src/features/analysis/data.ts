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
import { afterId, fetchAllRows, inCreationOrder } from '../../lib/fetch-all';
import { buildPrimaryCurve } from '../../domain/primary-curve';
import { buildSecondaryCurve } from '../../domain/secondary-curve';
import { weeklyProgressionRate } from '../../domain/progression';
import { detectBlocks } from '../../domain/block';
import { buildConfigTimeline, type FirstExecutionRow } from './config-timeline';
import { orderByPlan, planExerciseOrder } from './exercise-order';
import { getCurrentRoutineId, listRoutines } from '../authoring/data';
import { currentVersionIdBySeance } from '../authoring/duplicate-seance';
import { resolveCaptureRoutineId } from '../capture/data';
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
 * pas la même perf selon le contexte de fatigue de la séance (cf. GLOSSARY.md
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
 * Une ligne `performed_sets` jointe à son exécution, sa séance et son exo : la
 * forme lue par l'Analyse, que la lecture porte sur un exo ou sur tous.
 */
export interface ExecutionSetRow {
  id: string;
  created_at: string;
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
    created_at: string;
    started_at: string | null;
    seance_versions: {
      seance_id: string;
      seances: {
        name: string;
        routine_id: string;
        routines: { name: string } | null;
      } | null;
    } | null;
  } | null;
}

const EXECUTION_SET_SELECT =
  'id, created_at, weight_kg, reps, rir, set_order, side, execution_id, exercise_id, exercises ( name ), executions ( performed_on, created_at, started_at, seance_versions ( seance_id, seances ( name, routine_id, routines ( name ) ) ) )';

/** Les exécutions d'un exo, avec son nom de catalogue (`null` si l'exo a disparu). */
export interface ExerciseExecutions extends LoadedExecutions {
  name: string | null;
}

/**
 * Répartit des séries lues PAR EXO, dans la forme du domaine : pour chaque exo,
 * ses `ExerciseExecution[]` (une par exécution, séries dans l'ordre de saisie),
 * chacune portant sa SÉANCE (`seanceId`, via executions → seance_versions →
 * seance_id : les versions sont des retouches du même template), le scope des
 * courbes par séance (issue #67). Porte aussi `createdAt`/`id` (départage de
 * deux exécutions le même jour, `compareCurvePoints`) et `startedAt` (l'instant
 * qui rattache l'exécution à son bloc, ADR 0001). Les noms de séances remontent
 * à part (le domaine reste sans nom). Pure : les lignes peuvent arriver dans
 * n'importe quel ordre (la pagination trie par id).
 */
export function groupExecutionRows(rows: ExecutionSetRow[]): Map<string, ExerciseExecutions> {
  const byExercise = new Map<string, ExerciseExecutions>();
  // Une exécution couvre plusieurs exos : la clé est (exo, exécution).
  const byExecution = new Map<string, ExerciseExecution>();
  for (const row of inCreationOrder(rows)) {
    const execution = row.executions;
    if (!execution) continue; // garde-fou : série orpheline d'exécution.
    let exercise = byExercise.get(row.exercise_id);
    if (!exercise) {
      exercise = { name: row.exercises?.name ?? null, executions: [], seances: new Map() };
      byExercise.set(row.exercise_id, exercise);
    }
    const seanceId = execution.seance_versions?.seance_id;
    if (seanceId && !exercise.seances.has(seanceId)) {
      const seance = execution.seance_versions?.seances;
      exercise.seances.set(seanceId, {
        name: seance?.name ?? '(séance inconnue)',
        routineId: seance?.routine_id ?? null,
        routineName: seance?.routines?.name ?? null,
      });
    }
    const key = `${row.exercise_id}:${row.execution_id}`;
    let exec = byExecution.get(key);
    if (!exec) {
      exec = {
        date: execution.performed_on,
        exerciseId: row.exercise_id,
        sets: [],
        createdAt: execution.created_at,
        id: row.execution_id,
        seanceId,
      };
      // Lancement horodaté (ADR 0011) : l'instant qui rattache l'exécution à son
      // bloc. `null` sur les exécutions d'avant la colonne -> repli `createdAt`.
      if (execution.started_at) exec.startedAt = execution.started_at;
      byExecution.set(key, exec);
      exercise.executions.push(exec);
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
  return byExercise;
}

/**
 * Les exécutions passées de l'user pour UN exo (cf. `groupExecutionRows`), pour
 * la comparaison de blocs d'une carte. Lecture paginée (cf. lib/fetch-all) : un
 * exo très pratiqué dépasse le plafond de 1000 lignes, et la courbe perdait
 * alors des exécutions.
 */
export async function loadExerciseExecutions(
  exerciseId: string,
): Promise<LoadedExecutions> {
  const rows = await fetchAllRows<ExecutionSetRow>((after, limit) =>
    afterId(
      supabase
        .from('performed_sets')
        .select(EXECUTION_SET_SELECT)
        .eq('exercise_id', exerciseId)
        .order('id')
        .limit(limit),
      after,
    ),
  );
  const grouped = groupExecutionRows(rows).get(exerciseId);
  return { executions: grouped?.executions ?? [], seances: grouped?.seances ?? new Map() };
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
 * L'ordre des exos du plan de la routine courante (cf. exercise-order.ts) :
 * séances actives par position, puis exos de leur version COURANTE par position.
 * Même routine qu'en salle : la courante, sinon la 1ʳᵉ routine non archivée
 * (`resolveCaptureRoutineId`). `[]` sans routine ou sans séance : l'Analyse
 * retombe alors sur l'ordre alphabétique.
 */
export async function loadPlanExerciseOrder(): Promise<string[]> {
  const [currentRoutineId, routines] = await Promise.all([
    getCurrentRoutineId(),
    listRoutines(),
  ]);
  const routineId = resolveCaptureRoutineId(
    currentRoutineId,
    routines.filter((r) => r.archived_at === null).map((r) => r.id),
  );
  if (routineId === null) return [];

  const seancesRes = await supabase
    .from('seances')
    .select('id, position')
    .eq('routine_id', routineId)
    .is('archived_at', null);
  if (seancesRes.error) throw seancesRes.error;
  const seances = seancesRes.data ?? [];
  if (seances.length === 0) return [];

  // Toutes les versions de ces séances (append-only, ADR 0001) : paginé, sinon
  // la « version courante » pouvait être une version ancienne passé 1000 lignes.
  const versions = await fetchAllRows<{ id: string; seance_id: string; version: number }>(
    (after, limit) =>
      afterId(
        supabase
          .from('seance_versions')
          .select('id, seance_id, version')
          .in(
            'seance_id',
            seances.map((s) => s.id),
          )
          .order('id')
          .limit(limit),
        after,
      ),
  );
  // Version courante de chaque séance -> la séance qu'elle porte.
  const seanceOfVersion = new Map(
    [...currentVersionIdBySeance(versions)].map(([seanceId, versionId]) => [
      versionId,
      seanceId,
    ]),
  );
  if (seanceOfVersion.size === 0) return [];

  // Paginé comme les versions : passé 1000 prescriptions sur les versions
  // courantes, l'ordre du plan perdait des exos en silence.
  const prescriptions = await fetchAllRows<{
    id: string;
    seance_version_id: string;
    exercise_id: string;
    position: number;
  }>((after, limit) =>
    afterId(
      supabase
        .from('prescriptions')
        .select('id, seance_version_id, exercise_id, position')
        .in('seance_version_id', [...seanceOfVersion.keys()])
        .order('id')
        .limit(limit),
      after,
    ),
  );

  return planExerciseOrder(
    seances,
    prescriptions.flatMap((p) => {
      const seanceId = seanceOfVersion.get(p.seance_version_id);
      return seanceId ? [{ seanceId, exerciseId: p.exercise_id, position: p.position }] : [];
    }),
  );
}

/**
 * Charge tous les exos entraînés et calcule leur analyse en une passe, dans
 * l'ordre du plan de la routine courante puis par nom (décision du 2026-09-13).
 *
 * UNE lecture paginée de toutes les séries, regroupée par exo côté client
 * (`groupExecutionRows`). À ne pas refaire : une requête par exo. Trente exos
 * coûtaient une trentaine d'allers-retours en parallèle, après une première
 * lecture de toutes les séries qui ne servait qu'à lister les exos.
 *
 * Un exo n'apparaît que s'il a au moins une série loggée (un exo du catalogue
 * jamais travaillé n'a rien à analyser), sous son nom personnalisé per-user
 * (issue #50), le même que partout ailleurs.
 */
export async function loadAnalyses(): Promise<ExerciseAnalysis[]> {
  const [rows, overrides, planOrder] = await Promise.all([
    fetchAllRows<ExecutionSetRow>((after, limit) =>
      afterId(
        supabase.from('performed_sets').select(EXECUTION_SET_SELECT).order('id').limit(limit),
        after,
      ),
    ),
    loadExerciseOverrides(),
    loadPlanExerciseOrder(),
  ]);

  const grouped = groupExecutionRows(rows);
  const trainedByName: TrainedExercise[] = [...grouped].map(([exerciseId, exercise]) => ({
    exerciseId,
    name: overriddenName(exercise.name ?? '(exercice inconnu)', overrides.get(exerciseId)),
  }));

  return orderByPlan(trainedByName, planOrder).map((exercise) => {
    const { executions, seances } = grouped.get(exercise.exerciseId)!;
    return analyzeExecutions(exercise, executions, seances);
  });
}

// --- Blocs (config de template inchangée, cf. ADR 0001) -----------------------

/**
 * Les blocs de l'user : périodes continues de configuration de template
 * inchangée. On LIT le journal des changements de plan (activations de routine +
 * versions de séances + archivages de séances + le lien séance->routine), on construit la timeline de
 * configs via le module pur `buildConfigTimeline`, puis on la passe à
 * `detectBlocks`. Aucune série n'est lue : une déviation ne peut pas créer de
 * bloc (cf. ADR 0001). La seule exécution lue est la PREMIÈRE du compte, pour le
 * bloc implicite d'avant toute activation (cf. `loadFirstExecution`). Pas de
 * logique de calcul dans cette couche.
 */
export async function loadBlocks(): Promise<Block[]> {
  // Quatre journaux qui ne font que grossir avec l'âge du compte : lus en entier,
  // page par page (cf. lib/fetch-all), sinon un bloc ancien ou récent sautait
  // en silence passé 1000 lignes.
  const [activations, versions, seances, archives, firstExecution] = await Promise.all([
    fetchAllRows<{ id: string; activated_at: string; routine_id: string }>((after, limit) =>
      afterId(
        supabase
          .from('routine_activations')
          .select('id, activated_at, routine_id')
          .order('id')
          .limit(limit),
        after,
      ),
    ),
    fetchAllRows<{ id: string; created_at: string; seance_id: string }>((after, limit) =>
      afterId(
        supabase
          .from('seance_versions')
          .select('id, created_at, seance_id')
          .order('id')
          .limit(limit),
        after,
      ),
    ),
    fetchAllRows<{ id: string; routine_id: string }>((after, limit) =>
      afterId(supabase.from('seances').select('id, routine_id').order('id').limit(limit), after),
    ),
    // Archivages datés (ADR 0017) : archiver une séance de la routine courante
    // change la configuration du template, donc coupe un bloc.
    fetchAllRows<{ id: string; occurred_at: string; seance_id: string; archived: boolean }>((after, limit) =>
      afterId(
        supabase
          .from('seance_archive_events')
          .select('id, occurred_at, seance_id, archived')
          .order('id')
          .limit(limit),
        after,
      ),
    ),
    loadFirstExecution(),
  ]);

  const timeline = buildConfigTimeline({
    activations: activations.map((r) => ({
      activatedAt: r.activated_at,
      routineId: r.routine_id,
    })),
    seanceVersions: versions.map((r) => ({
      createdAt: r.created_at,
      seanceId: r.seance_id,
    })),
    seances: seances.map((r) => ({
      id: r.id,
      routineId: r.routine_id,
    })),
    seanceArchiveEvents: archives.map((r) => ({
      occurredAt: r.occurred_at,
      seanceId: r.seance_id,
      archived: r.archived,
    })),
    firstExecution,
  });

  return detectBlocks(timeline);
}

/**
 * La plus ancienne exécution du compte rattachée à une séance, avec la routine
 * de cette séance. Sert au seul bloc implicite : un compte qui a capturé avant
 * d'activer une routine (la Capture se replie sur la première non archivée)
 * n'avait aucun bloc pour ces séances-là. Une ligne lue, jamais plus. `null`
 * sans exécution rattachée.
 */
async function loadFirstExecution(): Promise<FirstExecutionRow | null> {
  type Row = {
    performed_on: string;
    created_at: string;
    started_at: string | null;
    seance_versions: { seances: { routine_id: string } | null } | null;
  };
  const { data, error } = await supabase
    .from('executions')
    .select(
      'performed_on, created_at, started_at, seance_versions!inner ( seances!inner ( routine_id ) )',
    )
    .order('performed_on')
    .order('created_at')
    .limit(1);
  if (error) throw error;
  const row = ((data ?? []) as unknown as Row[])[0];
  const routineId = row?.seance_versions?.seances?.routine_id;
  if (!row || !routineId) return null;
  return { date: row.performed_on, at: row.started_at ?? row.created_at, routineId };
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
  type Row = {
    id: string;
    created_at: string;
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
      created_at: string;
      bpm_avg: number | null;
      duration_min: number | null;
      seance_versions: {
        seances: { name: string; routines: { name: string } | null } | null;
      } | null;
    } | null;
  };
  // TOUT l'historique, donc lecture paginée (cf. lib/fetch-all) : sans elle le
  // Journal s'arrêtait à 1000 séries, dans un ordre non garanti (séances
  // récentes absentes, exécution à cheval amputée). Ordre de saisie, `id` en
  // départage pour un tri total.
  const [rows, overrides] = await Promise.all([
    fetchAllRows<Row>((after, limit) =>
      afterId(
        supabase
          .from('performed_sets')
          .select(
            'id, created_at, weight_kg, reps, rir, set_order, side, execution_id, exercise_id, exercises ( name ), executions ( performed_on, created_at, bpm_avg, duration_min, seance_versions ( seances ( name, routines ( name ) ) ) )',
          )
          .order('id')
          .limit(limit),
        after,
      ),
    ),
    // Nom personnalisé per-user (issue #50) : le log brut affiche le nom override.
    loadExerciseOverrides(),
  ]);

  return buildRawLog(
    inCreationOrder(rows).flatMap((row) => {
      const execution = row.executions;
      if (!execution) return []; // garde-fou : série orpheline d'exécution.
      return [
        {
          executionId: row.execution_id,
          date: execution.performed_on,
          // Départage deux exécutions du même jour (la plus récente en tête).
          createdAt: execution.created_at,
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
  // + GLOSSARY.md). Sans ce décompte, une orpheline (durée posée mais zéro série)
  // s'afficherait sur le graphe alors qu'elle n'apparaît pas au journal.
  type Row = {
    id: string;
    created_at: string;
    performed_on: string;
    bpm_avg: number | null;
    duration_min: number | null;
    // PostgREST renvoie l'agrégat `count` sous forme de tableau à un élément.
    performed_sets: { count: number }[] | null;
  };
  // Une ligne par exécution, sur tout l'historique : paginé (cf. lib/fetch-all).
  const rows = await fetchAllRows<Row>((after, limit) =>
    afterId(
      supabase
        .from('executions')
        .select('id, created_at, performed_on, bpm_avg, duration_min, performed_sets(count)')
        .order('id')
        .limit(limit),
      after,
    ),
  );

  return buildSessionMetrics(
    inCreationOrder(rows).map((row) => ({
      date: row.performed_on,
      bpmAvg: row.bpm_avg === null ? null : Number(row.bpm_avg),
      durationMin: row.duration_min === null ? null : Number(row.duration_min),
      hasSets: (row.performed_sets?.[0]?.count ?? 0) > 0,
      createdAt: row.created_at,
    })),
  );
}
