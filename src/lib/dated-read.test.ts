// Lectures d'écran au calme servies depuis une copie datée (UX 7).
//
// Env node : localStorage mémoire réinitialisé avant chaque test, aucun réseau
// (fetchers en vi.fn). On vérifie : hors ligne rien n'est lancé ; la copie sert
// avec sa date ; la revalidation prévient l'écran ; une écriture faite d'ici
// fait relire le réseau au lieu de resservir la copie d'avant.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cachedRead, clearReadCache, revalidateReadCache } from './read-cache';
import { saveLocalAccount } from './local-account';
import { invalidateViews, loadDated, peekDated, ROUTINES_VIEW, SEANCES_VIEWS, VIEW_PREFIX, watchDated, type DatedState } from './dated-read';

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
const KEY = ROUTINES_VIEW;
const ANALYSE = `${VIEW_PREFIX}analyse`;

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
    invalidateViews(SEANCES_VIEWS);
    const state = await loadDated(KEY, async () => ['Upper A renommée'], { offline: false, now: () => 2000 });
    expect(state).toEqual({ phase: 'ready', value: ['Upper A renommée'], at: 2000, copy: false });
  });

  it('copie périmée et réseau en échec : la copie sert de secours', async () => {
    await loadDated(KEY, async () => ['Upper A'], { offline: false, now: () => 1000 });
    invalidateViews(SEANCES_VIEWS);
    const state = await loadDated(KEY, () => Promise.reject(new Error('Connexion impossible.')), { offline: false, now: () => 2000 });
    expect(state).toEqual({ phase: 'ready', value: ['Upper A'], at: 1000, copy: true });
  });

  it('hors ligne, même une copie périmée se montre (avec sa date)', async () => {
    await loadDated(KEY, async () => ['Upper A'], { offline: false, now: () => 1000 });
    invalidateViews(SEANCES_VIEWS);
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

describe('stockage plein', () => {
  it('la revalidation qui ne peut pas s’écrire est quand même livrée à l’écran', async () => {
    let t = 1000;
    const now = () => t;
    // Une ancienne copie du Journal, puis le stockage se remplit.
    await loadDated(KEY, async () => ['séance supprimée ailleurs'], { offline: false, now });
    const storage = localStorage as unknown as MemoryStorage;
    const full = vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    t = 2000;
    const seen: DatedState<string[]>[] = [];
    const stop = watchDated<string[]>(KEY, (s) => seen.push(s));
    const state = await loadDated(KEY, async () => ['séance récente'], { offline: false, now });
    expect(state).toMatchObject({ copy: true, value: ['séance supprimée ailleurs'] });
    await settle();
    expect(seen).toEqual([{ phase: 'ready', value: ['séance récente'], at: 2000, copy: false }]);
    // La copie, elle, n'a pas pu changer.
    expect(peekDated(KEY)).toEqual({ at: 1000, value: ['séance supprimée ailleurs'] });
    stop();
    full.mockRestore();
  });
});

describe('copies d’écran et flush de la file', () => {
  it('un flush ne relit aucune copie d’écran ; l’ouverture de l’Analyse, si (copie d’abord)', async () => {
    const analyse = vi.fn(async () => ['courbes']);
    const capture = vi.fn(async () => 'routine courante');
    await loadDated(ANALYSE, analyse, { offline: false });
    await cachedRead('capture-source', capture);
    expect(analyse).toHaveBeenCalledTimes(1);

    // Ce que fait l'app après chaque flush réussi (App.tsx).
    revalidateReadCache();
    await settle();
    expect(capture).toHaveBeenCalledTimes(2);
    expect(analyse).toHaveBeenCalledTimes(1);

    // Ouverture de l'Analyse : la copie s'affiche aussitôt, puis une relecture.
    const state = await loadDated(ANALYSE, analyse, { offline: false });
    expect(state).toMatchObject({ phase: 'ready', copy: true, value: ['courbes'] });
    await settle();
    expect(analyse).toHaveBeenCalledTimes(2);
  });

  it('une écriture du plan ne périme que les copies de Séances, pas celles de l’Analyse', async () => {
    await loadDated(ANALYSE, async () => ['avant'], { offline: false, now: () => 1000 });
    await loadDated(`${VIEW_PREFIX}routine:r1`, async () => ['avant'], { offline: false, now: () => 1000 });
    invalidateViews(SEANCES_VIEWS);
    const analyse = await loadDated(ANALYSE, async () => ['après'], { offline: false, now: () => 2000 });
    expect(analyse).toMatchObject({ value: ['avant'], copy: true });
    const routine = await loadDated(`${VIEW_PREFIX}routine:r1`, async () => ['après'], { offline: false, now: () => 2000 });
    expect(routine).toMatchObject({ value: ['après'], copy: false });
  });
});
