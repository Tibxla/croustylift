// Tests du câblage outbox -> Supabase (sync.ts).
//
// On cible le BUG M4 : `flushOps` ne doit PAS se fier au `remaining` GLOBAL du
// FlushResult (qui peut être périmé quand un flush est déjà en vol), mais
// recompter SES propres ops (les ids qu'il a enfilés) encore présentes en file.
//
// Stratégie de mock :
//   - `./outbox` : on garde les vraies fonctions de file (enqueue/readQueue/
//     clearQueue, sur un polyfill localStorage mémoire) mais on REMPLACE `flush`
//     par un mock contrôlable — c'est lui qui simule une passe « menteuse » (un
//     flush en vol qui renvoie remaining: 0 sans avoir drainé NOS ops).
//   - `./data` et `../notes/data` : neutralisés (syncFns les référence à l'import,
//     on ne veut surtout pas toucher Supabase ici).
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import type { FlushResult, OutboxOp } from './outbox';

// --- Mocks de modules -------------------------------------------------------

// `flush` est remplacé par un mock ; le reste de l'outbox reste RÉEL (vraie file).
// `vi.hoisted` : le mock doit exister AVANT le hoisting de `vi.mock` (sinon
// ReferenceError, la factory s'exécute avant l'init du `const`).
const { flushMock } = vi.hoisted(() => ({
  flushMock: vi.fn<(...args: unknown[]) => Promise<FlushResult>>(),
}));
vi.mock('./outbox', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./outbox')>();
  return { ...actual, flush: flushMock };
});

// Les data-layers Supabase : neutralisés (jamais appelés dans ces tests, mais
// syncFns les capture à l'import → il faut des stubs présents).
vi.mock('./data', () => ({
  deleteExecutionById: vi.fn(),
  deleteSetById: vi.fn(),
  updateExecution: vi.fn(),
  upsertExecution: vi.fn(),
  upsertSet: vi.fn(),
}));
vi.mock('../notes/data', () => ({
  upsertDatedNote: vi.fn(),
  deleteDatedNoteById: vi.fn(),
  upsertExerciseNoteRow: vi.fn(),
  deleteExerciseNoteByExercise: vi.fn(),
}));

import { flushOps, syncFns } from './sync';
import { readQueue } from './outbox';
// `./data` est mocké plus haut : cet import récupère la vi.fn() pour asserter
// l'argument reçu par data.updateExecution (chaîne closed_at).
import { updateExecution } from './data';

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
  flushMock.mockReset();
});

// --- Fabriques d'ops --------------------------------------------------------

function execOp(id: string): OutboxOp {
  return { type: 'upsertExecution', id, seanceVersionId: 'ver-1', performedOn: '2026-06-18' };
}
function setOp(id: string, executionId: string): OutboxOp {
  return {
    type: 'insertSet',
    id,
    executionId,
    exerciseId: 'bench',
    setOrder: 1,
    weightKg: 80,
    reps: 8,
    rir: 2,
  };
}

// --- BUG M4 : remaining PROPRE, pas le remaining global ---------------------

describe('flushOps (remaining propre, BUG M4)', () => {
  it('enfile ses ops dans la file (durables avant le flush)', async () => {
    // flush « réussit » globalement et draine la file (cas nominal en ligne).
    (flushMock as Mock).mockImplementation(async () => {
      (globalThis.localStorage as Storage).removeItem('croustylift:outbox');
      return { remaining: 0, flushed: 2 };
    });

    const ops = [execOp('e1'), setOp('s1', 'e1')];
    const res = await flushOps(ops);

    expect(flushMock).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ remaining: 0, flushed: 2 });
  });

  it('NE renvoie PAS remaining: 0 quand un flush en vol n’a pas vu nos ops', async () => {
    // Cœur du bug : un flush déjà en vol renvoie SA promesse, dont le remaining
    // reflète l'état AVANT qu'on enfile nos ops. Ici il ment (remaining: 0) et NE
    // DRAINE PAS la file. flushOps doit recompter SES ids encore présents.
    (flushMock as Mock).mockResolvedValue({ remaining: 0, flushed: 5 });

    const ops = [execOp('e1'), setOp('s1', 'e1')];
    const res = await flushOps(ops);

    // Nos 2 ops dorment toujours en file → remaining PROPRE = 2 (pas 0).
    expect(res.remaining).toBe(2);
    // flushed reste celui de la passe (indicatif, best-effort).
    expect(res.flushed).toBe(5);
    // Les ops sont bien encore là, dans l'ordre.
    expect(readQueue().map((o) => o.id)).toEqual(['e1', 's1']);
  });

  it('ne compte QUE nos ops, pas celles d’une AUTRE exécution restée en file', async () => {
    // Une op d'une autre exécution est déjà en file (offline) et le flush n'en
    // draine aucune. flushOps ne doit compter QUE ses ids, pas l'op étrangère.
    (flushMock as Mock).mockImplementation(async () => {
      // Le flush ne retire rien (offline) ; il renvoie un remaining global de 3.
      return { remaining: 3, flushed: 0 };
    });
    // Pré-remplit la file avec une op d'une AUTRE exécution.
    const { enqueue } = await import('./outbox');
    enqueue(setOp('autre', 'exec-autre'));

    const ops = [execOp('e1'), setOp('s1', 'e1')];
    const res = await flushOps(ops);

    // remaining PROPRE = nos 2 ids (e1, s1), pas les 3 de la file globale.
    expect(res.remaining).toBe(2);
    expect(readQueue().map((o) => o.id)).toEqual(['autre', 'e1', 's1']);
  });

  it('chaîne closed_at : syncFns.updateExecution transmet closedAt à data (séance « rangée », jamais ressuscitée)', async () => {
    // Régression du bug « la séance clôturée réapparaît après refresh » : si une
    // couche (op -> syncFns -> data) LAISSE TOMBER closedAt, la clôture ne pose pas
    // `closed_at` en base et loadTodayExecution réhydrate la séance finie. Ce test
    // verrouille la traversée complète de closedAt (bpmAvg/durationMin inclus).
    (updateExecution as Mock).mockClear();

    await syncFns.updateExecution({
      type: 'updateExecution',
      id: 'exec-1',
      bpmAvg: 120,
      durationMin: 45,
      closedAt: '2026-06-19T18:00:00.000Z',
    });

    expect(updateExecution).toHaveBeenCalledWith({
      id: 'exec-1',
      bpmAvg: 120,
      durationMin: 45,
      closedAt: '2026-06-19T18:00:00.000Z',
    });
  });

  it('remaining propre = 0 quand le flush A bien drainé NOS ops (succès réel)', async () => {
    // Le flush draine effectivement nos ops : remaining propre tombe à 0 même si
    // une op étrangère reste (on ne la compte pas).
    const { enqueue } = await import('./outbox');
    enqueue(setOp('autre', 'exec-autre'));
    (flushMock as Mock).mockImplementation(async () => {
      // Simule un flush qui retire NOS ops (e1, s1) mais laisse l'op étrangère.
      const stayed = readQueue().filter((o) => o.id === 'autre');
      (globalThis.localStorage as Storage).setItem('croustylift:outbox', JSON.stringify(stayed));
      return { remaining: 1, flushed: 2 };
    });

    const res = await flushOps([execOp('e1'), setOp('s1', 'e1')]);

    // Aucune de NOS ops ne reste → remaining propre = 0 (succès vrai, l'éditeur
    // peut se fermer), même si la file globale n'est pas vide (op étrangère).
    expect(res.remaining).toBe(0);
    expect(readQueue().map((o) => o.id)).toEqual(['autre']);
  });
});
