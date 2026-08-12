// Tests du marqueur d'identité local (ADR 0012).
//
// Env node : pas de localStorage natif → polyfill mémoire réinitialisé avant
// chaque test (même approche que outbox.test.ts).
import { describe, it, expect, beforeEach } from 'vitest';
import { clearLocalAccount, loadLocalAccount, saveLocalAccount } from './local-account';

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

describe('local-account', () => {
  it('fait l’aller-retour save → load', () => {
    saveLocalAccount({ userId: 'user-1', email: 'toi@exemple.com' });
    expect(loadLocalAccount()).toEqual({ userId: 'user-1', email: 'toi@exemple.com' });
  });

  it('accepte un email null (compte sans email)', () => {
    saveLocalAccount({ userId: 'user-1', email: null });
    expect(loadLocalAccount()).toEqual({ userId: 'user-1', email: null });
  });

  it('rend null quand aucun marqueur n’est posé', () => {
    expect(loadLocalAccount()).toBeNull();
  });

  it('rend null sur un blob illisible ou de forme inattendue', () => {
    localStorage.setItem('croustylift:account', '{pas du json');
    expect(loadLocalAccount()).toBeNull();
    localStorage.setItem('croustylift:account', JSON.stringify({ email: 'sans-user-id' }));
    expect(loadLocalAccount()).toBeNull();
  });

  it('clearLocalAccount retire le marqueur', () => {
    saveLocalAccount({ userId: 'user-1', email: null });
    clearLocalAccount();
    expect(loadLocalAccount()).toBeNull();
  });
});
