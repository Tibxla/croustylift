// Ligne de synchro du shell : ce que l'appareil retient, en une ligne. Pure (testée).
//
// Même règle que le prototype (kit.tsx, SyncBanner) : rien quand tout est
// envoyé, on ne rassure pas pour rien. Hors ligne, les saisies restent sur
// l'appareil, ce n'est pas une erreur. S'y ajoutent deux états réels que le
// prototype n'avait pas : les saisies refusées par le serveur (quarantaine de
// la file, ADR 0018), qui ne repartiront pas seules, et le stockage plein, qui
// prime sur tout (fermer l'app perdrait des saisies).

export interface SyncState {
  /** Écritures en file, pas encore envoyées. */
  pending: number;
  /** Écritures refusées par le serveur, mises de côté. */
  refused: number;
  offline: boolean;
  /** Le stockage de l'appareil refuse les écritures. */
  unsaved: boolean;
  /**
   * Une version plus récente de l'app a écrit le registre de l'appareil (autre
   * onglet mis à jour) : celle-ci n'envoie plus rien, il faut recharger.
   */
  outdated?: boolean;
}

/** Un mot qui dit l'état, puis le détail. */
export interface SyncLine {
  title: string;
  detail: string;
}

const saisies = (n: number) => `${n} saisie${n > 1 ? 's' : ''}`;

export function syncLine({ pending, refused, offline, unsaved, outdated }: SyncState): SyncLine | null {
  // Prime sur tout : rien ne part plus d'ici, et ce qui est saisi n'est pas gardé.
  if (outdated) {
    return { title: 'Mise à jour nécessaire', detail: 'recharge l’app pour reprendre l’envoi, ce que tu saisis d’ici là n’est pas gardé' };
  }
  if (unsaved) return { title: 'Stockage plein', detail: 'tes saisies ne sont pas gardées ici, laisse l’app ouverte' };
  const refusedTail = refused > 0 ? ` · ${saisies(refused)} refusée${refused > 1 ? 's' : ''}` : '';
  if (offline) {
    return {
      title: 'Hors ligne',
      detail: (pending === 0 ? 'les saisies restent sur cet appareil' : `${saisies(pending)} sur l’appareil, envoi au retour`) + refusedTail,
    };
  }
  if (pending > 0) return { title: 'Envoi en cours', detail: `${saisies(pending)} en attente${refusedTail}` };
  if (refused > 0) return { title: 'Refusé par le serveur', detail: `${saisies(refused)} non envoyée${refused > 1 ? 's' : ''}` };
  return null;
}
