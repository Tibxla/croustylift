// Tests unitaires de l'OUTBOX (file d'écritures offline).
//
// Env node : pas de localStorage natif → on installe un polyfill mémoire avant
// chaque test (reset systématique). AUCUN vrai Supabase : les `SyncFns` sont
// mockées (vi.fn), on observe ce qui est appelé, dans quel ordre, et ce qui
// reste en file après échec.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  enqueue,
  flush,
  readQueue,
  pendingCount,
  clearQueue,
  type SyncFns,
  type OutboxOp,
  type InsertSetOp,
} from './outbox';

// --- Polyfill localStorage (mémoire) ----------------------------------------

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
}

beforeEach(() => {
  (globalThis as unknown as { localStorage: Storage }).localStorage =
    new MemoryStorage() as unknown as Storage;
});

// --- Fabriques d'ops --------------------------------------------------------

function execOp(id = 'exec-1'): OutboxOp {
  return { type: 'upsertExecution', id, seanceVersionId: 'ver-1', performedOn: '2026-06-18' };
}
function setOp(id: string, setOrder: number, executionId = 'exec-1'): InsertSetOp {
  return {
    type: 'insertSet',
    id,
    executionId,
    exerciseId: 'bench',
    setOrder,
    weightKg: 80,
    reps: 8,
    rir: 2,
  };
}

/** SyncFns toutes en succès, espionnées. */
function okFns(): SyncFns & { calls: () => OutboxOp[] } {
  const order: OutboxOp[] = [];
  const upsertExecution = vi.fn(async (op) => void order.push(op));
  const insertSet = vi.fn(async (op) => void order.push(op));
  const deleteSet = vi.fn(async (op) => void order.push(op));
  const updateExecution = vi.fn(async (op) => void order.push(op));
  const upsertDatedNote = vi.fn(async (op) => void order.push(op));
  const deleteDatedNote = vi.fn(async (op) => void order.push(op));
  const deleteExecution = vi.fn(async (op) => void order.push(op));
  return {
    upsertExecution,
    insertSet,
    deleteSet,
    updateExecution,
    upsertDatedNote,
    deleteDatedNote,
    deleteExecution,
    calls: () => order,
  };
}

// --- enqueue + persistance --------------------------------------------------

describe('enqueue', () => {
  it('ajoute l’op et la PERSISTE en localStorage', () => {
    enqueue(execOp());
    expect(pendingCount()).toBe(1);
    // Persistée : une relecture indépendante voit la même file.
    const persisted = readQueue();
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({ type: 'upsertExecution', id: 'exec-1' });
  });

  it('renvoie la nouvelle longueur et préserve l’ordre d’enfilement', () => {
    expect(enqueue(execOp())).toBe(1);
    expect(enqueue(setOp('s1', 1))).toBe(2);
    expect(enqueue(setOp('s2', 2))).toBe(3);
    expect(readQueue().map((o) => o.id)).toEqual(['exec-1', 's1', 's2']);
  });
});

// --- flush réussi -----------------------------------------------------------

describe('flush (succès)', () => {
  it('traite toutes les ops et VIDE la file', async () => {
    enqueue(execOp());
    enqueue(setOp('s1', 1));
    const fns = okFns();

    const res = await flush(fns);

    expect(res).toEqual({ remaining: 0, flushed: 2 });
    expect(pendingCount()).toBe(0);
    expect(readQueue()).toEqual([]);
  });

  it('appelle la bonne SyncFn par type d’op', async () => {
    enqueue(execOp());
    enqueue(setOp('s1', 1));
    enqueue({ type: 'deleteSet', id: 's1' });
    enqueue({ type: 'updateExecution', id: 'exec-1', bpmAvg: 130, durationMin: 52 });
    enqueue({
      type: 'upsertDatedNote',
      id: 'note-1',
      executionId: 'exec-1',
      exerciseId: 'bench',
      body: 'épaule un peu raide',
    });
    enqueue({ type: 'deleteDatedNote', id: 'note-1' });
    enqueue({ type: 'deleteExecution', id: 'exec-1' });
    const fns = okFns();

    await flush(fns);

    expect(fns.upsertExecution).toHaveBeenCalledTimes(1);
    expect(fns.insertSet).toHaveBeenCalledTimes(1);
    expect(fns.deleteSet).toHaveBeenCalledTimes(1);
    expect(fns.updateExecution).toHaveBeenCalledTimes(1);
    expect(fns.upsertDatedNote).toHaveBeenCalledTimes(1);
    expect(fns.deleteDatedNote).toHaveBeenCalledTimes(1);
    expect(fns.deleteExecution).toHaveBeenCalledTimes(1);
  });

  it('deleteExecution : routée vers la bonne SyncFn (id), puis RETIRÉE de la file', async () => {
    // Suppression d'une exécution entière (issue #44, ADR 0008) : un hard delete
    // par id, la cascade DB efface séries + notes côté Supabase. Ici on vérifie
    // juste le routage outbox -> deleteExecution et le retrait au flush réussi.
    enqueue({ type: 'deleteExecution', id: 'exec-42' });
    const fns = okFns();

    const res = await flush(fns);

    expect(fns.deleteExecution).toHaveBeenCalledTimes(1);
    expect((fns.deleteExecution as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      type: 'deleteExecution',
      id: 'exec-42',
    });
    // Aucune autre SyncFn n'est touchée par cette op.
    expect(fns.deleteSet).not.toHaveBeenCalled();
    // Flush réussi : l'op est retirée, la file est vide.
    expect(res).toEqual({ remaining: 0, flushed: 1 });
    expect(pendingCount()).toBe(0);
    expect(readQueue()).toEqual([]);
  });

  it('une note datée part APRÈS l’exécution dont elle dépend (FK)', async () => {
    enqueue(execOp());
    enqueue({
      type: 'upsertDatedNote',
      id: 'note-1',
      executionId: 'exec-1',
      exerciseId: 'bench',
      body: 'tempo lent',
    });
    const fns = okFns();

    await flush(fns);

    expect(fns.calls().map((o) => o.id)).toEqual(['exec-1', 'note-1']);
  });

  it('traite dans l’ORDRE : exécution AVANT ses séries (dépendance FK)', async () => {
    enqueue(execOp());
    enqueue(setOp('s1', 1));
    enqueue(setOp('s2', 2));
    const fns = okFns();

    await flush(fns);

    expect(fns.calls().map((o) => o.id)).toEqual(['exec-1', 's1', 's2']);
  });

  it('série unilatérale : le `side` survit au round-trip et est passé intact', async () => {
    // Une série unilatérale = 2 ops, même setOrder, side distinct (issue #46).
    const left: InsertSetOp = { ...setOp('l1', 1), side: 'left' };
    const right: InsertSetOp = { ...setOp('r1', 1), side: 'right' };
    enqueue(left);
    enqueue(right);

    // Persistées telles quelles (le `side` n'est pas perdu au passage localStorage).
    expect(readQueue()).toEqual([left, right]);

    const fns = okFns();
    await flush(fns);

    const inserts = fns.calls().filter((o): o is InsertSetOp => o.type === 'insertSet');
    expect(inserts.map((o) => o.side)).toEqual(['left', 'right']);
    expect(inserts.map((o) => o.setOrder)).toEqual([1, 1]);
  });
});

// --- flush qui échoue (offline) ---------------------------------------------

describe('flush (échec réseau)', () => {
  it('S’ARRÊTE à la 1ʳᵉ op qui échoue et GARDE le reste, dans l’ordre', async () => {
    enqueue(execOp());
    enqueue(setOp('s1', 1));
    enqueue(setOp('s2', 2));

    // L’exécution passe, le 1ᵉʳ insertSet échoue (réseau coupé) → on s’arrête.
    const fns = okFns();
    fns.insertSet = vi.fn().mockRejectedValueOnce(new Error('offline'));

    const res = await flush(fns);

    expect(res.flushed).toBe(1); // seule l’exécution est passée
    expect(res.remaining).toBe(2);
    // La file garde EXACTEMENT les deux séries non synchronisées, dans l’ordre.
    expect(readQueue().map((o) => o.id)).toEqual(['s1', 's2']);
    // On n’a PAS sauté la série en échec pour tenter la suivante.
    expect(fns.insertSet).toHaveBeenCalledTimes(1);
  });

  it('REJOUE le reste au flush suivant quand le réseau revient', async () => {
    enqueue(execOp());
    enqueue(setOp('s1', 1));
    enqueue(setOp('s2', 2));

    // 1ʳᵉ passe : insertSet échoue dès la 1ʳᵉ série.
    const failing = okFns();
    failing.insertSet = vi.fn().mockRejectedValue(new Error('offline'));
    await flush(failing);
    expect(readQueue().map((o) => o.id)).toEqual(['s1', 's2']);

    // 2ᵉ passe : réseau revenu, tout passe. La file se vide, dans l’ordre.
    const ok = okFns();
    const res = await flush(ok);

    expect(res).toEqual({ remaining: 0, flushed: 2 });
    expect(pendingCount()).toBe(0);
    expect(ok.calls().map((o) => o.id)).toEqual(['s1', 's2']);
  });

  it('ne touche pas la file si la TOUTE PREMIÈRE op échoue', async () => {
    enqueue(execOp());
    enqueue(setOp('s1', 1));

    const fns = okFns();
    fns.upsertExecution = vi.fn().mockRejectedValue(new Error('offline'));

    const res = await flush(fns);

    expect(res).toEqual({ remaining: 2, flushed: 0 });
    expect(readQueue().map((o) => o.id)).toEqual(['exec-1', 's1']);
  });
});

// --- Idempotence ------------------------------------------------------------

describe('idempotence', () => {
  it('une op flushée est RETIRÉE : un re-flush ne la rejoue pas', async () => {
    enqueue(execOp());
    enqueue(setOp('s1', 1));

    const first = okFns();
    await flush(first);
    expect(first.calls()).toHaveLength(2);

    // File vide : rien à rejouer, aucune SyncFn rappelée (pas d’effet de bord).
    const second = okFns();
    const res = await flush(second);
    expect(res).toEqual({ remaining: 0, flushed: 0 });
    expect(second.calls()).toHaveLength(0);
  });

  it('rejouer la MÊME op (même id) après un échec partiel ne la dédouble pas en file', async () => {
    enqueue(execOp());
    enqueue(setOp('s1', 1));

    // Échec sur la série : l’exécution part, la série reste.
    const fns = okFns();
    fns.insertSet = vi.fn().mockRejectedValueOnce(new Error('offline'));
    await flush(fns);
    expect(readQueue().map((o) => o.id)).toEqual(['s1']);

    // Re-flush OK : la série (même id 's1') passe une seule fois, file vidée.
    const ok = okFns();
    await flush(ok);
    expect(ok.insertSet).toHaveBeenCalledTimes(1);
    expect((ok.insertSet as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      id: 's1',
    });
    expect(pendingCount()).toBe(0);
  });
});

// --- Persistance / divers ---------------------------------------------------

describe('persistance', () => {
  it('survit à un « reload » : la file relue garde les ops non flushées', async () => {
    enqueue(execOp());
    enqueue(setOp('s1', 1));

    const fns = okFns();
    fns.insertSet = vi.fn().mockRejectedValue(new Error('offline'));
    await flush(fns);

    // Simule un nouveau « process » : on relit la file persistée à froid.
    const reloaded = readQueue();
    expect(reloaded.map((o) => o.id)).toEqual(['s1']);
  });

  it('clearQueue vide la file persistée', () => {
    enqueue(execOp());
    expect(pendingCount()).toBe(1);
    clearQueue();
    expect(pendingCount()).toBe(0);
    expect(readQueue()).toEqual([]);
  });
});
