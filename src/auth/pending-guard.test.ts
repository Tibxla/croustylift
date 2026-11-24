// Garde « écritures en attente d'un autre compte » de la Connexion (ADR 0012 ;
// audit sync, constat 12).
import { describe, it, expect, beforeEach } from 'vitest';
import { foreignPendingWrites } from './pending-guard';
import { saveLocalAccount } from '../lib/local-account';
import { enqueue, flush, type SyncFns } from '../features/capture/outbox';

class MemoryStorage {
  private store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  key(i: number): string | null {
    return [...this.store.keys()][i] ?? null;
  }
  getItem(k: string): string | null {
    return this.store.has(k) ? (this.store.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.store.set(k, String(v));
  }
  removeItem(k: string): void {
    this.store.delete(k);
  }
}

beforeEach(() => {
  (globalThis as unknown as { localStorage: Storage }).localStorage =
    new MemoryStorage() as unknown as Storage;
});

describe('foreignPendingWrites', () => {
  it('un autre compte par-dessus des saisies en attente : refus, avec leur nombre', () => {
    saveLocalAccount({ userId: 'user-a', email: 'a@exemple.com' });
    enqueue({ type: 'deleteSet', id: 'set-1' });
    enqueue({ type: 'deleteSet', id: 'set-2' });

    expect(foreignPendingWrites('b@exemple.com')).toBe(2);
  });

  it('le même compte (casse et espaces ignorés) passe', () => {
    saveLocalAccount({ userId: 'user-a', email: 'a@exemple.com' });
    enqueue({ type: 'deleteSet', id: 'set-1' });

    expect(foreignPendingWrites('  A@Exemple.com ')).toBe(0);
  });

  it('file vide : n’importe quel compte passe', () => {
    saveLocalAccount({ userId: 'user-a', email: 'a@exemple.com' });

    expect(foreignPendingWrites('b@exemple.com')).toBe(0);
  });

  it('aucun compte reconnu sur l’appareil : rien ne s’y oppose', () => {
    expect(foreignPendingWrites('b@exemple.com')).toBe(0);
  });

  it('une op en quarantaine compte aussi : elle ne se perd pas sans geste explicite', async () => {
    saveLocalAccount({ userId: 'user-a', email: 'a@exemple.com' });
    enqueue({ type: 'deleteSet', id: 'set-1' });
    // La base refuse l'op (contrainte) : elle quitte la file pour la quarantaine.
    const fns = {
      deleteSet: async () => {
        throw { code: '23503', message: 'rejet' };
      },
    } as unknown as SyncFns;
    await flush(fns);

    expect(foreignPendingWrites('b@exemple.com')).toBe(1);
  });

  it('compte reconnu sans adresse connue : dans le doute, refus', () => {
    saveLocalAccount({ userId: 'user-a', email: null });
    enqueue({ type: 'deleteSet', id: 'set-1' });

    expect(foreignPendingWrites('b@exemple.com')).toBe(1);
  });
});
