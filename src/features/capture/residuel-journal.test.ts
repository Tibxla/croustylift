// RÉSIDUEL 5 du moteur de la Salle : l'éditeur de séance passée (Journal) ne
// doit pas annoncer une sauvegarde quand son écriture a été refusée puis écartée
// au profit d'une remplaçante qui, elle, attend encore.
//
// D'abord écrit ROUGE sur le code d'avant le registre d'écritures (`it.fails`),
// où `flushOps` recomptait ses ops en file et en quarantaine : une écriture
// refusée puis écartée n'était plus ni dans l'une ni dans l'autre, donc
// « sauvegardée ». Le registre rend le sort de chaque écriture, remplaçante
// comprise.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { OutboxOp } from './outbox';

// La couche Supabase est remplacée : `upsertSet` refuse une valeur hors borne,
// puis tombe hors ligne.
const { upsertSet } = vi.hoisted(() => ({ upsertSet: vi.fn() }));
vi.mock('./data', () => ({
  deleteExecutionById: vi.fn(),
  deleteExecutionIfEmpty: vi.fn(),
  deleteSetById: vi.fn(),
  patchSet: vi.fn(),
  exercisesHoldingRows: vi.fn(() => []),
  refreshExerciseRows: vi.fn(async () => undefined),
  updateExecution: vi.fn(),
  upsertExecution: vi.fn(),
  upsertSet,
}));
vi.mock('../notes/data', () => ({
  upsertDatedNote: vi.fn(),
  deleteDatedNoteById: vi.fn(),
  deleteDatedNoteByCouple: vi.fn(),
  upsertExerciseNoteRow: vi.fn(),
  deleteExerciseNoteByExercise: vi.fn(),
}));
vi.mock('../../lib/session-identity', () => ({ sessionUserId: async () => 'user-1' }));

import { flushOps } from './sync';
import { enqueue } from './outbox';
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

beforeEach(() => {
  (globalThis as unknown as { localStorage: Storage }).localStorage =
    new MemoryStorage() as unknown as Storage;
  saveLocalAccount({ userId: 'user-1', email: 'test@example.com' });
  upsertSet.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const rewrite = (weightKg: number): OutboxOp => ({
  type: 'insertSet',
  id: 'S1',
  executionId: 'exec-passee',
  exerciseId: 'bench',
  setOrder: 1,
  weightKg,
  reps: 8,
  rir: 2,
});

describe('résiduel 5 : une écriture refusée puis remplacée n’est pas une sauvegarde', () => {
  it.fails('l’éditeur de séance passée apprend que sa correction attend encore', async () => {
    // La base refuse 9999 kg (borne), puis le réseau tombe.
    upsertSet.mockImplementation(async (row: { weightKg: number }) => {
      if (row.weightKg === 9999) throw Object.assign(new Error('check'), { code: '23514' });
      throw new Error('Failed to fetch');
    });
    // Une réécriture de la même série attend déjà derrière (saisie plus récente,
    // faite en Salle ou dans un autre onglet) : enfilée pendant que la nôtre part.
    let queuedBehind = false;
    upsertSet.mockImplementationOnce(async () => {
      if (!queuedBehind) {
        queuedBehind = true;
        enqueue(rewrite(82.5));
      }
      throw Object.assign(new Error('check'), { code: '23514' });
    });

    const result = await flushOps([rewrite(9999)]);

    // Notre écriture a été refusée, et sa remplaçante n'est pas en base : rien
    // de ce que l'éditeur a soumis n'est sauvegardé.
    expect(result.remaining).toBeGreaterThan(0);
  });
});
