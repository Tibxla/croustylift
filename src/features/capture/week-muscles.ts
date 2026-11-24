// Chargeur de la fin de séance : ce que `weekSetsByMuscle` (session-recap.ts)
// attend en plus de l'état de capture. LECTURE SEULE, aucune écriture.
//
//   - AVANT : les séries des AUTRES exécutions de la semaine civile faites AVANT
//     la séance close, lues en base : du lundi (`weekStartIso` sur la date
//     adoptée de la séance) à la veille de cette date, plus celles du même jour
//     commencées avant elle (`isBefore`). Une séance lancée le lundi et rangée
//     le jeudi ne compte donc pas le mardi ni le mercredi. L'exécution en cours
//     est exclue : ses séries déjà envoyées sont comptées dans « aujourd'hui »,
//     depuis l'état de capture. Les muscles et le drapeau
//     unilatéral passent par les overrides de l'utilisateur (comme la Capture).
//     Lecture paginée par curseur sur `id` (`fetchAllRows` : le plafond de 1000
//     lignes de PostgREST tronque en silence), par le client habituel (délai et
//     erreurs déjà bornés, lib/supabase). Pas de copie locale : hors ligne, la
//     lecture échoue et l'écran le dit.
//   - PRÉVU : les prescriptions de TOUTES les séances de la routine de la Capture,
//     par les lectures en cache de capture/data (`loadCaptureSource`,
//     `loadChosenSeance`, `loadSeanceForCapture`) : hors ligne, le cache chaud
//     suffit. `null` si la séance en cours n'appartient plus à cette routine
//     (routine changée depuis le lancement) : le prévu ne serait pas le sien.
//   - le NOM de la routine, pour « Prévu : Ma routine, 3 séances. » : lecture
//     réseau seule ; hors ligne il manque et l'écran garde sa phrase générique.
//
// N'importe rien de features/analysis : ce module est dans le chunk d'entrée,
// avec la Capture. Les deux lectures sont indépendantes ; l'échec de l'une ne
// retire pas l'autre. Aucune ne bloque « Ranger la séance ».
import type { PerformedExercise, PlannedExercise } from '../../domain/set-count';
import { mergeExerciseOverride, type ExerciseOverrideValues } from '../../domain/exercise-override';
import type { Side } from '../../domain/types';
import { weekStartIso } from '../../domain/week';
import { afterId, fetchAllRows } from '../../lib/fetch-all';
import { supabase } from '../../lib/supabase';
import { loadExerciseOverrides } from '../exercises/overrides';
import { loadCaptureSource, loadChosenSeance, loadSeanceForCapture } from './data';

/** Une séance faite plus tôt dans la semaine. */
export interface WeekSeance {
  name: string;
  performedOn: string;
}

export interface WeekMusclesInput {
  /** Les exos faits plus tôt dans la semaine, `null` si la lecture a échoué. */
  before: PerformedExercise[] | null;
  /** Les séances faites plus tôt dans la semaine, dans l'ordre (vide si `before` est `null`). */
  seancesBefore: WeekSeance[];
  /** Le prévu de la routine, `null` si indisponible. */
  planned: { exercises: PlannedExercise[]; seanceCount: number } | null;
  /** Le nom de la routine de la séance, `null` s'il n'a pas pu être lu (hors ligne). */
  routineName: string | null;
}

/** Une série de la semaine telle que la rend la lecture, son exo et son exécution joints. */
export type WeekSetRow = {
  id: string;
  weight_kg: number;
  reps: number;
  rir: number;
  set_order: number;
  side: string | null;
  exercise_id: string;
  execution_id: string;
  exercises: { name: string; unilateral: boolean; primary_muscles: string[] | null } | null;
  executions: {
    performed_on: string;
    /** Le lancement de l'exécution ; `null` sur une ligne héritée. */
    started_at: string | null;
    created_at: string;
    seance_versions: { seances: { name: string } | null } | null;
  } | null;
};

const WEEK_SET_SELECT =
  'id, weight_kg, reps, rir, set_order, side, exercise_id, execution_id, exercises ( name, unilateral, primary_muscles ), executions!inner ( performed_on, started_at, created_at, seance_versions ( seances ( name ) ) )';

const toSide = (raw: string | null): Side | undefined => (raw === 'left' || raw === 'right' ? raw : undefined);

/** La séance close : son jour adopté et son lancement (epoch ms). */
export interface ClosedSeanceBound {
  dateIso: string;
  startedAt: number;
}

/**
 * Une exécution vient-elle AVANT la séance close ? Un jour antérieur, oui ; un
 * jour postérieur, non. Le même jour : si elle a été commencée avant, d'après
 * son `started_at`, ou sa création à défaut (ligne héritée sans lancement).
 */
export function isBefore(meta: NonNullable<WeekSetRow['executions']>, bound: ClosedSeanceBound): boolean {
  if (meta.performed_on !== bound.dateIso) return meta.performed_on < bound.dateIso;
  const started = Date.parse(meta.started_at ?? meta.created_at);
  return Number.isFinite(started) && started < bound.startedAt;
}

/**
 * Partie PURE de la lecture de la semaine. Les séries arrivent dans l'ordre des
 * `id` (pagination) : elles sont regroupées par exécution, rangées par jour puis
 * par création, et dans chaque exécution un exo par exo (ses séries ensemble :
 * elles se comptent en séries logiques), muscles et drapeau unilatéral fusionnés
 * avec les overrides. L'exécution `excludeExecutionId` est ignorée (garde-fou :
 * la requête l'exclut déjà), comme une ligne sans exécution jointe. Avec
 * `bound`, seules restent les exécutions faites avant la séance close (`isBefore`).
 */
export function weekRowsToBefore(
  rows: WeekSetRow[],
  overrides: Map<string, ExerciseOverrideValues>,
  excludeExecutionId: string | null = null,
  bound: ClosedSeanceBound | null = null,
): { before: PerformedExercise[]; seancesBefore: WeekSeance[] } {
  const executions = new Map<string, { meta: NonNullable<WeekSetRow['executions']>; sets: WeekSetRow[] }>();
  for (const row of rows) {
    if (!row.executions || row.execution_id === excludeExecutionId) continue;
    if (bound && !isBefore(row.executions, bound)) continue;
    const entry = executions.get(row.execution_id) ?? { meta: row.executions, sets: [] };
    entry.sets.push(row);
    executions.set(row.execution_id, entry);
  }
  const ordered = [...executions.values()].sort(
    (a, b) => a.meta.performed_on.localeCompare(b.meta.performed_on) || a.meta.created_at.localeCompare(b.meta.created_at),
  );
  const before: PerformedExercise[] = [];
  for (const { sets } of ordered) {
    const byExercise = new Map<string, WeekSetRow[]>();
    for (const set of sets) byExercise.set(set.exercise_id, [...(byExercise.get(set.exercise_id) ?? []), set]);
    for (const [exerciseId, exSets] of byExercise) {
      const shared = exSets[0]?.exercises;
      const merged = mergeExerciseOverride(
        {
          name: shared?.name ?? '',
          unilateral: shared?.unilateral ?? false,
          primaryMuscles: shared?.primary_muscles ?? [],
        },
        overrides.get(exerciseId) ?? null,
      );
      before.push({
        unilateral: merged.unilateral,
        primaryMuscles: merged.primaryMuscles,
        sets: exSets
          .map((s) => ({ order: s.set_order, weightKg: s.weight_kg, reps: s.reps, rir: s.rir, side: toSide(s.side) }))
          .sort((a, b) => a.order - b.order),
      });
    }
  }
  const seancesBefore = ordered.map(({ meta }) => ({ name: meta.seance_versions?.seances?.name ?? 'Séance', performedOn: meta.performed_on }));
  return { before, seancesBefore };
}

async function loadBefore(dateIso: string, currentExecutionId: string, currentStartedAt: number) {
  const monday = weekStartIso(dateIso);
  // Jusqu'au jour de la séance compris : le même jour se tranche à son lancement.
  const [rows, overrides] = await Promise.all([
    fetchAllRows<WeekSetRow>((after, limit) =>
      afterId(
        supabase
          .from('performed_sets')
          .select(WEEK_SET_SELECT)
          .gte('executions.performed_on', monday)
          .lte('executions.performed_on', dateIso)
          .neq('execution_id', currentExecutionId)
          .order('id')
          .limit(limit),
        after,
      ),
    ),
    loadExerciseOverrides(),
  ]);
  return weekRowsToBefore(rows, overrides, currentExecutionId, { dateIso, startedAt: currentStartedAt });
}

async function loadPlanned(seanceId: string): Promise<WeekMusclesInput['planned']> {
  const source = await loadCaptureSource();
  if (source.kind !== 'choose' || !source.seances.some((s) => s.id === seanceId)) return null;
  const sessions = await Promise.all(
    source.seances.map(async (choice) => {
      const { seance, seanceVersionId } = await loadChosenSeance(choice);
      return loadSeanceForCapture(seance, seanceVersionId);
    }),
  );
  return {
    exercises: sessions.flatMap((s) =>
      s.exercises.map((ex) => ({
        unilateral: ex.unilateral ?? false,
        primaryMuscles: ex.primaryMuscles ?? [],
        sets: ex.prescription.sets,
        reps: ex.prescription.reps,
      })),
    ),
    seanceCount: sessions.length,
  };
}

/** Le nom de la routine de la séance `seanceId` (lecture réseau, sans copie). */
async function loadRoutineName(seanceId: string): Promise<string | null> {
  const { data, error } = await supabase.from('seances').select('routines ( name )').eq('id', seanceId).maybeSingle();
  if (error) throw error;
  return (data as { routines: { name: string } | null } | null)?.routines?.name ?? null;
}

/** Ce que la fin de séance de `seanceId` (exécution `currentExecutionId`, date adoptée `dateIso`) affiche de la semaine. */
export async function loadWeekMuscles(params: {
  seanceId: string;
  dateIso: string;
  currentExecutionId: string;
  /** Le lancement de l'exécution en cours (epoch ms) : borne les séances du même jour. */
  currentStartedAt: number;
}): Promise<WeekMusclesInput> {
  const [before, planned, routineName] = await Promise.allSettled([
    loadBefore(params.dateIso, params.currentExecutionId, params.currentStartedAt),
    loadPlanned(params.seanceId),
    loadRoutineName(params.seanceId),
  ]);
  return {
    before: before.status === 'fulfilled' ? before.value.before : null,
    seancesBefore: before.status === 'fulfilled' ? before.value.seancesBefore : [],
    planned: planned.status === 'fulfilled' ? planned.value : null,
    routineName: routineName.status === 'fulfilled' ? routineName.value : null,
  };
}
