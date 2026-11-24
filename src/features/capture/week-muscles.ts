// Chargeur de la fin de séance : ce que `weekSetsByMuscle` (session-recap.ts)
// attend en plus de l'état de capture.
//
//   - AVANT : les séries des AUTRES exécutions de la semaine civile (lundi au
//     dimanche, `weekStartIso` sur la date adoptée de la séance), lues en base.
//     L'exécution en cours est exclue : ses séries déjà envoyées sont comptées
//     dans « aujourd'hui », depuis l'état de capture. Les muscles et le drapeau
//     unilatéral passent par les overrides de l'utilisateur (comme la Capture).
//     Pas de copie locale : hors ligne, la lecture échoue et l'écran le dit.
//   - PRÉVU : les prescriptions de TOUTES les séances de la routine de la Capture,
//     par les lectures en cache de capture/data (`loadCaptureSource`,
//     `loadChosenSeance`, `loadSeanceForCapture`) : hors ligne, le cache chaud
//     suffit. `null` si la séance en cours n'appartient plus à cette routine
//     (routine changée depuis le lancement) : le prévu ne serait pas le sien.
//
// N'importe rien de features/analysis : ce module est dans le chunk d'entrée,
// avec la Capture. Les deux lectures sont indépendantes ; l'échec de l'une ne
// retire pas l'autre. Aucune ne bloque « Ranger la séance ».
import type { PerformedExercise, PlannedExercise } from '../../domain/set-count';
import { mergeExerciseOverride, type ExerciseOverrideValues } from '../../domain/exercise-override';
import type { Side } from '../../domain/types';
import { weekStartIso } from '../../domain/week';
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
}

/** Au-delà, la lecture est tenue pour échouée (réseau de salle qui traîne). */
const READ_TIMEOUT_MS = 8000;

function within<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('délai dépassé')), READ_TIMEOUT_MS)),
  ]);
}

/** Le dimanche (jour ISO) de la semaine civile qui commence le lundi `mondayIso`. */
export function sundayOf(mondayIso: string): string {
  const [y, m, d] = mondayIso.split('-').map(Number);
  const date = new Date(y ?? 0, (m ?? 1) - 1, (d ?? 1) + 6);
  const z = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${z(date.getMonth() + 1)}-${z(date.getDate())}`;
}

/** Une exécution de la semaine telle que la rend la lecture, ses séries jointes. */
export type WeekRow = {
  id: string;
  performed_on: string;
  created_at: string;
  seance_versions: { seances: { name: string } | null } | null;
  performed_sets: {
    weight_kg: number;
    reps: number;
    rir: number;
    set_order: number;
    side: string | null;
    exercise_id: string;
    exercises: { name: string; unilateral: boolean; primary_muscles: string[] | null } | null;
  }[];
};

const toSide = (raw: string | null): Side | undefined => (raw === 'left' || raw === 'right' ? raw : undefined);

async function loadBefore(dateIso: string, currentExecutionId: string) {
  const monday = weekStartIso(dateIso);
  const [{ data, error }, overrides] = await Promise.all([
    supabase
      .from('executions')
      .select(
        'id, performed_on, created_at, seance_versions ( seances ( name ) ), performed_sets ( weight_kg, reps, rir, set_order, side, exercise_id, exercises ( name, unilateral, primary_muscles ) )',
      )
      .gte('performed_on', monday)
      .lte('performed_on', sundayOf(monday))
      .neq('id', currentExecutionId)
      .order('performed_on')
      .order('created_at'),
    loadExerciseOverrides(),
  ]);
  if (error) throw error;
  return weekRowsToBefore((data ?? []) as unknown as WeekRow[], overrides);
}

/**
 * Partie PURE de la lecture de la semaine : un exo par (exécution, exo), ses
 * séries ensemble (elles se comptent en séries logiques), muscles et drapeau
 * unilatéral fusionnés avec les overrides ; les exécutions sans série sont
 * ignorées. Les séances gardent l'ordre des lignes (date puis création).
 */
export function weekRowsToBefore(
  rows: WeekRow[],
  overrides: Map<string, ExerciseOverrideValues>,
): { before: PerformedExercise[]; seancesBefore: WeekSeance[] } {
  const kept = rows.filter((r) => r.performed_sets.length > 0);
  const before: PerformedExercise[] = [];
  for (const row of kept) {
    const byExercise = new Map<string, WeekRow['performed_sets']>();
    for (const set of row.performed_sets) {
      byExercise.set(set.exercise_id, [...(byExercise.get(set.exercise_id) ?? []), set]);
    }
    for (const [exerciseId, sets] of byExercise) {
      const shared = sets[0]?.exercises;
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
        sets: sets.map((s) => ({ order: s.set_order, weightKg: s.weight_kg, reps: s.reps, rir: s.rir, side: toSide(s.side) })),
      });
    }
  }
  const seancesBefore = kept.map((r) => ({ name: r.seance_versions?.seances?.name ?? 'Séance', performedOn: r.performed_on }));
  return { before, seancesBefore };
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

/** Ce que la fin de séance de `seanceId` (exécution `currentExecutionId`, date adoptée `dateIso`) affiche de la semaine. */
export async function loadWeekMuscles(params: {
  seanceId: string;
  dateIso: string;
  currentExecutionId: string;
}): Promise<WeekMusclesInput> {
  const [before, planned] = await Promise.allSettled([
    within(loadBefore(params.dateIso, params.currentExecutionId)),
    within(loadPlanned(params.seanceId)),
  ]);
  return {
    before: before.status === 'fulfilled' ? before.value.before : null,
    seancesBefore: before.status === 'fulfilled' ? before.value.seancesBefore : [],
    planned: planned.status === 'fulfilled' ? planned.value : null,
  };
}
