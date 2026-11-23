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
