// Tests des préférences d'affichage locales (courbes masquées par exo).
//
// Env node : pas de localStorage natif → polyfill mémoire réinitialisé avant
// chaque test (même approche que local-account.test.ts).
import { beforeEach, describe, expect, it } from 'vitest';
import { saveLocalAccount } from './local-account';
import { clearLocalPrefs, loadHiddenCurves, saveHiddenCurves } from './local-prefs';

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

beforeEach(() => {
  (globalThis as unknown as { localStorage: Storage }).localStorage =
    new MemoryStorage() as unknown as Storage;
});

describe('courbes masquées', () => {
  it('fait l’aller-retour par exo, pour le compte reconnu', () => {
    saveLocalAccount({ userId: 'u1', email: null });
    saveHiddenCurves('bench', ['s-push']);
    saveHiddenCurves('squat', ['s-legs', 's-full']);
    expect(loadHiddenCurves('bench')).toEqual(['s-push']);
    expect(loadHiddenCurves('squat')).toEqual(['s-legs', 's-full']);
  });

  it('rien de masqué par défaut', () => {
    saveLocalAccount({ userId: 'u1', email: null });
    expect(loadHiddenCurves('bench')).toEqual([]);
  });

  it('un autre compte sur le même appareil ne voit pas les préférences du premier', () => {
    saveLocalAccount({ userId: 'u1', email: null });
    saveHiddenCurves('bench', ['s-push']);
    saveLocalAccount({ userId: 'u2', email: null });
    expect(loadHiddenCurves('bench')).toEqual([]);
  });

  it('sans compte reconnu : rien n’est lu ni écrit', () => {
    saveHiddenCurves('bench', ['s-push']);
    expect(loadHiddenCurves('bench')).toEqual([]);
    expect(localStorage.length).toBe(0);
  });

  it('une entrée illisible vaut « rien de masqué »', () => {
    saveLocalAccount({ userId: 'u1', email: null });
    localStorage.setItem('croustylift:prefs:u1:hidden-curves:bench', '{pas du json');
    expect(loadHiddenCurves('bench')).toEqual([]);
  });

  it('clearLocalPrefs purge les préférences de tous les comptes, rien d’autre', () => {
    saveLocalAccount({ userId: 'u1', email: null });
    saveHiddenCurves('bench', ['s-push']);
    localStorage.setItem('croustylift:readcache:u1:x', '{}');
    clearLocalPrefs();
    expect(loadHiddenCurves('bench')).toEqual([]);
    expect(localStorage.getItem('croustylift:readcache:u1:x')).toBe('{}');
    expect(localStorage.getItem('croustylift:account')).not.toBeNull();
  });
});
