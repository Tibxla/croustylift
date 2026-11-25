// Les RÉSIDUELS du moteur de la Salle (relectures Codex des 24 et 25/11), un
// scénario par résiduel, joué de bout en bout contre une fausse base.
//
// Chaque scénario a d'abord été écrit ROUGE sur le code d'avant le registre
// d'écritures (`it.fails`, commit « test(synchro): résiduels reproduits »),
// puis il est passé au vert avec lui. Ils restent ici comme garde : ce que le
// registre rend impossible par construction ne doit pas redevenir possible.
//
// Numéros : `a-reprendre.md` de l'audit du 22/11, « Résiduels du moteur ».
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  abandonRefused,
  enqueue,
  enqueueAll,
  flush,
  listRefused,
  readStamp,
  retryRefused,
  writesSince,
  type OutboxOp,
  type ReadStamp,
  type SyncFns,
} from './outbox';
import { correctSet, deleteSet, type SetGesture } from './set-gestures';
import { captureReducer, type CaptureState, type ExerciseProgress, type HydratedProgress } from './state';

// --- Stockage, dont l'écriture peut être refusée (quota plein) ----------------

class Storage_ {
  store = new Map<string, string>();
  full = false;
  getItem(k: string): string | null {
    return this.store.has(k) ? (this.store.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    if (this.full) throw new Error('QuotaExceededError');
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

let storage: Storage_;

beforeEach(() => {
  storage = new Storage_();
  (globalThis as unknown as { localStorage: Storage }).localStorage = storage as unknown as Storage;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// --- Fausse base : les lignes de `performed_sets`, et ce qu'elle refuse --------

interface Row {
  weightKg: number;
  reps: number;
  rir: number;
  setOrder: number;
}

function fakeBase(refuses: (op: OutboxOp) => string | null = () => null) {
  const sets = new Map<string, Row>();
  const executions = new Set<string>();
  const sent: string[] = [];
  const run = (apply: (op: never) => void) => async (op: OutboxOp) => {
    const code = refuses(op);
    if (code !== null) throw Object.assign(new Error('refus de la base'), { code });
    sent.push(`${op.type}:${op.id}`);
    apply(op as never);
  };
  const noop = run(() => {});
  const fns = {
    upsertExecution: run((op: { id: string }) => void executions.add(op.id)),
    insertSet: run((op: Row & { id: string }) =>
      void sets.set(op.id, { weightKg: op.weightKg, reps: op.reps, rir: op.rir, setOrder: op.setOrder }),
    ),
    patchSet: run((op: Row & { id: string; only: 'values' | 'rank' }) => {
      const row = sets.get(op.id);
      // Un `update` : sans ligne, rien n'est écrit ni recréé.
      if (!row) return;
      sets.set(
        op.id,
        op.only === 'values'
          ? { ...row, weightKg: op.weightKg, reps: op.reps, rir: op.rir }
          : { ...row, setOrder: op.setOrder },
      );
    }),
    deleteSet: run((op: { id: string }) => void sets.delete(op.id)),
    updateExecution: noop,
    upsertDatedNote: noop,
    deleteDatedNote: noop,
    upsertExerciseNote: noop,
    deleteExerciseNote: noop,
    deleteExecution: noop,
    deleteExecutionIfEmpty: noop,
  } as unknown as SyncFns;
  return { fns, sets, sent };
}

const execOp = (id = 'exec-1'): OutboxOp => ({
  type: 'upsertExecution',
  id,
  seanceVersionId: 'ver-1',
  performedOn: '2026-11-24',
});

const insertOp = (id: string, setOrder: number, weightKg = 80): OutboxOp => ({
  type: 'insertSet',
  id,
  executionId: 'exec-1',
  exerciseId: 'bench',
  setOrder,
  weightKg,
  reps: 8,
  rir: 2,
});

const correctionOp = (id: string, setOrder: number, weightKg: number): OutboxOp => ({
  type: 'patchSet',
  id,
  executionId: 'exec-1',
  exerciseId: 'bench',
  setOrder,
  weightKg,
  reps: 8,
  rir: 2,
  only: 'values',
});

const refusalOf = (type: OutboxOp['type'], id: string) =>
  listRefused().find((r) => r.op.type === type && r.op.id === id);

// --- Résiduels de la quarantaine ----------------------------------------------

describe('résiduel 2 : renvoyer une séance refusée ne ressuscite pas une série supprimée depuis', () => {
  it('la série supprimée hors ligne reste supprimée après le renvoi de sa séance', async () => {
    // La base refuse la création de la séance : sa série est retenue avec elle.
    let executionRefused = true;
    const base = fakeBase((op) => (op.type === 'upsertExecution' && executionRefused ? '23503' : null));
    enqueueAll([execOp(), insertOp('S1', 1)]);
    await flush(base.fns);
    expect(refusalOf('upsertExecution', 'exec-1')).toBeDefined();

    // L'utilisateur supprime la série en Salle, hors ligne : la suppression attend.
    enqueue({ type: 'deleteSet', id: 'S1', exerciseIds: ['bench'] });

    // La cause du refus est levée ; il renvoie la séance depuis la feuille.
    executionRefused = false;
    await retryRefused(refusalOf('upsertExecution', 'exec-1')!.refusalId);
    await flush(base.fns);

    expect(base.sets.has('S1')).toBe(false);
  });
});

describe('résiduel 3 : un stockage plein à l’acquittement d’une suppression ne rend pas l’insertion renvoyable', () => {
  it('l’insertion refusée d’une série supprimée ne peut plus repartir', async () => {
    let refusing = true;
    const base = fakeBase((op) => (op.type === 'insertSet' && refusing ? '23514' : null));
    enqueueAll([execOp(), insertOp('S1', 1)]);
    await flush(base.fns);
    expect(refusalOf('insertSet', 'S1')).toBeDefined();

    // La série est supprimée ; le stockage refuse toute écriture pendant l'envoi.
    enqueue({ type: 'deleteSet', id: 'S1', exerciseIds: ['bench'] });
    storage.full = true;
    await flush(base.fns);
    storage.full = false;

    // Plus aucun refus à renvoyer pour cette série : rien ne peut la recréer.
    refusing = false;
    for (const refused of listRefused()) await retryRefused(refused.refusalId);
    await flush(base.fns);

    expect(base.sets.has('S1')).toBe(false);
  });
});

describe('résiduel 6 (client) : un refus que le stockage plein empêche d’écrire ne perd rien', () => {
  it('rien n’est rangé parmi les refus tant que la place manque ; elle revient, le refus est listé et la suivante part', async () => {
    const base = fakeBase((op) => (op.type === 'insertSet' && op.id === 'S1' ? '23514' : null));
    enqueueAll([execOp(), insertOp('S1', 1), insertOp('S2', 2)]);

    // Voie 1 (ADR 0025) : une transition est écrite, ou elle n'a pas lieu.
    storage.full = true;
    await flush(base.fns);
    expect(listRefused()).toEqual([]);
    expect(base.sets.has('S2')).toBe(false);

    storage.full = false;
    await flush(base.fns);
    expect(refusalOf('insertSet', 'S1')).toBeDefined();
    expect(base.sets.has('S2')).toBe(true);
  });
});

describe('résiduel 7 : abandonner un refus emporte la correction qui en dépendait', () => {
  it('la correction ne part pas seule, sans ligne à corriger', async () => {
    const base = fakeBase((op) => (op.type === 'insertSet' ? '23514' : null));
    enqueueAll([execOp(), insertOp('S3', 3, 9999)]);
    await flush(base.fns);

    // Corrigée hors ligne : la correction attend, elle relèvera le refus.
    enqueue(correctionOp('S3', 3, 82.5));

    // L'utilisateur abandonne le refus depuis la feuille.
    await abandonRefused(refusalOf('insertSet', 'S3')!.refusalId);
    await flush(base.fns);

    // Rien n'est parti « à vide » : la correction a été abandonnée avec le refus.
    expect(base.sent).not.toContain('patchSet:S3');
    expect(base.sets.has('S3')).toBe(false);
  });
});

// --- Résiduels de la réponse tardive -------------------------------------------

const progressOf = (rows: readonly [string, number, number][]): ExerciseProgress => ({
  sets: rows.map(([, order, weightKg]) => ({ weightKg, reps: 8, rir: 2, order })),
  setIds: rows.map(([id]) => id),
  skipped: false,
});

function boardWith(rows: readonly [string, number, number][]): CaptureState {
  return {
    sessionId: 'seance-1',
    executionId: 'exec-1',
    date: '2026-11-24',
    startedAt: 0,
    activeExerciseId: 'bench',
    progress: { bench: progressOf(rows) },
    datedNotes: {},
    closedAt: null,
  };
}

const boardRows = (state: CaptureState) =>
  (state.progress.bench?.sets ?? []).map((set, i) => [
    state.progress.bench?.setIds[i],
    set.order,
    set.weightKg,
  ]);

/** Un geste de la Salle : le réducteur avance, ses écritures entrent au registre d'un seul tenant. */
function play(state: CaptureState, gesture: SetGesture | null): CaptureState {
  if (gesture === null) throw new Error('geste sans effet');
  enqueueAll(gesture.ops);
  return captureReducer(state, gesture.action);
}

/** La réponse d'une lecture partie à `stamp` arrive sur le tableau monté. */
function answer(state: CaptureState, stamp: ReadStamp, base: Record<string, HydratedProgress>): CaptureState {
  return captureReducer(state, { type: 'reconcile-progress', base, writes: writesSince(stamp), asOf: readStamp() });
}

const baseRow = (weightKg: number, order: number) => ({ weightKg, reps: 8, rir: 2, order });

describe('résiduel 4 : une correction locale ne masque pas une suppression en attente venue du Journal', () => {
  it('la série supprimée au Journal quitte le tableau, même corrigée ici pendant la lecture', () => {
    // t : la lecture part, le tableau porte S1 à 80 kg.
    let board = boardWith([['S1', 1, 80]]);
    const stamp = readStamp();
    // t+1 : S1 est corrigée ici (82,5 kg).
    board = play(board, correctSet(board, 'bench', 'S1', { weightKg: 82.5, reps: 8, rir: 2 }));
    // t+2 : S1 est supprimée depuis le Journal (autre onglet), la suppression attend.
    enqueue({ type: 'deleteSet', id: 'S1', exerciseIds: ['bench'] });
    // t+3 : la réponse arrive, partie avant tout cela : la base porte encore S1.
    board = answer(board, stamp, { bench: { sets: [baseRow(80, 1)], setIds: ['S1'] } });

    expect(boardRows(board)).toEqual([]);
  });
});

describe('résiduel 8 : une remontée de rang locale ne masque pas une correction reçue de la base', () => {
  it('le rang local et la valeur de la base tiennent ensemble, colonne par colonne', async () => {
    const base = fakeBase();
    // t : la lecture part, le tableau porte S1 et S2 à 80 kg.
    let board = boardWith([
      ['S1', 1, 80],
      ['S2', 2, 80],
    ]);
    const stamp = readStamp();
    // t+1 : S1 est supprimée ici, S2 remonte au rang 1 ; les deux écritures
    // sont acquittées pendant le trajet de la lecture.
    board = play(board, deleteSet(board, 'bench', 'S1'));
    expect(boardRows(board)).toEqual([['S2', 1, 80]]);
    await flush(base.fns);
    // t+2 : la réponse arrive. S2 a été corrigée ailleurs (90 kg) avant le départ
    // de la lecture, ce que cet appareil n'avait pas encore vu.
    board = answer(board, stamp, {
      bench: { sets: [baseRow(80, 1), baseRow(90, 2)], setIds: ['S1', 'S2'] },
    });

    // Le rang vient d'ici, le poids vient de la base.
    expect(boardRows(board)).toEqual([['S2', 1, 90]]);
  });
});
