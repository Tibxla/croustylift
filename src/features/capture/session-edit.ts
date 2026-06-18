// Édition de la séance à la volée : ajout / swap d'un exo hors template (issue #36).
//
// On manipule la `Session` EN MÉMOIRE (la liste d'exos de l'exécution courante).
// Le template versionné en base n'est JAMAIS touché : un exo ajouté/échangé est
// une DÉVIATION, dérivée par diff entre la liste réelle et le template d'origine
// (cf. ADR 0002 « déviations dérivées par diff »). Logique pure, testée.
import type { Session, SessionExercise } from './fixtures';

/**
 * Les ids d'exos du template d'origine, dans l'ordre. À capturer UNE fois (au
 * chargement, avant toute édition) : c'est la référence du diff de déviations,
 * stable même quand la liste réelle évolue (ajout/swap).
 */
export function templateExerciseIds(session: Session): string[] {
  return session.exercises.map((e) => e.exerciseId);
}

/**
 * Ajoute un exo (catalogue base/perso) à la fin de la séance courante, marqué
 * `origin: 'added'`. Sans effet (séance inchangée) si l'exo y est déjà : pas de
 * doublon en cours d'exécution. Immutable : retourne une nouvelle `Session`.
 */
export function addExercise(session: Session, exercise: SessionExercise): Session {
  if (session.exercises.some((e) => e.exerciseId === exercise.exerciseId)) {
    return session;
  }
  return {
    ...session,
    exercises: [...session.exercises, { ...exercise, origin: 'added' }],
  };
}

/**
 * Remplace l'exo `targetExerciseId` par `replacement`, À LA MÊME POSITION, marqué
 * `origin: 'swapped'` + `swappedFrom: targetExerciseId` (trace de l'exo remplacé).
 * Sans effet si la cible est absente. Immutable. Le réalisé déjà loggé sur la
 * cible reste dans l'état du reducer (clé exerciseId) : il n'est pas effacé ici,
 * juste rendu inactif puisque l'exo disparaît de la liste — assumé (un swap se
 * décide avant de logger ; le diff reflète le réel).
 */
export function swapExercise(
  session: Session,
  targetExerciseId: string,
  replacement: SessionExercise,
): Session {
  const idx = session.exercises.findIndex((e) => e.exerciseId === targetExerciseId);
  if (idx === -1) return session;
  const exercises = session.exercises.slice();
  exercises[idx] = { ...replacement, origin: 'swapped', swappedFrom: targetExerciseId };
  return { ...session, exercises };
}

/** Une déviation d'EXO dérivée par diff : exo ajouté ou exo remplacé (ADR 0002). */
export type ExerciseDeviation =
  | { kind: 'added'; exerciseId: string; name: string }
  | { kind: 'swapped'; exerciseId: string; name: string; replacedExerciseId: string };

/**
 * Dérive les déviations d'exo par diff entre le template d'origine (ses ids) et
 * la séance réelle. Un exo `swapped` rend une déviation `swapped` (avec l'exo
 * remplacé) ; un exo `added` rend une déviation `added`. Les exos du template
 * inchangés ne dévient pas. Ordre = ordre de la séance.
 */
export function deriveExerciseDeviations(
  templateExerciseIds: string[],
  session: Session,
): ExerciseDeviation[] {
  const template = new Set(templateExerciseIds);
  const deviations: ExerciseDeviation[] = [];
  for (const ex of session.exercises) {
    if (ex.origin === 'swapped' && ex.swappedFrom) {
      deviations.push({
        kind: 'swapped',
        exerciseId: ex.exerciseId,
        name: ex.name,
        replacedExerciseId: ex.swappedFrom,
      });
    } else if (ex.origin === 'added' || !template.has(ex.exerciseId)) {
      // `added` explicite, ou exo hors template sans marqueur (garde-fou) :
      // toute présence non prévue par le template est un ajout.
      deviations.push({ kind: 'added', exerciseId: ex.exerciseId, name: ex.name });
    }
  }
  return deviations;
}
