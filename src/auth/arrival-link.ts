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

// --- Obligation de définir son mot de passe -------------------------------------
//
// Le fragment d'invitation ne se lit qu'UNE fois : supabase-js le retire de
// l'URL et garde la session. Si l'invité rechargeait l'écran de mot de passe
// avant de l'avoir enregistré, la session était restaurée sans fragment, l'app
// s'ouvrait, et il n'avait toujours aucun mot de passe : une fois déconnecté, il
// lui fallait un nouveau lien.
//
// L'obligation est donc TENUE PAR LE SERVEUR, et relue sur la session elle-même
// (`invitedWithoutPassword`), sans rien écrire à l'arrivée :
//   - `invited_at` : posé par le serveur d'auth à l'invitation, jamais retiré
//     (accepter le lien ne pose que `email_confirmed_at`) ;
//   - la revendication `amr` du jeton d'accès : les méthodes par lesquelles la
//     session a été ouverte. Une session ouverte par un lien porte `otp`, une
//     session ouverte par mot de passe porte `password`. Le serveur la recalcule
//     à chaque émission du jeton, rafraîchissement compris.
// La SEULE preuve qu'un mot de passe connu de son titulaire existe est donc une
// session ouverte avec lui. Rien que le client puisse écrire n'en tient lieu :
// un marqueur dans `user_metadata`, que le titulaire d'une session invitée peut
// poser lui-même sans définir de mot de passe, levait l'obligation (relecture
// du second tour). Le serveur, lui, ne sait pas dire « ce compte n'a pas de mot
// de passe » : à l'acceptation d'une invitation il en tire un au hasard.
//
// Définir son mot de passe se fait donc en deux temps (`definePassword`) :
// l'enregistrer, puis ouvrir une session AVEC lui. C'est cette session qui lève
// l'obligation.
//
// Aucun faux positif n'est permis : l'écran de mot de passe prime sur toute
// l'app (App.tsx). Un compte qui se connecte par mot de passe a sa preuve. Et
// les comptes invités avant que l'app ne tienne cette obligation
// (`INVITATIONS_SINCE`) en sont exemptés : ils sont entrés sous l'ancien régime,
// parfois avec une session ouverte par lien et un mot de passe défini depuis.
//
// Le drapeau écrit sur l'appareil reste, comme COPIE : il sert l'arrivée même
// (fragment `type=invite`, avant toute autre lecture) et le démarrage en session
// locale, où il n'y a pas de session à lire (ADR 0012). Il est réaligné sur le
// serveur à chaque session validée (`syncPasswordSetup`). Il n'est pas une
// donnée du compte : la purge de Déconnexion ne le retire pas.

/**
 * Les invitations envoyées à partir de cette date portent l'obligation côté
 * serveur. Avant, l'app ne la tenait pas.
 */
export const INVITATIONS_SINCE = Date.parse('2026-11-23T00:00:00Z');

/** Ce que l'obligation lit d'une session supabase-js. */
export interface SetupSession {
  access_token: string;
  user: { id: string; invited_at?: string | null };
}

/**
 * Les méthodes par lesquelles cette session a été ouverte (revendication `amr`
 * du jeton d'accès : `password`, `otp` pour un lien d'e-mail…). Liste vide si le
 * jeton est illisible : aucune preuve, jamais une erreur.
 */
export function sessionAuthMethods(accessToken: string): string[] {
  try {
    const payload = accessToken.split('.')[1];
    if (!payload) return [];
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))) as {
      amr?: unknown;
    };
    if (!Array.isArray(claims.amr)) return [];
    return claims.amr.flatMap((entry: unknown) => {
      if (typeof entry === 'string') return [entry];
      const method = (entry as { method?: unknown } | null)?.method;
      return typeof method === 'string' ? [method] : [];
    });
  } catch {
    return [];
  }
}

/**
 * Preuve qu'un mot de passe connu de son titulaire existe : cette session a été
 * ouverte avec lui. Lue dans le jeton signé par le serveur, pas dans une donnée
 * que le client peut écrire.
 */
export function hasPasswordProof(session: SetupSession): boolean {
  return sessionAuthMethods(session.access_token).includes('password');
}

/** Ce que `definePassword` demande au client d'auth (supabase-js, ou un faux en test). */
export interface PasswordAuth {
  updateUser(attributes: { password: string }): Promise<{ error: unknown }>;
  signInWithPassword(credentials: {
    email: string;
    password: string;
  }): Promise<{ error: unknown }>;
}

/**
 * Définit le mot de passe du compte, puis ouvre une session AVEC lui : c'est
 * elle qui porte la preuve (`amr: password`) et lève l'obligation de l'invité.
 *
 * Si l'ouverture échoue (réseau coupé entre les deux requêtes), le mot de passe
 * est déjà enregistré : l'écran reste, et la nouvelle tentative reçoit du
 * serveur « même mot de passe ». Ce refus-là est donc franchi, la connexion qui
 * suit prouvant que le mot de passe saisi est bien celui du compte.
 */
export async function definePassword(
  auth: PasswordAuth,
  email: string | null | undefined,
  password: string,
): Promise<void> {
  const { error } = await auth.updateUser({ password });
  if (error && (error as { code?: unknown }).code !== 'same_password') throw error;
  if (!email) {
    throw new Error('Compte sans adresse e-mail : impossible de vérifier le mot de passe.');
  }
  const signIn = await auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
}

/**
 * L'obligation telle que le SERVEUR la tient : compte né d'une invitation
 * (depuis `INVITATIONS_SINCE`), sans preuve de mot de passe. Pur : ne dépend ni
 * du fragment d'URL ni du stockage de l'appareil, donc vrai après n'importe quel
 * rechargement, sur n'importe quel appareil.
 */
export function invitedWithoutPassword(session: SetupSession): boolean {
  if (hasPasswordProof(session)) return false;
  const invitedAt = Date.parse(session.user.invited_at ?? '');
  return Number.isFinite(invitedAt) && invitedAt >= INVITATIONS_SINCE;
}

/**
 * Cette session doit-elle passer par l'écran de mot de passe ? À évaluer AVANT
 * la garde d'arrivée, pour toute session qui se présente.
 *
 * `arrivedByInvite` : le fragment de CE chargement de page était une invitation.
 * Vrai si le serveur le dit, si le lien vient de le dire, ou si l'appareil l'a
 * retenu d'un chargement précédent ; faux, toujours, dès que la session a été
 * ouverte par mot de passe. La copie de l'appareil est réalignée au passage (écriture
 * sans garantie : stockage plein, elle manque, et le serveur fait foi).
 */
export function syncPasswordSetup(session: SetupSession, arrivedByInvite: boolean): boolean {
  const userId = session.user.id;
  if (hasPasswordProof(session)) {
    clearPasswordSetup(userId);
    return false;
  }
  const owed =
    arrivedByInvite || invitedWithoutPassword(session) || passwordSetupRequired(userId);
  if (owed) requirePasswordSetup(userId);
  return owed;
}

/**
 * Démarrage en SESSION LOCALE (ADR 0012) : la session est invérifiable, il n'y
 * a que le compte reconnu par l'appareil. L'écran de mot de passe s'impose-t-il
 * quand même ? Oui si la copie de l'obligation existe pour ce compte. La
 * première session validée la confirmera ou la lèvera (`syncPasswordSetup`).
 */
export function offlineStartSetupOwed(recognized: { userId: string } | null): boolean {
  return recognized !== null && passwordSetupRequired(recognized.userId);
}

const PASSWORD_SETUP_PREFIX = 'croustylift:password-setup:';

/** Ce compte doit définir son mot de passe avant d'entrer dans l'app. */
export function requirePasswordSetup(userId: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(`${PASSWORD_SETUP_PREFIX}${userId}`, '1');
  } catch {
    // Stockage plein : la copie manque. Le serveur tient l'obligation
    // (`invitedWithoutPassword`), relue à la prochaine session restaurée.
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
