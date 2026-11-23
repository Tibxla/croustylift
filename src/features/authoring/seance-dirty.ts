// Modifications non enregistrées de l'éditeur de séance (logique PURE, sans
// React ni Supabase), et garde de sortie d'un écran qui en porte.
//
// POURQUOI : enregistrer une séance crée une nouvelle VERSION (ADR 0001), et une
// version de plus coupe un bloc. « Enregistrer » sans rien changer créait une
// version identique : un bloc de six semaines devenait deux blocs de trois,
// chacun sous le seuil de points d'une pente. L'éditeur n'enregistre donc que
// s'il y a une différence, et prévient avant de perdre une saisie.
import { rowsToPrescriptionInputs, type EditorRow } from './prescription-edit';

/**
 * Les lignes éditées diffèrent-elles de ce qui est enregistré ? On compare ce
 * qui PART en base (`rowsToPrescriptionInputs` : exos, ordre, fourchettes), pas
 * l'état de l'écran : une clé de ligne ou une bascule fixe/fourchette sans écart
 * de valeur ne font pas une modification, et une valeur changée puis remise non
 * plus. `saved` est la dernière version enregistrée, pas seulement celle du
 * chargement : après un enregistrement réussi, l'éditeur n'est plus « modifié ».
 */
export function hasPrescriptionChanges(saved: EditorRow[], current: EditorRow[]): boolean {
  return (
    JSON.stringify(rowsToPrescriptionInputs(saved)) !==
    JSON.stringify(rowsToPrescriptionInputs(current))
  );
}

/**
 * Une note d'instructions a-t-elle un brouillon non enregistré ? La note se
 * sauve À PART des prescriptions (son propre bouton, sans nouvelle version) :
 * son brouillon ne rend donc pas l'éditeur « modifié » au sens de
 * `hasPrescriptionChanges`, mais le quitter le perdrait tout autant.
 *
 * `saved` : les notes enregistrées, par exercice ('' ou absente = aucune).
 * `drafts` : les textes en cours de saisie, par exercice (absent = pas touché).
 * Seuls comptent les exercices encore présents dans la séance (`exerciseIds`) :
 * le brouillon d'un exo retiré n'est plus affiché nulle part, il ne doit pas
 * faire demander une confirmation que rien à l'écran n'explique.
 */
export function hasNoteDraftChanges(
  saved: Readonly<Record<string, string>>,
  drafts: Readonly<Record<string, string>>,
  exerciseIds: readonly string[],
): boolean {
  return noteDraftExerciseIds(saved, drafts, exerciseIds).length > 0;
}

/**
 * Les exercices dont la note a un brouillon non enregistré, sans doublon (deux
 * lignes du même exo partagent une note), dans l'ordre de la séance.
 */
export function noteDraftExerciseIds(
  saved: Readonly<Record<string, string>>,
  drafts: Readonly<Record<string, string>>,
  exerciseIds: readonly string[],
): string[] {
  return [...new Set(exerciseIds)].filter((id) => {
    const draft = drafts[id];
    return draft !== undefined && draft !== (saved[id] ?? '');
  });
}

/**
 * Quitter l'éditeur ferait-il perdre une saisie ? L'UNION des deux : des
 * prescriptions modifiées, ou le brouillon d'une note. C'est ce que lisent la
 * garde de sortie et le blocage de rechargement. Le bouton « Enregistrer »,
 * lui, ne regarde que les prescriptions : une note modifiée seule ne doit pas
 * créer une version identique de la séance.
 */
export function hasUnsavedEdits(editor: {
  savedRows: EditorRow[];
  rows: EditorRow[];
  savedNotes: Readonly<Record<string, string>>;
  noteDrafts: Readonly<Record<string, string>>;
}): boolean {
  return (
    hasPrescriptionChanges(editor.savedRows, editor.rows) ||
    hasNoteDraftChanges(
      editor.savedNotes,
      editor.noteDrafts,
      editor.rows.map((row) => row.exerciseId),
    )
  );
}

// --- Bouton « Enregistrer » et confirmation de sortie ---------------------------
//
// Après un enregistrement réussi, l'éditeur affiche « Séance enregistrée. » à la
// place du bouton, puis repart en arrière. S'il reste le brouillon d'une note,
// la garde de sortie retient ce retour et l'utilisateur peut choisir de
// continuer : l'éditeur reste alors monté APRÈS un enregistrement. Le bandeau
// ne doit pas y survivre, sinon plus rien ne permet d'enregistrer la suite.

/** État de l'enregistrement des prescriptions. */
export interface SaveStatus {
  busy: boolean;
  error: string | null;
  /** Le dernier enregistrement a réussi, et l'éditeur n'a pas repris depuis. */
  done: boolean;
}

export const SAVE_IDLE: SaveStatus = { busy: false, error: null, done: false };
export const SAVE_BUSY: SaveStatus = { busy: true, error: null, done: false };
export const SAVE_DONE: SaveStatus = { busy: false, error: null, done: true };

/** L'enregistrement a échoué : le bouton revient, avec le motif. */
export function saveFailed(message: string): SaveStatus {
  return { busy: false, error: message, done: false };
}

/**
 * « Continuer l'édition » : l'utilisateur reste dans l'éditeur. Un
 * enregistrement réussi n'est plus l'état de l'écran, le bouton revient.
 */
export function editingResumed(save: SaveStatus): SaveStatus {
  return save.done ? { ...save, done: false } : save;
}

/**
 * Ce que montre l'emplacement du bouton : le bandeau « Séance enregistrée. »
 * seulement si le dernier enregistrement a réussi ET que rien n'a bougé depuis.
 * Des prescriptions de nouveau modifiées ramènent le bouton, quoi qu'il arrive.
 */
export function saveControl(save: SaveStatus, dirty: boolean): 'saved' | 'button' {
  return save.done && !dirty ? 'saved' : 'button';
}

/** Les textes de la confirmation de sortie. */
export interface LeavePrompt {
  label: string;
  title: string;
  detail: string;
}

/**
 * Ce que la confirmation de sortie annonce. Elle s'ouvre aussi juste après un
 * enregistrement réussi, quand il reste le brouillon d'une note : « Quitter sans
 * enregistrer ? » y laissait croire que la séance n'était pas partie. Quand
 * seule une note est en jeu, le texte la nomme.
 *
 * `noteDraftNames` : les noms des exercices dont la note a un brouillon
 * (cf. `noteDraftExerciseIds`).
 */
export function leavePrompt(unsaved: {
  prescriptions: boolean;
  noteDraftNames: readonly string[];
}): LeavePrompt {
  const [first] = unsaved.noteDraftNames;
  if (unsaved.prescriptions || first === undefined) {
    return {
      label: 'Modifications non enregistrées',
      title: 'Quitter sans enregistrer ?',
      detail: 'Tes modifications de cette séance seront perdues.',
    };
  }
  if (unsaved.noteDraftNames.length === 1) {
    return {
      label: 'Note non enregistrée',
      title: 'Quitter sans enregistrer la note ?',
      detail: `Les prescriptions sont enregistrées. La note de « ${first} » ne l’est pas : elle sera perdue.`,
    };
  }
  return {
    label: 'Notes non enregistrées',
    title: 'Quitter sans enregistrer les notes ?',
    detail: `Les prescriptions sont enregistrées. Les notes de ${unsaved.noteDraftNames.length} exercices ne le sont pas : elles seront perdues.`,
  };
}

// --- Garde de sortie ----------------------------------------------------------
//
// Un écran qui porte des modifications non enregistrées pose une garde ; toute
// navigation qui le ferait disparaître (retour, changement d'onglet) passe par
// `requestLeave`. La garde reçoit la suite (`proceed`) et choisit de l'appeler,
// tout de suite ou après une confirmation affichée par l'écran lui-même (jamais
// `window.confirm`). Une seule garde à la fois : un seul écran d'édition est
// monté. État de module volontaire, pour que la navigation n'ait pas à connaître
// l'écran.

/** Reçoit la navigation demandée et décide de la laisser passer. */
export type LeaveGuard = (proceed: () => void) => void;

let guard: LeaveGuard | null = null;

/** Pose la garde de l'écran courant, ou la retire (`null`). */
export function setLeaveGuard(next: LeaveGuard | null): void {
  guard = next;
}

/** Demande à quitter l'écran : passe par la garde s'il y en a une, sinon sort. */
export function requestLeave(proceed: () => void): void {
  if (guard) guard(proceed);
  else proceed();
}
