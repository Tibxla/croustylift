// Quand le registre d'écritures a-t-il pu changer ? Pour un écran qui le LIT
// sans y écrire : le sélecteur « Quelle séance ? » fusionne à sa méta les
// exécutions encore en attente (seance-meta.ts), et relit la méta quand l'une
// d'elles en sort.
//
// On écoute :
//   - la fin de chaque flush de CET onglet (`onFlushSettled`, sync.ts), qu'il
//     vienne de la Salle, de l'Analyse ou du flush global de l'App ;
//   - l'événement `storage` d'une clé du registre (`isRegistryStorageKey` :
//     enregistrement, boîtes d'entrée, ancien format) : un AUTRE onglet l'a
//     écrite (flush, saisie) ; `key` nulle quand le stockage est vidé ;
//   - `OUTBOX_CHANGED_EVENT` (nouvel essai programmé, geste d'un écran) ;
//   - le retour du réseau (`online`), qui précède un flush.
import { isRegistryStorageKey, OUTBOX_CHANGED_EVENT } from './outbox';
import { onFlushSettled } from './sync';

/** Appelle `listener` à chaque changement possible de la file. Rend le désabonnement. */
export function onQueueChanged(
  listener: () => void,
  target: EventTarget | null = typeof window === 'undefined' ? null : window,
): () => void {
  const onStorage = (event: Event) => {
    const key = (event as StorageEvent).key;
    if (key === null || isRegistryStorageKey(key)) listener();
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
