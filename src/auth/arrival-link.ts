// Arrivée par un lien d'e-mail (invitation, récupération du mot de passe).
//
// L'inscription est fermée : un compte naît d'une invitation envoyée depuis le
// tableau de bord Supabase. Le lien ouvre une session (flux implicite : les
// jetons arrivent dans le fragment de l'URL) pour un compte qui n'a pas encore de
// mot de passe. supabase-js n'émet alors que SIGNED_IN, pas PASSWORD_RECOVERY :
// sans lecture du fragment, l'invité entrerait dans l'app sans jamais définir
// son mot de passe et ne pourrait plus se reconnecter.
//
// Le fragment est lu AVANT la création du client (cf. lib/supabase), qui le
// retire de l'URL une fois la session ouverte.

export interface ArrivalLink {
  /** Le lien demande de définir un mot de passe : invitation ou récupération. */
  kind: 'invite' | 'recovery' | null;
  /** Le lien est refusé par le serveur (expiré, déjà utilisé). */
  failed: boolean;
}

/** Lit le fragment d'URL d'arrivée (`#access_token=…&type=invite`). Pur. */
export function arrivalFromHash(hash: string): ArrivalLink {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const failed =
    params.has('error') || params.has('error_code') || params.has('error_description');
  const type = params.get('type');
  const kind = type === 'invite' || type === 'recovery' ? type : null;
  // Un lien refusé n'ouvre pas de session : il n'y a pas de mot de passe à définir.
  return { kind: failed ? null : kind, failed };
}
