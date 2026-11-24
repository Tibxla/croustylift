// Le texte à afficher pour une erreur attrapée.
//
// Les couches data relancent l'objet d'erreur de PostgREST TEL QUEL (`if (error)
// throw error`) : un objet simple `{ code, message, details, hint }`, pas une
// `Error`. `String(err)` en faisait « [object Object] » à l'écran, y compris
// quand la base avait écrit un motif précis en français (triggers des
// migrations 0019b, 0020, 0021). On lit donc son champ `message`.
//
// Trois familles de messages techniques sont traduites ICI, à l'affichage :
//   - un refus de contrainte ou de droits intégré de Postgres (lib/db-errors) ;
//   - une coupure réseau, dont le texte dépend du navigateur (« Failed to
//     fetch » sous Chrome, « Load failed » sous Safari, donc sur l'iPhone) ;
//   - une requête abandonnée par le délai maximal (lib/fetch-timeout).
// Un message déjà écrit pour l'utilisateur passe sans être touché.
//
// L'objet relancé n'est pas transformé pour autant : la file de la Capture lit
// son `code` SQLSTATE brut (`isPermanentRejection`, features/capture/outbox.ts),
// et reconnaît une coupure à l'objet d'erreur, pas à ce texte.
import { constraintErrorMessage, permissionErrorMessage } from './db-errors'

/** Ce qu'un `fetch` qui n'aboutit pas dit, selon le navigateur. */
const NETWORK_FAILURES = [
  'Failed to fetch', // Chrome, Edge
  'Load failed', // Safari (iPhone)
  'NetworkError when attempting to fetch resource', // Firefox
  'Network request failed',
]

/**
 * Le message français d'une requête qui n'a pas abouti, ou `null`. `message` :
 * le texte brut, celui d'une `TypeError` ou celui que postgrest-js en tire
 * (« TypeError: Failed to fetch », « TimeoutError: Pas de réponse… »).
 */
export function networkErrorMessage(message: string): string | null {
  const text = message.replace(/^[A-Za-z]*Error: /, '')
  // Égalité stricte : « Failed to fetch dynamically imported module » (chunk
  // introuvable, pwa/update.ts) est une autre panne, avec sa propre reprise.
  if (NETWORK_FAILURES.includes(text.replace(/\.$/, ''))) {
    return 'Connexion impossible. Vérifie le réseau puis réessaie.'
  }
  // Délai maximal dépassé (lib/fetch-timeout), ou requête abandonnée.
  if (text.startsWith('Pas de réponse du serveur') || /^(Abort|Timeout)Error: /.test(message)) {
    return 'Le serveur ne répond pas. Vérifie le réseau puis réessaie.'
  }
  return null
}

/** Le message brut d'une erreur attrapée, qu'elle soit une `Error` ou un objet PostgREST. */
function rawMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'object' && err !== null) {
    const { message } = err as { message?: unknown }
    if (typeof message === 'string' && message !== '') return message
  }
  return String(err)
}

/** Le texte à afficher pour une erreur attrapée, en français quand elle est technique. */
export function errorMessage(err: unknown): string {
  const raw = rawMessage(err)
  return (
    constraintErrorMessage(err) ?? permissionErrorMessage(err) ?? networkErrorMessage(raw) ?? raw
  )
}
