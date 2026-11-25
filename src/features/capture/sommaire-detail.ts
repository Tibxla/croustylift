// Ce que dit le bouton Sommaire de l'instrument sous son nom : où en est la
// séance (« 2 sur 6 faits »), TOUJOURS, hors ligne comme sur réseau faible. La
// salle sans réseau est le cas nominal, pas une alerte : l'envoi en attente se
// lit dans le Sommaire et sur « Quelle séance ? », qui ont la ligne de synchro.
// Avant, le sous-titre devenait « hors ligne · 12 » pour toute la séance, ou
// basculait après chaque série sur réseau faible.
//
// Seules les alarmes prennent la place (et passent en demi-gras) : un stockage
// plein (fermer l'app perdrait des saisies) ou des saisies refusées par le
// serveur, qui demandent un geste. L'instrument n'a pas de ligne de plus : elle
// pousserait les plaques de réglage sous le pied. Pur.
//
// Les deux formes du stockage plein (ADR 0025 : saisies en mémoire seulement,
// ou envoi arrêté) et la version dépassée par un autre onglet (plus rien ne
// part, rien n'est gardé) sont des alarmes au même titre.
import type { SyncState } from '../../shell/sync-line';

export function sommaireDetail(sync: SyncState, done: number, total: number): { text: string; alarm: boolean } {
  if (sync.outdated) return { text: 'mise à jour', alarm: true };
  if (sync.unsaved || sync.full) return { text: 'stockage plein', alarm: true };
  if (sync.refused > 0) return { text: `${sync.refused} refusée${sync.refused > 1 ? 's' : ''}`, alarm: true };
  return { text: `${done} sur ${total} faits`, alarm: false };
}
