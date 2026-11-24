// Tests du câblage registre d'écritures -> Supabase (sync.ts).
//
// On cible le BUG M4 : `flushOps` ne doit PAS se fier au `remaining` GLOBAL de la
// passe (qui peut dater d'avant l'enfilement de nos ops, quand un flush est déjà
// en vol), mais rendre le SORT de ses propres écritures.
//
// Stratégie de mock : le registre et sa passe d'envoi sont RÉELS ; seule la
// couche Supabase est remplacée (`./data`, `../notes/data`), pour décider de ce
// que la base accepte, refuse, ou laisse sans réponse.
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import type { OutboxOp } from './outbox';

// --- Mocks de modules -------------------------------------------------------

vi.mock('./data', () => ({
  deleteExecutionById: vi.fn(),
  deleteExecutionIfEmpty: vi.fn(),
  deleteSetById: vi.fn(),
  patchSet: vi.fn(),
  exercisesHoldingRows: vi.fn(() => []),
  refreshExerciseRows: vi.fn(async () => undefined),
  updateExecution: vi.fn(),
  upsertExecution: vi.fn(),
  upsertSet: vi.fn(),
}));
vi.mock('../notes/data', () => ({
  upsertDatedNote: vi.fn(),
  deleteDatedNoteById: vi.fn(),
  deleteDatedNoteByCouple: vi.fn(),
  upsertExerciseNoteRow: vi.fn(),
  deleteExerciseNoteByExercise: vi.fn(),
}));
vi.mock('../../lib/session-identity', () => ({ sessionUserId: async () => 'user-1' }));

import { flushOps, flushOutbox, syncFns } from './sync';
import { enqueue, listRefused, purgeByExecution, readQueue } from './outbox';
// `./data` est mocké plus haut : ces imports récupèrent les vi.fn().
import { refreshExerciseRows, updateExecution, upsertExecution, upsertSet } from './data';
import { deleteDatedNoteByCouple, deleteDatedNoteById } from '../notes/data';
import { saveLocalAccount } from '../../lib/local-account';

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
  saveLocalAccount({ userId: 'user-1', email: 'toi@exemple.com' });
  for (const fn of [upsertExecution, upsertSet, refreshExerciseRows] as Mock[]) {
    fn.mockReset();
    fn.mockResolvedValue(undefined);
  }
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const offline = () => Promise.reject(new TypeError('Failed to fetch'));
const refusal = (code = '23503') => Promise.reject(Object.assign(new Error('rejet'), { code }));

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

// --- BUG M4 : le sort de NOS écritures, pas le remaining global ----------------

describe('flushOps (le sort de ses propres écritures, BUG M4)', () => {
  it('enfile ses ops (durables avant l’envoi), et rend 0 quand la base les a toutes', async () => {
    const res = await flushOps([execOp('e1'), setOp('s1', 'e1')]);

    expect(res).toMatchObject({ remaining: 0, pending: 0, refused: 0, flushed: 2 });
    expect(upsertSet).toHaveBeenCalledTimes(1);
  });

  it('NE rend PAS remaining: 0 quand la passe en vol s’est arrêtée avant nos ops', async () => {
    // Cœur du bug : un flush déjà en vol rend SA promesse. Ici il s'arrête sur une
    // écriture d'avant (hors ligne) : son résultat ne dit rien de nos ops.
    enqueue(execOp('avant'));
    let fail!: (err: unknown) => void;
    (upsertExecution as Mock).mockImplementationOnce(() => new Promise((_resolve, reject) => (fail = reject)));
    const inFlight = flushOutbox();
    await vi.waitFor(() => expect(typeof fail).toBe('function'));

    const ours = flushOps([execOp('e1'), setOp('s1', 'e1')]);
    fail(new TypeError('Failed to fetch'));
    const res = await ours;
    await inFlight;

    // Nos 2 ops attendent toujours : remaining PROPRE = 2.
    expect(res).toMatchObject({ remaining: 2, pending: 2, refused: 0 });
    expect(readQueue().map((o) => o.id)).toEqual(['avant', 'e1', 's1']);
  });

  it('une de nos ops REFUSÉE par la base n’est pas un succès : elle compte dans remaining', async () => {
    (upsertSet as Mock).mockImplementation(() => refusal());

    const res = await flushOps([execOp('e1'), setOp('s1', 'e1')]);

    expect(res.remaining).toBe(1);
    // Refusée, pas en attente : l'écran ne doit pas dire « pas de réseau ».
    expect(res).toMatchObject({ pending: 0, refused: 1 });
  });

  it('une de nos ops qui attend encore est « en attente », pas « refusée »', async () => {
    (upsertExecution as Mock).mockImplementation(offline);

    const res = await flushOps([execOp('e1'), setOp('s1', 'e1')]);

    expect(res).toMatchObject({ remaining: 2, pending: 2, refused: 0 });
  });

  it('une op retenue par le refus de sa séance compte comme refusée', async () => {
    (upsertExecution as Mock).mockImplementation(() => refusal());

    const res = await flushOps([execOp('e1'), setOp('s1', 'e1')]);

    expect(res).toMatchObject({ remaining: 2, pending: 0, refused: 2 });
  });

  it('un autre refus réglé pendant la passe ne cache pas notre op refusée', async () => {
    // Une saisie refusée plus tôt, d'une autre séance, est déjà mise de côté.
    (upsertSet as Mock).mockImplementationOnce(() => refusal('23514'));
    await flushOps([setOp('ancienne', 'autre-exec')]);
    expect(listRefused()).toHaveLength(1);
    // Pendant notre passe, cette séance est annulée : son refus disparaît, et le
    // nôtre devient le seul de la liste.
    (upsertSet as Mock).mockImplementationOnce(() => {
      purgeByExecution('autre-exec');
      return refusal();
    });

    const res = await flushOps([setOp('s1', 'e1')]);

    // Repérée par position dans la liste des refus, notre op refusée passait
    // pour une sauvegarde réussie. Elle se retrouve par son identité.
    expect(res).toMatchObject({ remaining: 1, pending: 0, refused: 1 });
  });

  it('ne compte QUE nos ops, pas celles d’un autre compte restées sur l’appareil', async () => {
    saveLocalAccount({ userId: 'user-2', email: 'autre@exemple.com' });
    enqueue(setOp('autre', 'exec-autre'));
    saveLocalAccount({ userId: 'user-1', email: 'toi@exemple.com' });

    const res = await flushOps([execOp('e1'), setOp('s1', 'e1')]);

    // Aucune de NOS ops ne reste : succès vrai, l'éditeur peut se fermer, même
    // si le registre n'est pas vide.
    expect(res).toMatchObject({ remaining: 0, pending: 0, refused: 0 });
    expect(readQueue().map((o) => o.id)).toEqual(['autre']);
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

});

describe('syncFns.deleteDatedNote', () => {
  it('efface par COUPLE quand l’op le porte : une note née sous un autre id part aussi', async () => {
    await syncFns.deleteDatedNote({
      type: 'deleteDatedNote',
      id: 'note-deterministe',
      executionId: 'exec-1',
      exerciseId: 'bench',
    });
    expect(deleteDatedNoteByCouple).toHaveBeenCalledWith('exec-1', 'bench');
    expect(deleteDatedNoteById).not.toHaveBeenCalled();
  });

  it('op d’un bundle antérieur, sans couple : efface par id comme avant', async () => {
    vi.mocked(deleteDatedNoteByCouple).mockClear();
    await syncFns.deleteDatedNote({ type: 'deleteDatedNote', id: 'note-1' });
    expect(deleteDatedNoteById).toHaveBeenCalledWith('note-1');
    expect(deleteDatedNoteByCouple).not.toHaveBeenCalled();
  });
});
