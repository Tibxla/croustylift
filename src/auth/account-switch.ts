// Arrivée d'un compte validé par le serveur sur l'appareil (ADR 0012).
//
// Le marqueur local-account dit QUI l'appareil reconnaît. Avant, une session
// arrivée pour un AUTRE compte réécrivait seulement le marqueur : les copies de
// lecture et l'état de capture du compte précédent restaient en clair dans le
// stockage pendant toute l'utilisation par le nouveau (audit sécurité,
// constat 3). Ils sont purgés ici, au moment où le compte change.
//
// SAUF si l'ancien compte a encore des écritures retenues (file ou
// quarantaine) : rien n'est purgé, ADR 0012 prime (rien ne se perd sans geste
// explicite). Ses ops restent en file sans partir sous le nouveau compte
// (étiquette de compte, cf. outbox), son état de capture n'est pas restauré
// sous lui (cf. state `loadPersisted`), et ses copies de lecture, rangées sous
// son id, ne lui sont pas servies.
import { loadLocalAccount, saveLocalAccount, type LocalAccount } from '../lib/local-account';
import { clearReadCache } from '../lib/read-cache';
import { clearLocalPrefs } from '../lib/local-prefs';
import { heldCounts } from '../features/capture/outbox';
import { clearOwnCaptureState } from '../features/capture/state';

/**
 * Pose (ou ré-affirme) le marqueur pour `next`. Si c'est un compte DIFFÉRENT de
 * celui reconnu jusque-là et que ce dernier n'a plus d'écriture retenue, purge
 * d'abord ses copies de lecture et son état de capture ; ses préférences
 * d'affichage partent dans tous les cas. `clearReadCache` vide
 * aussi le registre de revalidation et neutralise les lectures encore en vol :
 * aucune ne ressèmera une copie sous l'ancien compte.
 */
export function recognizeAccount(next: LocalAccount): void {
  const previous = loadLocalAccount();
  if (previous && previous.userId !== next.userId) {
    // Préférences d'affichage du précédent : pas des saisies, rien à retenir.
    // Elles partent toujours, même quand ses écritures retenues gardent le reste.
    clearLocalPrefs();
    // Ce que retient le PRÉCÉDENT (encore le compte reconnu à cet instant). Sa
    // capture seule part : celle d'un tiers encore retenu sur l'appareil reste.
    if (heldCounts().own === 0) {
      clearOwnCaptureState();
      clearReadCache();
    }
  }
  saveLocalAccount(next);
}

/**
 * GARDE D'ARRIVÉE (ADR 0019) : une session s'ouvre pour `nextUserId`. Rend le
 * nombre d'écritures retenues qui s'y opposent : celles du compte que l'appareil
 * reconnaît, s'il est différent. `0` = rien ne s'y oppose (aucun compte
 * reconnu, même compte, ou plus rien de retenu pour lui).
 *
 * `signIn` a sa propre garde, sur l'adresse saisie (`foreignPendingWrites`).
 * Celle-ci couvre les sessions qui arrivent SANS passer par lui : lien de
 * récupération ou d'invitation, session restaurée. Avant, un autre compte arrivé
 * par lien prenait le marqueur par-dessus les saisies en attente du précédent.
 */
export function arrivalBlockedBy(nextUserId: string): number {
  const recognized = loadLocalAccount();
  if (!recognized || recognized.userId === nextUserId) return 0;
  return heldCounts().own;
}
