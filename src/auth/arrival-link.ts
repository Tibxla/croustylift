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

// --- Obligation de définir son mot de passe, persistée par compte --------------
//
// Le fragment d'invitation ne se lit qu'UNE fois : supabase-js le retire de
// l'URL et garde la session. Si l'invité rechargeait l'écran de mot de passe
// avant de l'avoir enregistré, la session était restaurée sans fragment, l'app
// s'ouvrait, et il n'avait toujours aucun mot de passe : une fois déconnecté, il
// lui fallait un nouveau lien. L'obligation est donc écrite sur l'appareil, par
// compte, dès l'arrivée par invitation ; elle est relue à chaque session
// restaurée et n'est levée qu'après le succès de l'enregistrement du mot de
// passe. Elle n'est pas une donnée du compte : la purge de Déconnexion ne la
// retire pas.

const PASSWORD_SETUP_PREFIX = 'croustylift:password-setup:';

/** Ce compte doit définir son mot de passe avant d'entrer dans l'app. */
export function requirePasswordSetup(userId: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(`${PASSWORD_SETUP_PREFIX}${userId}`, '1');
  } catch {
    // Stockage plein : l'obligation ne tiendra que le temps de la page.
  }
}

/** Ce compte a-t-il encore son mot de passe à définir ? */
export function passwordSetupRequired(userId: string): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(`${PASSWORD_SETUP_PREFIX}${userId}`) !== null;
  } catch {
    return false;
  }
}

/** Le mot de passe de ce compte vient d'être enregistré : l'obligation est levée. */
export function clearPasswordSetup(userId: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(`${PASSWORD_SETUP_PREFIX}${userId}`);
  } catch {
    /* no-op */
  }
}
