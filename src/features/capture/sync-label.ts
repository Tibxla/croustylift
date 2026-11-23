// Libellés de l'état de synchro (bannière de la Capture, Déconnexion refusée,
// enregistrement d'une correction depuis le journal).
//
// Logique PURE, sans React : ce que l'utilisateur lit selon ce que l'appareil
// retient. Une op en QUARANTAINE (rejetée par la base, cf. outbox) n'est plus
// « en attente » mais n'est pas en base non plus : la bannière ne dit donc
// jamais « Synchronisé » tant qu'il en reste, et une Déconnexion refusée à
// cause d'elle dit la vraie raison (revenir en ligne n'y changerait rien).

/** Ton de la bannière : vert discret, info (synchro en cours), ambre (attention). */
export type SyncTone = 'good' | 'info' | 'warn';

/** « 1 saisie refusée par le serveur » / « 2 saisies refusées par le serveur ». */
function refusedSubject(count: number): string {
  return `${count} saisie${count > 1 ? 's' : ''} refusée${count > 1 ? 's' : ''} par le serveur`;
}

/**
 * Ton et texte de la bannière de synchro. `pending` : ops en file ;
 * `quarantined` : ops rejetées par la base, mises de côté. L'ambre (jamais le
 * rouge) signale une quarantaine non vide, quel que soit l'état de la file.
 */
export function syncBannerLabel(input: {
  pending: number;
  quarantined: number;
  online: boolean;
}): { tone: SyncTone; label: string } {
  const { pending, quarantined, online } = input;
  const refused =
    quarantined > 0
      ? `${refusedSubject(quarantined)}, non envoyée${quarantined > 1 ? 's' : ''}.`
      : null;

  if (pending === 0) {
    return refused
      ? { tone: 'warn', label: refused }
      : { tone: 'good', label: 'Synchronisé. Tout est en base.' };
  }
  const waiting = online
    ? `Synchronisation… ${pending} en attente.`
    : `Hors ligne. ${pending} en attente, gardé sur l’appareil.`;
  if (refused) return { tone: 'warn', label: `${waiting} ${refused}` };
  return { tone: online ? 'info' : 'warn', label: waiting };
}

/**
 * Raison affichée quand la Déconnexion est refusée (ADR 0012). `held` : tout ce
 * que l'appareil retient (file et quarantaine) ; `refused` : la part en
 * quarantaine. Revenir en ligne ne sauve que ce qui attend encore l'envoi.
 */
export function signOutRefusalLabel(input: { held: number; refused: number }): string {
  const refused = Math.min(Math.max(input.refused, 0), input.held);
  const waiting = input.held - refused;
  const parts: string[] = [];
  if (waiting > 0) {
    parts.push(
      `${waiting} saisie${waiting > 1 ? 's' : ''} pas encore synchronisée${waiting > 1 ? 's' : ''}. ` +
        'Reviens en ligne pour te déconnecter sans rien perdre.',
    );
  }
  if (refused > 0) {
    parts.push(
      `${refusedSubject(refused)} ${refused > 1 ? 'n’ont' : 'n’a'} pas pu être ` +
        `enregistrée${refused > 1 ? 's' : ''}.`,
    );
  }
  return parts.join(' ');
}

/**
 * Ce que l'éditeur de séance passée affiche quand ses écritures ne sont pas
 * toutes en base après la passe (cf. `flushOps`). `pending` : celles qui
 * attendent encore l'envoi ; `refused` : celles que le serveur a refusées. Les
 * deux ne se disent pas pareil : « pas de réseau » serait faux pour un refus,
 * que revenir en ligne ne changera pas.
 */
export function unsavedWritesLabel(input: { pending: number; refused: number }): string {
  const pending = Math.max(input.pending, 0);
  const refused = Math.max(input.refused, 0);
  const parts: string[] = [];
  if (pending > 0) {
    parts.push(
      'Pas de réseau pour le moment. Gardé sur l’appareil, envoyé au retour du réseau.',
    );
  }
  if (refused > 0) {
    parts.push(
      `${refusedSubject(refused)} : ${refused > 1 ? 'elles ne sont pas enregistrées' : 'elle n’est pas enregistrée'}.`,
    );
  }
  return parts.join(' ');
}

/**
 * Texte de la garde d'arrivée (ADR 0019) : un autre compte s'ouvre par lien
 * alors que l'appareil retient les saisies du précédent. Dit à QUI sont les
 * saisies et ce que chacun peut faire.
 */
export function arrivalGuardLabel(input: {
  held: number;
  heldEmail: string | null;
  arrivingEmail: string | null;
}): string {
  const { held } = input;
  const owner = input.heldEmail ?? 'un autre compte';
  const arriving = input.arrivingEmail ? ` (${input.arrivingEmail})` : '';
  return (
    `${held} saisie${held > 1 ? 's' : ''} de ${owner} attend${held > 1 ? 'ent' : ''} encore ` +
    `la synchronisation sur cet appareil, et ce lien ouvre un autre compte${arriving}. ` +
    `Reviens à la connexion et connecte-toi avec ${owner} pour les envoyer.`
  );
}

/**
 * Avis de l'écran de connexion quand l'appareil retient des saisies (ADR 0012,
 * 0019). `own` : celles du compte reconnu (`email`) ; `foreign` : celles d'un
 * autre compte, dont l'appareil ne connaît que l'identifiant. `null` si rien
 * n'est retenu.
 */
export function heldWritesNotice(input: {
  own: number;
  foreign: number;
  email: string | null;
}): string | null {
  const count = (n: number) =>
    `${n} saisie${n > 1 ? 's' : ''} ${n > 1 ? 'attendent' : 'attend'} encore la synchronisation`;
  const parts: string[] = [];
  if (input.own > 0) {
    parts.push(`${count(input.own)} pour ${input.email ?? 'ton compte'}.`);
  }
  if (input.foreign > 0) {
    parts.push(
      `${count(input.foreign)} pour ${input.own > 0 ? 'un autre compte' : 'un compte déjà passé sur cet appareil'}.`,
    );
  }
  if (parts.length === 0) return null;
  return `${parts.join(' ')} Connecte-toi avec le compte concerné pour les envoyer.`;
}
