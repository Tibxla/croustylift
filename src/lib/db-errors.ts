// Traduction des refus de CONTRAINTE de la base, pour les écritures directes
// (plan, exos, notes, import). PostgREST relance l'erreur Postgres telle quelle :
// un message en anglais qui nomme la contrainte (« violates foreign key
// constraint "prescriptions_exercise_id_fkey" »), illisible sous un bouton.
//
// Ce module ne donne que le message GÉNÉRIQUE, en dernier recours :
//   - quand une écriture sait ce que le refus veut dire (exo encore utilisé,
//     routine courante, nom déjà pris), elle le dit elle-même, avant, avec ses
//     mots (cf. features/authoring/data.ts) : son erreur ne porte plus de code
//     et passe ici sans être touchée ;
//   - quand c'est un TRIGGER de la base qui refuse, il porte les mêmes codes
//     (23503, 23514) mais son propre message, déjà en français et précis (« La
//     routine courante ne s'archive pas. », migrations 0019b, 0020, 0021). On
//     ne traduit donc que le message INTÉGRÉ de Postgres (« violates foreign
//     key constraint », « violates check constraint ») ; tout autre texte passe.
//
// Les écritures de la Capture ne passent pas par ici : la file d'attente lit le
// code SQLSTATE brut pour décider d'un rejet définitif (`isPermanentRejection`,
// features/capture/outbox.ts).
//
// Le refus de DROITS (42501) n'est traduit qu'à l'affichage (`errorMessage`,
// lib/error-message.ts), jamais en réemballant l'objet relancé : la file y lit
// ce code pour mettre l'écriture en quarantaine.

/** Clé étrangère : la ligne visée n'existe plus, ou est encore référencée. */
const FOREIGN_KEY_VIOLATION = '23503'
/** Contrainte `check` : valeur hors des bornes que la base accepte. */
const CHECK_VIOLATION = '23514'

/** Droits insuffisants : policy RLS qui refuse la ligne, privilège absent. */
const INSUFFICIENT_PRIVILEGE = '42501'

/**
 * Le message français d'un refus de droits INTÉGRÉ de Postgres (42501 : « new
 * row violates row-level security policy for table "x" », « permission denied
 * for table x »), ou `null`. Comme pour les contraintes, un motif écrit par la
 * base sous ce code garderait son texte.
 */
export function permissionErrorMessage(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null
  const { code, message } = error as { code?: unknown; message?: unknown }
  if (code !== INSUFFICIENT_PRIVILEGE || typeof message !== 'string') return null
  if (!message.includes('row-level security policy') && !message.includes('permission denied')) {
    return null
  }
  return 'Action refusée : ce compte n’a pas le droit de modifier cet élément. Recharge l’écran ; si le refus persiste, déconnecte-toi puis reconnecte-toi.'
}

/**
 * Quel refus de contrainte INTÉGRÉ de Postgres cette erreur porte-t-elle ?
 * `null` pour tout le reste, y compris un refus de trigger sous le même code,
 * dont le message est déjà écrit pour l'utilisateur.
 */
export function builtInConstraintViolation(error: unknown): 'foreign-key' | 'check' | null {
  if (typeof error !== 'object' || error === null) return null
  const { code, message } = error as { code?: unknown; message?: unknown }
  if (typeof message !== 'string') return null
  if (code === FOREIGN_KEY_VIOLATION && message.includes('violates foreign key constraint')) {
    return 'foreign-key'
  }
  if (code === CHECK_VIOLATION && message.includes('violates check constraint')) return 'check'
  return null
}

/**
 * Le message français d'un refus de contrainte intégré (clé étrangère 23503,
 * check 23514), ou `null` pour toute autre erreur.
 */
export function constraintErrorMessage(error: unknown): string | null {
  switch (builtInConstraintViolation(error)) {
    case 'foreign-key':
      return 'Enregistrement refusé : un élément lié a été supprimé entre-temps, ou est encore utilisé ailleurs. Recharge l’écran puis réessaie.'
    case 'check':
      return 'Enregistrement refusé : une valeur sort des limites acceptées. Corrige la saisie puis réessaie.'
    default:
      return null
  }
}

/**
 * Rend une erreur lisible pour un refus de contrainte intégré, l'erreur d'origine en
 * `cause` ; toute autre erreur repart telle quelle (même objet).
 */
export function translateConstraintError(error: unknown): unknown {
  const message = constraintErrorMessage(error)
  return message === null ? error : new Error(message, { cause: error })
}
