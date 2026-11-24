// Lectures d'écran au calme servies depuis une copie datée (UX 7).
//
// Env node : localStorage mémoire réinitialisé avant chaque test, aucun réseau
// (fetchers en vi.fn). On vérifie : hors ligne rien n'est lancé ; la copie sert
// avec sa date ; la revalidation prévient l'écran ; une écriture faite d'ici
// fait relire le réseau au lieu de resservir la copie d'avant.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearReadCache } from './read-cache';
import { saveLocalAccount } from './local-account';
import { invalidateViews, loadDated, peekDated, VIEW_PREFIX, watchDated, type DatedState } from './dated-read';

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
const KEY = `${VIEW_PREFIX}routines`;

beforeEach(() => {
  (globalThis as unknown as { localStorage: Storage }).localStorage = new MemoryStorage() as unknown as Storage;
  clearReadCache();
  saveLocalAccount({ userId: 'user-1', email: 'toi@exemple.com' });
});

describe('loadDated', () => {
  it('hors ligne sans copie : rien n’est lu, l’état le dit (pas d’erreur)', async () => {
    const fetcher = vi.fn(async () => ['Upper A']);
    await expect(loadDated(KEY, fetcher, { offline: true })).resolves.toEqual({ phase: 'offline' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('hors ligne avec une copie : la copie et sa date, sans lecture', async () => {
    await loadDated(KEY, async () => ['Upper A'], { offline: false, now: () => 1000 });
    const fetcher = vi.fn(async () => ['Upper B']);
    const state = await loadDated(KEY, fetcher, { offline: true });
    expect(state).toEqual({ phase: 'ready', value: ['Upper A'], at: 1000, copy: true });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('en ligne, premier passage : la lecture réseau, datée, et semée pour la suite', async () => {
    const state = await loadDated(KEY, async () => ['Upper A'], { offline: false, now: () => 5000 });
    expect(state).toEqual({ phase: 'ready', value: ['Upper A'], at: 5000, copy: false });
    expect(peekDated(KEY)).toEqual({ at: 5000, value: ['Upper A'] });
  });

  it('en ligne avec une copie : la copie tout de suite, puis la revalidation prévient l’écran', async () => {
    let t = 1000;
    const now = () => t;
    await loadDated(KEY, async () => ['Upper A'], { offline: false, now });
    t = 2000;
    const seen: DatedState<string[]>[] = [];
    const stop = watchDated<string[]>(KEY, (s) => seen.push(s));
    const state = await loadDated(KEY, async () => ['Upper A', 'Upper B'], { offline: false, now });
    expect(state).toEqual({ phase: 'ready', value: ['Upper A'], at: 1000, copy: true });
    await settle();
    expect(seen).toEqual([{ phase: 'ready', value: ['Upper A', 'Upper B'], at: 2000, copy: false }]);
    stop();
  });

  it('après une écriture faite d’ici, la lecture suivante passe par le réseau, pas par la copie d’avant', async () => {
    await loadDated(KEY, async () => ['Upper A'], { offline: false, now: () => 1000 });
    invalidateViews();
    const state = await loadDated(KEY, async () => ['Upper A renommée'], { offline: false, now: () => 2000 });
    expect(state).toEqual({ phase: 'ready', value: ['Upper A renommée'], at: 2000, copy: false });
  });

  it('copie périmée et réseau en échec : la copie sert de secours', async () => {
    await loadDated(KEY, async () => ['Upper A'], { offline: false, now: () => 1000 });
    invalidateViews();
    const state = await loadDated(KEY, () => Promise.reject(new Error('Connexion impossible.')), { offline: false, now: () => 2000 });
    expect(state).toEqual({ phase: 'ready', value: ['Upper A'], at: 1000, copy: true });
  });

  it('hors ligne, même une copie périmée se montre (avec sa date)', async () => {
    await loadDated(KEY, async () => ['Upper A'], { offline: false, now: () => 1000 });
    invalidateViews();
    await expect(loadDated(KEY, async () => ['x'], { offline: true })).resolves.toMatchObject({ phase: 'ready', copy: true, at: 1000 });
  });

  it('en ligne sans copie et réseau en échec : une erreur, en français', async () => {
    const state = await loadDated(KEY, () => Promise.reject(new Error('Connexion impossible.')), { offline: false });
    expect(state.phase).toBe('error');
  });

  it('la vue suivie ne réagit qu’à sa propre clé', async () => {
    const seen: unknown[] = [];
    const stop = watchDated(KEY, (s) => seen.push(s));
    await loadDated(`${VIEW_PREFIX}journal`, async () => [1], { offline: false });
    expect(seen).toEqual([]);
    stop();
  });
});
