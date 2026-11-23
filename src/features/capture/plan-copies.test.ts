// Une écriture du plan marque périmées les copies du plan servies à la Capture,
// et elles seules.
import { describe, it, expect, beforeEach } from 'vitest';
import { invalidateExerciseNoteCopy, invalidatePlanCopies } from './plan-copies';
import { cachedRead, clearReadCache } from '../../lib/read-cache';
import { saveLocalAccount } from '../../lib/local-account';

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(k: string): string | null {
    return this.store.has(k) ? (this.store.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.store.set(k, String(v));
  }
  removeItem(k: string): void {
    this.store.delete(k);
  }
  get length(): number {
    return this.store.size;
  }
  key(i: number): string | null {
    return [...this.store.keys()][i] ?? null;
  }
}

const PLAN = [
  'capture-source',
  'seance-version:s1',
  'seance-version-ids:s1',
  'seance-template:v1:s1',
  'exercises',
];
const HORS_PLAN = ['exo-execs:e1', 'exo-note:e1', 'last-exec:s1', 'prev-notes:s1'];

/** Les clés (sans compte) des copies marquées périmées. */
function stale(): string[] {
  const prefix = 'croustylift:readcache:user-1:';
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key?.startsWith(prefix)) continue;
    if (JSON.parse(localStorage.getItem(key) ?? '{}').stale === true) {
      keys.push(key.slice(prefix.length));
    }
  }
  return keys.sort();
}

beforeEach(async () => {
  (globalThis as unknown as { localStorage: Storage }).localStorage =
    new MemoryStorage() as unknown as Storage;
  clearReadCache();
  saveLocalAccount({ userId: 'user-1', email: 'toi@exemple.com' });
  for (const key of [...PLAN, ...HORS_PLAN]) await cachedRead(key, async () => key);
});

describe('invalidatePlanCopies', () => {
  it('marque périmées les copies du plan, pas l’historique ni les notes', () => {
    invalidatePlanCopies();
    expect(stale()).toEqual([...PLAN].sort());
  });
});

describe('invalidateExerciseNoteCopy', () => {
  it('marque périmée la note de cet exo seulement', async () => {
    await cachedRead('exo-note:e2', async () => 'autre note');
    invalidateExerciseNoteCopy('e1');
    expect(stale()).toEqual(['exo-note:e1']);
  });
});
