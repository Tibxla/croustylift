// Aide de test : lire l'enregistrement du registre d'écritures tel qu'il est
// ÉCRIT sur l'appareil (features/capture/outbox.ts), pour les tests qui portent
// sur la persistance elle-même (stockage plein, rechargement, deux onglets). Le
// reste des tests passe par l'interface du registre.
import type { OutboxOp } from '../features/capture/outbox';

export const REGISTRY_KEY = 'croustylift:registre';

export interface StoredWrite {
  n: number;
  uid: string;
  owner?: string;
  op: OutboxOp;
  fate: 'pending' | 'refused' | 'acked';
}

type KeyValue = { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void };

/** Les écritures de l'enregistrement persisté (vide s'il n'est pas sur l'appareil). */
export function storedWrites(storage: KeyValue = localStorage): StoredWrite[] {
  const raw = storage.getItem(REGISTRY_KEY);
  return raw ? (JSON.parse(raw) as { entries: StoredWrite[] }).entries : [];
}

/** Les ids des écritures EN ATTENTE de l'enregistrement persisté, dans l'ordre d'envoi. */
export function storedPendingIds(storage: KeyValue = localStorage): string[] {
  return storedWrites(storage)
    .filter((write) => write.fate === 'pending')
    .map((write) => write.op.id);
}

/** Un AUTRE onglet réécrit l'enregistrement pendant qu'on a le dos tourné. */
export function otherTabRewrites(
  change: (writes: StoredWrite[]) => StoredWrite[],
  storage: KeyValue = localStorage,
): void {
  const record = JSON.parse(storage.getItem(REGISTRY_KEY) ?? '{"v":1,"seq":0,"entries":[]}') as {
    entries: StoredWrite[];
  };
  storage.setItem(REGISTRY_KEY, JSON.stringify({ ...record, entries: change(record.entries) }));
}

/**
 * La base ACQUITTE tout ce qui attend, depuis un autre onglet : les écritures
 * restent à l'enregistrement, acquittées, avec un numéro plus récent que tout.
 * Pour jouer un acquittement au milieu d'une lecture (callback synchrone).
 */
export function otherTabAcknowledgesAll(storage: KeyValue = localStorage): void {
  const raw = storage.getItem(REGISTRY_KEY);
  if (!raw) return;
  const record = JSON.parse(raw) as { v: number; seq: number; entries: (StoredWrite & { ack?: number; parents?: string[] })[] };
  let seq = Math.max(record.seq, Date.now());
  const entries = record.entries.map((entry) => {
    if (entry.fate !== 'pending') return entry;
    seq += 1;
    const { parents: _parents, ...rest } = entry;
    return { ...rest, fate: 'acked' as const, ack: seq };
  });
  storage.setItem(REGISTRY_KEY, JSON.stringify({ ...record, seq, entries }));
}
