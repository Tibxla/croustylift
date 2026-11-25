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

type Enumerable = KeyValue & { length?: number; key?: (i: number) => string | null };

/**
 * Les écritures que l'appareil porte : celles de l'enregistrement, et celles
 * que des gestes ont posées dans la boîte d'entrée (`croustylift:registre:in:*`)
 * sans qu'une passe les ait encore fait entrer. Dans l'ordre d'envoi.
 */
export function storedWrites(storage: Enumerable = localStorage): StoredWrite[] {
  const raw = storage.getItem(REGISTRY_KEY);
  const writes = raw ? (JSON.parse(raw) as { entries: StoredWrite[] }).entries : [];
  for (let i = 0; i < (storage.length ?? 0); i += 1) {
    const key = storage.key?.(i);
    if (!key || !key.startsWith(`${REGISTRY_KEY}:in:`)) continue;
    writes.push(...(JSON.parse(storage.getItem(key)!) as { entries: StoredWrite[] }).entries);
  }
  return writes.sort((a, b) => a.n - b.n);
}

/** Les ids des écritures EN ATTENTE de l'enregistrement persisté, dans l'ordre d'envoi. */
export function storedPendingIds(storage: Enumerable = localStorage): string[] {
  return storedWrites(storage)
    .filter((write) => write.fate === 'pending')
    .map((write) => write.op.id);
}

/** Tout ce que l'appareil porte, réuni dans l'enregistrement (la boîte d'entrée y entre). */
function gather(storage: Enumerable): { v: number; seq: number; entries: (StoredWrite & { ack?: number; parents?: string[] })[] } {
  const raw = storage.getItem(REGISTRY_KEY);
  const record = raw ? (JSON.parse(raw) as { v: number; seq: number }) : { v: 1, seq: 0 };
  const entries = storedWrites(storage);
  const boxes: string[] = [];
  for (let i = 0; i < (storage.length ?? 0); i += 1) {
    const key = storage.key?.(i);
    if (key && key.startsWith(`${REGISTRY_KEY}:in:`)) boxes.push(key);
  }
  for (const key of boxes) (storage as unknown as { removeItem: (k: string) => void }).removeItem(key);
  return { v: record.v, seq: Math.max(record.seq, ...entries.map((e) => e.n), 0), entries };
}

/** Un AUTRE onglet réécrit l'enregistrement pendant qu'on a le dos tourné. */
export function otherTabRewrites(
  change: (writes: StoredWrite[]) => StoredWrite[],
  storage: Enumerable = localStorage,
): void {
  const record = gather(storage);
  storage.setItem(REGISTRY_KEY, JSON.stringify({ ...record, entries: change(record.entries) }));
}

/**
 * La base ACQUITTE tout ce qui attend, depuis un autre onglet : les écritures
 * restent à l'enregistrement, acquittées, avec un numéro plus récent que tout.
 * Pour jouer un acquittement au milieu d'une lecture (callback synchrone).
 */
export function otherTabAcknowledgesAll(storage: Enumerable = localStorage): void {
  const record = gather(storage);
  let seq = Math.max(record.seq, Date.now());
  const entries = record.entries.map((entry) => {
    if (entry.fate !== 'pending') return entry;
    seq += 1;
    const { parents: _parents, ...rest } = entry;
    return { ...rest, fate: 'acked' as const, ack: seq };
  });
  storage.setItem(REGISTRY_KEY, JSON.stringify({ ...record, seq, entries }));
}

/**
 * Ce que l'ancienne file porte encore à reprendre : ses écritures, sans le
 * verrou que le registre y pose pour arrêter les onglets de l'ancienne version.
 */
export function legacyQueueWrites(storage: KeyValue = localStorage): unknown[] {
  const raw = storage.getItem('croustylift:outbox');
  const queue = raw ? (JSON.parse(raw) as { _uid?: string }[]) : [];
  // Ni le verrou ni les repères que le registre y pose lui-même.
  return queue.filter((op) => op._uid !== 'registre-actif');
}

/** Laisse passer le tour de boucle où le registre écrit, sous le verrou, ce qu'un geste a tenu en mémoire. */
export async function registrySettled(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}
