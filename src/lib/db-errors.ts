// Traduction des refus de CONTRAINTE de la base, pour les écritures directes
// (plan, exos, notes, import). PostgREST relance l'erreur Postgres telle quelle :
// un message en anglais qui nomme la contrainte (« violates foreign key
// constraint "prescriptions_exercise_id_fkey" »), illisible sous un bouton.
//
// Ce module ne donne que le message GÉNÉRIQUE, en dernier recours. Quand une
// écriture sait ce que le refus veut dire (exo encore utilisé, routine courante,
// nom déjà pris), elle le dit elle-même, avant, avec ses mots (cf.
// features/authoring/data.ts) : son erreur ne porte plus de code et passe ici
// sans être touchée.
//
// Les écritures de la Capture ne passent pas par ici : la file d'attente lit le
// code SQLSTATE brut pour décider d'un rejet définitif (`isPermanentRejection`,
// features/capture/outbox.ts).

/** Clé étrangère : la ligne visée n'existe plus, ou est encore référencée. */
const FOREIGN_KEY_VIOLATION = '23503'
/** Contrainte `check` : valeur hors des bornes que la base accepte. */
const CHECK_VIOLATION = '23514'

const MESSAGES: Record<string, string> = {
  [FOREIGN_KEY_VIOLATION]:
    'Enregistrement refusé : un élément lié a été supprimé entre-temps, ou est encore utilisé ailleurs. Recharge l’écran puis réessaie.',
  [CHECK_VIOLATION]:
    'Enregistrement refusé : une valeur sort des limites acceptées (texte trop long, nombre hors bornes). Corrige la saisie puis réessaie.',
}

/** Le code SQLSTATE porté par une erreur PostgREST, sinon `null`. */
function sqlState(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : null
}

/**
 * Le message français d'un refus de contrainte (clé étrangère 23503, check
 * 23514), ou `null` pour toute autre erreur.
 */
export function constraintErrorMessage(error: unknown): string | null {
  const code = sqlState(error)
  return code === null ? null : (MESSAGES[code] ?? null)
}

/**
 * Rend une erreur lisible pour un refus de contrainte, l'erreur d'origine en
 * `cause` ; toute autre erreur repart telle quelle (même objet).
 */
export function translateConstraintError(error: unknown): unknown {
  const message = constraintErrorMessage(error)
  return message === null ? error : new Error(message, { cause: error })
}
