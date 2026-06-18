// Onboarding du premier lancement — orchestration des inserts (réseau).
//
// Pour un utilisateur SANS routine, on ne crée plus rien en silence (l'ancien
// auto-seed « Ma routine » / « Upper A » de capture/data.ts est supprimé). On le
// guide vers un vrai premier lancement : il NOMME sa 1ʳᵉ routine et sa 1ʳᵉ séance,
// ou part d'un MODÈLE DE DÉPART qu'il peut renommer avant de valider.
//
// Ce module ne DUPLIQUE aucune logique d'insert : la création réelle (routine,
// séance + version v1, prescriptions versionnées) réutilise les fonctions de
// l'authoring. Les helpers PURS (détection, modèle, résolution) vivent dans
// template.ts, testables sans réseau.
import {
  createRoutine,
  setCurrentRoutine,
  createSeance,
  saveSeanceVersion,
} from '../authoring/data';
import { listExercises } from '../capture/data';
import { STARTER_TEMPLATE, resolveStarterPrescriptions } from './template';

export {
  isFirstLaunch,
  STARTER_TEMPLATE,
  DEFAULT_ROUTINE_NAME,
  resolveStarterPrescriptions,
  type StarterExercise,
  type StarterTemplate,
} from './template';

/** Paramètres du premier lancement : noms saisis + choix d'inclure le modèle de départ. */
export interface FirstRoutineInput {
  routineName: string;
  seanceName: string;
  /**
   * `true` : pré-remplir la séance avec les exos du modèle de départ.
   * `false` : séance vierge (l'utilisateur ajoutera ses exos dans l'éditeur).
   */
  withTemplate: boolean;
}

/** Ce que la création renvoie : de quoi naviguer ensuite (capture / séances). */
export interface FirstRoutineResult {
  routineId: string;
  seanceId: string;
}

/**
 * Crée la 1ʳᵉ routine de l'utilisateur depuis le flux de premier lancement, la
 * désigne courante, puis crée sa 1ʳᵉ séance. Si `withTemplate`, pré-remplit la
 * séance avec les prescriptions du modèle de départ (une nouvelle version créée
 * via `saveSeanceVersion`, qui résout chaque exo de base par son nom).
 *
 * N'écrit jamais owner_id (default auth.uid(), cf. authoring/data.ts) et ne
 * duplique aucune logique d'insert : tout passe par les fonctions de l'authoring.
 */
export async function createFirstRoutine(
  input: FirstRoutineInput,
): Promise<FirstRoutineResult> {
  const routine = await createRoutine({ name: input.routineName });
  await setCurrentRoutine(routine.id);
  const seance = await createSeance(routine.id, { name: input.seanceName });

  if (input.withTemplate) {
    // Résolution des UUID des exos de base par nom (pas de hardcode d'UUID).
    const wantedNames = new Set(STARTER_TEMPLATE.exercises.map((e) => e.name));
    const catalogue = await listExercises();
    const idByName = new Map(
      catalogue.filter((e) => wantedNames.has(e.name)).map((e) => [e.name, e.id]),
    );
    const prescriptions = resolveStarterPrescriptions(STARTER_TEMPLATE, idByName);
    await saveSeanceVersion(seance.id, prescriptions);
  }

  return { routineId: routine.id, seanceId: seance.id };
}
