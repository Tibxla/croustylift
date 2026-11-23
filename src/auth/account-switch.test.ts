// Arrivée d'un compte sur l'appareil (audit sécurité, constat 3) : les copies de
// lecture et l'état de capture d'un AUTRE compte ne restent pas en clair, sauf
// s'il a encore des écritures retenues (la garde d'ADR 0012 prime alors).
import { describe, it, expect, beforeEach } from 'vitest';
import { recognizeAccount } from './account-switch';
import { loadLocalAccount, saveLocalAccount } from '../lib/local-account';
import { cachedRead, clearReadCache, revalidateReadCache } from '../lib/read-cache';
import { clearQueue, enqueue } from '../features/capture/outbox';

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

const compteA = { userId: 'user-a', email: 'a@exemple.com' };
const compteB = { userId: 'user-b', email: 'b@exemple.com' };
const COPIE_A = 'croustylift:readcache:user-a:routines';
const CAPTURE_A = 'croustylift:capture:seance-1:2026-11-20';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(async () => {
  (globalThis as unknown as { localStorage: Storage }).localStorage =
    new MemoryStorage() as unknown as Storage;
  clearReadCache();
  clearQueue();
  // Le compte A a utilisé l'appareil : une copie de lecture, une capture en cours.
  saveLocalAccount(compteA);
  await cachedRead('routines', async () => ['routine de A']);
  localStorage.setItem(CAPTURE_A, JSON.stringify({ sessionId: 'seance-1', ownerId: 'user-a' }));
});

describe('recognizeAccount', () => {
  it('un autre compte arrive, file vide : copies de lecture et capture de l’ancien purgées', () => {
    recognizeAccount(compteB);

    expect(localStorage.getItem(COPIE_A)).toBeNull();
    expect(localStorage.getItem(CAPTURE_A)).toBeNull();
    expect(loadLocalAccount()).toEqual(compteB);
  });

  it('le même compte revient (refresh, re-Connexion) : rien n’est purgé', () => {
    recognizeAccount({ ...compteA });

    expect(localStorage.getItem(COPIE_A)).not.toBeNull();
    expect(localStorage.getItem(CAPTURE_A)).not.toBeNull();
    expect(loadLocalAccount()).toEqual(compteA);
  });

  it('premier compte sur l’appareil : le marqueur est posé, rien à purger', () => {
    localStorage.removeItem('croustylift:account');

    recognizeAccount(compteB);

    expect(loadLocalAccount()).toEqual(compteB);
    expect(localStorage.getItem(COPIE_A)).not.toBeNull();
  });

  it('l’ancien compte a des écritures en attente : rien n’est purgé (la garde existante prime)', () => {
    enqueue({ type: 'deleteSet', id: 'set-1' });

    recognizeAccount(compteB);

    expect(localStorage.getItem(COPIE_A)).not.toBeNull();
    expect(localStorage.getItem(CAPTURE_A)).not.toBeNull();
    expect(loadLocalAccount()).toEqual(compteB);
  });

  it('une lecture de l’ancien compte encore en vol ne ressème pas sa copie après la purge', async () => {
    let repondre: (value: string[]) => void = () => {};
    const lente = new Promise<string[]>((resolve) => {
      repondre = resolve;
    });
    // Copie présente : la revalidation de fond part et reste en vol.
    await cachedRead('routines', () => lente);

    recognizeAccount(compteB);
    repondre(['routine de A, relue']);
    await settle();

    expect(localStorage.getItem(COPIE_A)).toBeNull();
    expect(localStorage.getItem('croustylift:readcache:user-b:routines')).toBeNull();
  });

  it('le registre de revalidation de l’ancien compte est vidé : plus aucune relecture sous ses clés', async () => {
    let lectures = 0;
    await cachedRead('seances', async () => {
      lectures += 1;
      return ['séance de A'];
    });
    await settle();
    const avant = lectures;

    recognizeAccount(compteB);
    revalidateReadCache();
    await settle();

    expect(lectures).toBe(avant);
    expect(localStorage.getItem('croustylift:readcache:user-a:seances')).toBeNull();
  });
});
