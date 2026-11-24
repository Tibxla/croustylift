// Note d'instructions éditée en Capture (audit sync, constat 10).
//
// Le bug : la note corrigée partait bien en file, mais la copie locale gardait
// l'ancien texte. Au remontage (changement d'onglet, reload) la Capture
// réaffichait l'ancienne version, et la retaper à partir d'elle écrasait la
// correction. On pilote la vraie lecture, la vraie file et les vraies fonctions
// de sync ; seul le réseau est bouchonné.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const server = vi.hoisted(() => ({
  online: true,
  note: null as string | null,
  /** Lectures retenues : résolues à la main pour rejouer une réponse tardive. */
  held: [] as (() => void)[],
  hold: false,
}));

vi.mock('../../lib/supabase', () => {
  const failure = { data: null, error: new TypeError('Failed to fetch') };
  const from = (table: string) => {
    if (table !== 'exercise_notes') throw new Error(`table inattendue dans ce test : ${table}`);
    const read = {
      select: () => read,
      eq: () => read,
      maybeSingle: () => {
        if (!server.online) return Promise.resolve(failure);
        // La réponse est figée au départ de la lecture, comme sur un vrai réseau.
        const answer = { data: server.note === null ? null : { body: server.note }, error: null };
        if (!server.hold) return Promise.resolve(answer);
        return new Promise((resolve) => server.held.push(() => resolve(answer)));
      },
    };
    return {
      ...read,
      upsert: (row: { body: string }) => {
        if (!server.online) return Promise.resolve(failure);
        server.note = row.body;
        return Promise.resolve({ error: null });
      },
      delete: () => ({
        eq: () => ({
          select: () => {
            if (!server.online) return Promise.resolve(failure);
            const touched = server.note === null ? [] : [{ exercise_id: 'exo-1' }];
            server.note = null;
            return Promise.resolve({ data: touched, error: null });
          },
        }),
      }),
    };
  };
  return { supabase: { from } };
});

import { loadExerciseNoteCached, pendingExerciseNote } from './data';
import { clearQueue, enqueue, flush, readQueue } from './outbox';
import { syncFns } from './sync';
import { exerciseNoteOutboxOp } from '../notes/data';
import { clearReadCache } from '../../lib/read-cache';
import { saveLocalAccount } from '../../lib/local-account';
import { setSessionUserReader } from '../../lib/session-identity';

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

const EXO = 'exo-1';
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const edit = (body: string) => enqueue(exerciseNoteOutboxOp({ exerciseId: EXO, body }));

beforeEach(async () => {
  (globalThis as unknown as { localStorage: Storage }).localStorage =
    new MemoryStorage() as unknown as Storage;
  clearReadCache();
  clearQueue();
  setSessionUserReader(null);
  saveLocalAccount({ userId: 'user-a', email: 'a@exemple.com' });
  server.online = true;
  server.hold = false;
  server.held = [];
  server.note = 'Coudes serrés';
  // La Capture a déjà été ouverte : la copie locale porte la note d'origine.
  await loadExerciseNoteCached(EXO);
  await settle();
});

describe('pendingExerciseNote', () => {
  it('rend le corps de la dernière op de la file pour cet exo', () => {
    edit('Version 1');
    edit('Version 2');
    enqueue(exerciseNoteOutboxOp({ exerciseId: 'autre-exo', body: 'Sans rapport' }));
    expect(pendingExerciseNote(readQueue(), EXO)).toBe('Version 2');
  });

  it('une note vidée en attente vaut le corps vide', () => {
    edit('Version 1');
    edit('   ');
    expect(pendingExerciseNote(readQueue(), EXO)).toBe('');
  });

  it('aucune op pour cet exo : null', () => {
    expect(pendingExerciseNote(readQueue(), EXO)).toBeNull();
  });
});

describe('note d’instructions éditée en Capture', () => {
  it('hors ligne, la note corrigée ne revient pas à l’ancienne au remontage', async () => {
    server.online = false;
    edit('Coudes serrés, pause en bas');

    expect(await loadExerciseNoteCached(EXO)).toBe('Coudes serrés, pause en bas');
  });

  it('en ligne mais pas encore envoyée : la correction prime sur la copie et sur la base', async () => {
    edit('Coudes serrés, pause en bas');

    expect(await loadExerciseNoteCached(EXO)).toBe('Coudes serrés, pause en bas');
    await settle();
    // La revalidation de fond a relu l'ancienne note en base : la file prime encore.
    expect(await loadExerciseNoteCached(EXO)).toBe('Coudes serrés, pause en bas');
  });

  it('une fois acquittée puis hors ligne : la copie porte la correction', async () => {
    edit('Coudes serrés, pause en bas');
    await flush(syncFns);
    expect(readQueue()).toEqual([]);
    server.online = false;

    expect(await loadExerciseNoteCached(EXO)).toBe('Coudes serrés, pause en bas');
  });

  it('une revalidation partie avant l’acquittement ne remet pas l’ancienne note', async () => {
    edit('Coudes serrés, pause en bas');
    // Remontage : la copie est servie, sa revalidation part et reste en vol.
    server.hold = true;
    await loadExerciseNoteCached(EXO);
    expect(server.held).toHaveLength(1);
    server.hold = false;
    // L'écriture est acquittée, puis la réponse ancienne arrive.
    await flush(syncFns);
    server.held[0]!();
    await settle();
    server.online = false;

    expect(await loadExerciseNoteCached(EXO)).toBe('Coudes serrés, pause en bas');
  });

  it('une note vidée et acquittée reste vide', async () => {
    edit('');
    await flush(syncFns);
    server.online = false;

    expect(await loadExerciseNoteCached(EXO)).toBe('');
  });

  it('sans copie ni réseau, la note en attente est tout de même lue', async () => {
    clearReadCache();
    server.online = false;
    edit('Écrite hors ligne');

    expect(await loadExerciseNoteCached(EXO)).toBe('Écrite hors ligne');
  });

  it('sans copie, sans réseau et sans édition en attente : la lecture échoue (pas de note vide éditable)', async () => {
    clearReadCache();
    server.online = false;

    await expect(loadExerciseNoteCached(EXO)).rejects.toThrow();
  });

  it('la copie n’est pas écrite sous un autre compte que celui qui a écrit', async () => {
    edit('Note du compte A');
    // La session sous laquelle part l'écriture n'est pas le compte reconnu.
    setSessionUserReader(async () => 'user-b');
    await syncFns.upsertExerciseNote({ type: 'upsertExerciseNote', id: EXO, body: 'Note de B' });
    clearQueue();
    server.online = false;

    expect(await loadExerciseNoteCached(EXO)).toBe('Coudes serrés');
  });
});
