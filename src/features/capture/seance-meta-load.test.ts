// La lecture de la méta de « Quelle séance ? » (seance-meta-load.ts) ne doit pas
// survivre au sélecteur : rejouée après chaque flush (registre global du cache),
// elle relisait versions, prescriptions et dernières exécutions de chaque séance
// pour un écran fermé, en plein exercice. Elle se revalide au retour du réseau,
// et seulement tant que le sélecteur est monté.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));

import { watchSeancesMeta } from './seance-meta-load';
import { clearReadCache, revalidateReadCache } from '../../lib/read-cache';
import { saveLocalAccount } from '../../lib/local-account';
import type { StoredMap } from './seance-meta';

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
  clear(): void {
    this.store.clear();
  }
  get length(): number {
    return this.store.size;
  }
  key(i: number): string | null {
    return [...this.store.keys()][i] ?? null;
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const META: StoredMap = { a: { lastOn: '2026-11-20', lastExecutionId: 'x', exerciseCount: 5, versionIds: ['v1'] } };

beforeEach(() => {
  (globalThis as unknown as { localStorage: Storage }).localStorage = new MemoryStorage() as unknown as Storage;
  clearReadCache();
  saveLocalAccount({ userId: 'user-1', email: 'toi@exemple.com' });
});

describe('watchSeancesMeta', () => {
  it('sélecteur fermé : le rejeu après un flush ne relit pas la méta, et revalidate ne fait plus rien', async () => {
    const fetcher = vi.fn(async () => META);
    const watch = watchSeancesMeta(['a'], () => {}, { fetcher });
    await settle();
    watch.stop();
    expect(fetcher).toHaveBeenCalledTimes(1);
    revalidateReadCache();
    watch.revalidate();
    await settle();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('amorce depuis la copie, puis affiche la réponse réseau', async () => {
    const first = watchSeancesMeta(['a'], () => {}, { fetcher: async () => META });
    await settle();
    first.stop();
    const seen: StoredMap[] = [];
    const watch = watchSeancesMeta(['a'], (m) => seen.push(m), { fetcher: async () => ({ a: { ...META.a!, lastOn: '2026-11-24' } }) });
    // La copie tout de suite, sans attendre le réseau.
    expect(seen[0]?.a?.lastOn).toBe('2026-11-20');
    await settle();
    expect(seen.at(-1)?.a?.lastOn).toBe('2026-11-24');
    watch.stop();
  });

  it('sélecteur monté : revalidate (la file a changé) relit la méta, et l’écran la reçoit', async () => {
    const fetcher = vi.fn(async () => META);
    const seen: StoredMap[] = [];
    const watch = watchSeancesMeta(['a'], (m) => seen.push(m), { fetcher });
    await settle();
    fetcher.mockResolvedValue({ a: { ...META.a!, lastOn: '2026-11-24' } });
    watch.revalidate();
    await settle();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(seen.at(-1)?.a?.lastOn).toBe('2026-11-24');
    watch.stop();
  });

  it('à cache vide, la réponse initiale arrivée APRÈS une réponse plus récente ne réaffiche pas l’ancienne date', async () => {
    let first: (m: StoredMap) => void = () => {};
    const fetcher = vi.fn(() => new Promise<StoredMap>((ok) => (first = ok)));
    const seen: StoredMap[] = [];
    const watch = watchSeancesMeta(['a'], (m) => seen.push(m), { fetcher });
    const old = first;
    // Revalidation (la file a changé) : elle part après, répond avant.
    fetcher.mockImplementation(async () => ({ a: { ...META.a!, lastOn: '2026-11-24' } }));
    watch.revalidate();
    await settle();
    old(META);
    await settle();
    expect(seen.at(-1)?.a?.lastOn).toBe('2026-11-24');
    watch.stop();
  });
});
