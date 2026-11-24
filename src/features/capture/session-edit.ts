// Édition de la séance à la volée : ajout / swap d'un exo hors template (issue #36).
//
// On manipule la `Session` EN MÉMOIRE (la liste d'exos de l'exécution courante).
// Le template versionné en base n'est JAMAIS touché : un exo ajouté/échangé est
// une DÉVIATION, dérivée par diff entre la liste réelle et le template d'origine
// (cf. ADR 0002 « déviations dérivées par diff »). Logique pure, testée.
import type { Session, SessionExercise } from './fixtures';
import type { LayoutEdit } from './state';

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

/**
 * Insère `replacement` JUSTE APRÈS l'exo `targetExerciseId`, qui reste à sa
 * place : c'est le remplacement d'un exo DÉJÀ COMMENCÉ (machine prise). Ses
 * séries restent à lui, il se lit « en cours » ; le remplaçant porte
 * `origin: 'swapped'` et `swappedFrom`, comme un remplacement en place. Sans
 * effet si la cible est absente ou si le remplaçant est déjà dans la séance.
 * Immutable.
 */
export function insertReplacementAfter(
  session: Session,
  targetExerciseId: string,
  replacement: SessionExercise,
): Session {
  const idx = session.exercises.findIndex((e) => e.exerciseId === targetExerciseId);
  if (idx === -1) return session;
  if (session.exercises.some((e) => e.exerciseId === replacement.exerciseId)) return session;
  const exercises = session.exercises.slice();
  exercises.splice(idx + 1, 0, { ...replacement, origin: 'swapped', swappedFrom: targetExerciseId });
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

/**
 * Reconstruit la séance du jour au remontage : le TEMPLATE, sur lequel on rejoue
 * dans l'ordre les gestes d'édition persistés avec l'état de capture (`layout`).
 * Les gestes sont rejoués par les MÊMES fonctions que le direct (`addExercise`,
 * `swapExercise`) : le remontage rend la liste que l'utilisateur avait sous les
 * yeux, y compris « A remplacé par B, puis A réajouté ».
 *
 * La séance vaut le template plus ce journal, rien d'autre : un exo qui porte
 * des séries sans geste enregistré n'est PAS ramené ici (un vieil état local peut
 * tenir des séries venues d'une autre exécution, et les rendre visibles les
 * rendrait annulables).
 *
 * `resolve` fournit l'exo prêt à afficher pour un geste (historique, note), ou
 * `null` si sa lecture a échoué : la séance s'ouvre alors sans lui à ce montage,
 * le geste restant dans le journal pour le suivant. Garde-fous :
 *   - jamais deux fois le même exo : un geste dont l'exo est déjà dans la liste
 *     (entré au plan depuis) est sans effet, la ligne du template l'emporte ;
 *   - un remplacement dont la cible n'est plus dans la liste (plan changé)
 *     devient un ajout, pour ne pas perdre l'exo et ses séries.
 */
export function replayLayout(
  template: Session,
  layout: readonly LayoutEdit[],
  resolve: (edit: LayoutEdit, index: number) => SessionExercise | null,
): Session {
  let session = template;
  layout.forEach((edit, index) => {
    if (session.exercises.some((e) => e.exerciseId === edit.exerciseId)) return;
    const exercise = resolve(edit, index);
    if (!exercise) return;
    const target = edit.kind === 'swapped' ? edit.replaces : undefined;
    const targetPresent =
      target !== undefined && session.exercises.some((e) => e.exerciseId === target);
    if (!targetPresent || target === undefined) session = addExercise(session, exercise);
    // `keepsReplaced` : décidé au moment du geste (l'exo remplacé avait des
    // séries), jamais redérivé ici.
    else if (edit.keepsReplaced) session = insertReplacementAfter(session, target, exercise);
    else session = swapExercise(session, target, exercise);
  });
  return session;
}

/**
 * Le geste d'édition à journaliser pour un exo ajouté ou remplaçant (cf.
 * `layout`). `keepsReplaced` : l'exo remplacé avait déjà des séries, il reste
 * dans la séance (cf. `LayoutEdit.keepsReplaced`).
 */
export function layoutEditOf(
  exercise: SessionExercise,
  replaces?: string,
  options: { keepsReplaced?: boolean } = {},
): LayoutEdit {
  return {
    kind: replaces === undefined ? 'added' : 'swapped',
    exerciseId: exercise.exerciseId,
    name: exercise.name,
    unilateral: exercise.unilateral ?? false,
    primaryMuscles: exercise.primaryMuscles ?? [],
    ...(replaces === undefined ? {} : { replaces }),
    ...(replaces !== undefined && options.keepsReplaced ? { keepsReplaced: true as const } : {}),
  };
}
