// Libellés de l'état de synchro (bannière de la Capture, Déconnexion refusée).
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
