// État réel de la file d'écritures, pour la ligne de synchro du shell.
//
// Lecture SEULE des API exposées par la file (features/capture/outbox.ts) et
// par l'état de capture (state.ts), qui restent intouchés : `pendingCount`,
// `listRefused`, `storageFailing`, `capturePersistFailing`. Les refus comptés
// sont ceux du compte reconnu (`listRefused`), les seuls que l'écran des saisies
// refusées montre et laisse renvoyer ou abandonner : ceux d'un autre compte
// restent sur l'appareil sans être annoncés ici.
//
// Ce qui manque : la file n'émet pas d'événement à chaque mutation (enfilage,
// passe d'envoi). Elle n'émet `OUTBOX_CHANGED_EVENT` que sur un nouvel essai
// reprogrammé, et la Capture prévient sa propre bannière par un store interne
// non exporté. On écoute donc ce qui existe (réseau, `OUTBOX_CHANGED_EVENT`,
// stockage modifié par un autre onglet) et on relit l'état toutes les 2 s, ce
// qui ne coûte que deux lectures du stockage local.
import { useSyncExternalStore } from 'react';
import { listRefused, OUTBOX_CHANGED_EVENT, pendingCount, storageFailing } from '../features/capture/outbox';
import { capturePersistFailing } from '../features/capture/state';
import type { SyncState } from './sync-line';

const POLL_MS = 2000;

function subscribe(cb: () => void): () => void {
  const events = ['online', 'offline', OUTBOX_CHANGED_EVENT, 'storage'] as const;
  for (const e of events) window.addEventListener(e, cb);
  const timer = window.setInterval(cb, POLL_MS);
  return () => {
    for (const e of events) window.removeEventListener(e, cb);
    window.clearInterval(timer);
  };
}

/** Clé stable : useSyncExternalStore exige un instantané identique tant que rien ne change. */
function snapshot(): string {
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  return [pendingCount(), listRefused().length, offline ? 1 : 0, storageFailing() || capturePersistFailing() ? 1 : 0].join('|');
}

export function useSyncState(): SyncState {
  const key = useSyncExternalStore(subscribe, snapshot, () => '0|0|0|0');
  const [pending, refused, offline, unsaved] = key.split('|').map(Number) as [number, number, number, number];
  return { pending, refused, offline: offline === 1, unsaved: unsaved === 1 };
}
