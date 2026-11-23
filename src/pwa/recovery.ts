// Arrivée par un lien de récupération de mot de passe : détection PURE, et relevé
// fait à l'évaluation du module.
//
// Ce module n'importe rien et doit rester le PREMIER import de main.tsx : le
// client Supabase retire les jetons de l'URL en s'initialisant, il faut avoir lu
// l'adresse avant. Tant que ce flux n'est pas terminé, aucun rechargement
// automatique ne doit avoir lieu (il ferait perdre l'écran de nouveau mot de
// passe, et le lien ne sert qu'une fois).

/** Raison de blocage posée à l'arrivée par un lien de récupération. */
export const RECOVERY_BLOCK = 'recuperation-mot-de-passe'

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
