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
}

/** Un mot qui dit l'état, puis le détail. */
export interface SyncLine {
  title: string;
  detail: string;
}

const saisies = (n: number) => `${n} saisie${n > 1 ? 's' : ''}`;

export function syncLine({ pending, refused, offline, unsaved }: SyncState): SyncLine | null {
  if (unsaved) return { title: 'Stockage plein', detail: 'tes saisies ne sont pas gardées ici, laisse l’app ouverte' };
  const refusedTail = refused > 0 ? ` · ${saisies(refused)} refusée${refused > 1 ? 's' : ''}` : '';
  if (offline) {
    return {
      title: 'Hors ligne',
      detail: (pending === 0 ? 'les saisies restent sur cet appareil' : `${saisies(pending)} sur l’appareil, envoi au retour`) + refusedTail,
    };
  }
  if (pending > 0) return { title: 'Envoi en cours', detail: `${saisies(pending)} en attente${refusedTail}` };
  // Seules, les saisies refusées se disent en un titre, sans détail : la ligne
  // ne se coupe plus, et son bout dit seulement « Voir » (SyncBanner).
  if (refused > 0) return { title: `${saisies(refused)} refusée${refused > 1 ? 's' : ''}`, detail: '' };
  return null;
}
