// Arrivée par un lien de récupération de mot de passe : détection PURE, et relevé
// fait à l'évaluation du module.
//
// Ce module n'importe rien et doit rester le PREMIER import de main.tsx : le
// client Supabase retire les jetons de l'URL en s'initialisant, il faut avoir lu
// l'adresse avant. Tant que ce flux n'est pas terminé, aucun rechargement
// automatique ne doit avoir lieu (il ferait perdre l'écran de nouveau mot de
// passe, et le lien ne sert qu'une fois).

/** Blocage posé à l'arrivée par un lien de récupération, avant de savoir s'il est valide. */
export const RECOVERY_LINK_BLOCK = 'lien-de-recuperation'
/** Blocage tenu pendant l'écran de nouveau mot de passe (App.tsx). */
export const RECOVERY_SCREEN_BLOCK = 'ecran-nouveau-mot-de-passe'

/**
 * Que devient le blocage posé par l'URL ? Le client d'authentification finit de
 * s'initialiser (il a alors traité les jetons de l'adresse), puis émet
 * PASSWORD_RECOVERY si le lien est accepté. S'il ne l'émet pas (jeton refusé ou
 * expiré, erreur portée par l'adresse), le flux n'aura pas lieu : garder le
 * blocage interdirait toute mise à jour jusqu'à la fermeture de la page.
 * - `wait` : l'initialisation n'est pas finie, on ne sait pas encore ;
 * - `handover` : récupération confirmée, l'écran de nouveau mot de passe prend
 *   le relais avec son propre blocage ;
 * - `release` : le lien n'a pas abouti, on lève.
 */
export function recoveryLinkOutcome(state: {
  initialized: boolean
  recoverySeen: boolean
}): 'wait' | 'handover' | 'release' {
  if (state.recoverySeen) return 'handover'
  return state.initialized ? 'release' : 'wait'
}

/**
 * L'adresse est-elle celle d'un lien de récupération Supabase ? Le lien revient
 * sur l'origine avec `type=recovery`, dans le fragment (flux implicite) ou dans
 * la requête.
 */
export function isRecoveryUrl(href: string): boolean {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return false
  }
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ''))
  return fragment.get('type') === 'recovery' || url.searchParams.get('type') === 'recovery'
}

/** Vrai si la page a été ouverte par un lien de récupération. */
export const arrivedOnRecoveryLink: boolean =
  typeof window !== 'undefined' && isRecoveryUrl(window.location.href)
