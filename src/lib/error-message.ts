// Le texte à afficher pour une erreur attrapée.
//
// Les couches data relancent l'objet d'erreur de PostgREST TEL QUEL (`if (error)
// throw error`) : un objet simple `{ code, message, details, hint }`, pas une
// `Error`. `String(err)` en faisait « [object Object] » à l'écran, y compris
// quand la base avait écrit un motif précis en français (triggers des
// migrations 0019b, 0020, 0021). On lit donc son champ `message`.
//
// Quatre familles de messages techniques sont traduites ICI, à l'affichage :
//   - un refus de contrainte ou de droits intégré de Postgres (lib/db-errors) ;
//   - une coupure réseau, dont le texte dépend du navigateur (« Failed to
//     fetch » sous Chrome, « Load failed » sous Safari, donc sur l'iPhone) ;
//   - une requête abandonnée par le délai maximal (lib/fetch-timeout) ;
//   - tout autre message intégré de Postgres ou de PostgREST, en anglais
//     (« invalid input syntax for type uuid », 22P02) : jamais montré brut.
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

/** Les messages intégrés les plus courants, par SQLSTATE ou code PostgREST. */
const BUILT_IN: Record<string, string> = {
  '22P02': 'Le serveur a refusé une donnée mal formée. Recharge l’écran ; si l’erreur revient, signale-la.',
  '22001': 'Texte trop long pour le serveur.',
  '22003': 'Valeur hors des limites acceptées par le serveur.',
  '23502': 'Une valeur obligatoire manque : le serveur a refusé l’enregistrement.',
  '23505': 'Cet élément existe déjà.',
  '57014': 'Le serveur a mis trop de temps à répondre. Réessaie.',
  PGRST116: 'Élément introuvable : il a peut-être été supprimé.',
}

/**
 * Le message français d'une erreur intégrée de Postgres ou de PostgREST, ou
 * `null`. Une erreur porte un `code` ; son message est intégré (anglais) quand
 * il commence par une minuscule ou par « JSON », là où les motifs écrits par
 * nos triggers sont des phrases françaises à majuscule, qui passent intactes.
 */
export function builtInErrorMessage(err: unknown): string | null {
  if (typeof err !== 'object' || err === null) return null
  const { code, message } = err as { code?: unknown; message?: unknown }
  if (typeof code !== 'string' || code === '' || typeof message !== 'string') return null
  if (!/^([a-z]|JSON )/.test(message)) return null
  return BUILT_IN[code] ?? `Le serveur a refusé la demande (code ${code}). Réessaie ; si l’erreur revient, signale-la.`
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
    constraintErrorMessage(err) ??
    permissionErrorMessage(err) ??
    networkErrorMessage(raw) ??
    builtInErrorMessage(err) ??
    raw
  )
}
