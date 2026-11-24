// Quand la file d'écritures a-t-elle pu changer ? Pour un écran qui la LIT
// sans y écrire : le sélecteur « Quelle séance ? » fusionne à sa méta les
// exécutions encore en file (seance-meta.ts), et relit la méta quand l'une
// d'elles en sort.
//
// Le point commun de retrait de la file est dans outbox.ts, gelé (un chantier
// séparé le réécrit) : on n'y publie rien. On écoute à la place ce qui existe :
//   - la fin de chaque flush de CET onglet (`onFlushSettled`, sync.ts), qu'il
//     vienne de la Salle, de l'Analyse ou du flush global de l'App ;
//   - l'événement `storage` de la clé de la file : un AUTRE onglet l'a écrite
//     (flush, saisie) ; `key` nulle quand le stockage est vidé ;
//   - `OUTBOX_CHANGED_EVENT` (nouvel essai programmé, geste d'un écran) ;
//   - le retour du réseau (`online`), qui précède un flush.
import { OUTBOX_CHANGED_EVENT } from './outbox';
import { onFlushSettled } from './sync';

/** La clé de la file dans le stockage : `STORAGE_KEY` d'outbox.ts, épinglée par test. */
export const OUTBOX_STORAGE_KEY = 'croustylift:outbox';

/** Appelle `listener` à chaque changement possible de la file. Rend le désabonnement. */
export function onQueueChanged(
  listener: () => void,
  target: EventTarget | null = typeof window === 'undefined' ? null : window,
): () => void {
  const onStorage = (event: Event) => {
    const key = (event as StorageEvent).key;
    if (key === null || key === OUTBOX_STORAGE_KEY) listener();
  };
  target?.addEventListener(OUTBOX_CHANGED_EVENT, listener);
  target?.addEventListener('online', listener);
  target?.addEventListener('storage', onStorage);
  const offFlush = onFlushSettled(listener);
  return () => {
    target?.removeEventListener(OUTBOX_CHANGED_EVENT, listener);
    target?.removeEventListener('online', listener);
    target?.removeEventListener('storage', onStorage);
    offFlush();
  };
}
