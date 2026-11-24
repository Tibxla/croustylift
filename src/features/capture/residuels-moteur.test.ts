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
  retryRefused,
  type OutboxOp,
  type SyncFns,
} from './outbox';
import { captureReducer, type CaptureState, type ExerciseProgress } from './state';

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
  it.fails('la série supprimée hors ligne reste supprimée après le renvoi de sa séance', async () => {
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
  it.fails('l’insertion refusée d’une série supprimée ne peut plus repartir', async () => {
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

describe('résiduel 6 (client) : un refus se range même quand le stockage est plein', () => {
  it.fails('la saisie refusée est listée et la suivante part quand même', async () => {
    const base = fakeBase((op) => (op.type === 'insertSet' && op.id === 'S1' ? '23514' : null));
    enqueueAll([execOp(), insertOp('S1', 1), insertOp('S2', 2)]);

    storage.full = true;
    await flush(base.fns);

    expect(refusalOf('insertSet', 'S1')).toBeDefined();
    expect(base.sets.has('S2')).toBe(true);
  });
});

describe('résiduel 7 : abandonner un refus emporte la correction qui en dépendait', () => {
  it.fails('la correction ne part pas seule, sans ligne à corriger', async () => {
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

describe('résiduel 4 : une correction locale ne masque pas une suppression en file venue du Journal', () => {
  it.fails('la série supprimée au Journal quitte le tableau, même corrigée ici pendant la lecture', () => {
    // t : la lecture part, le tableau porte S1 à 80 kg.
    const departure = boardWith([['S1', 1, 80]]);
    // t+1 : S1 est corrigée ici (82,5 kg).
    const corrected = captureReducer(departure, {
      type: 'correct-set',
      exerciseId: 'bench',
      setId: 'S1',
      values: { weightKg: 82.5, reps: 8, rir: 2 },
    });
    // t+2 : S1 est supprimée depuis le Journal (autre onglet), la suppression attend.
    const deletion: OutboxOp = { type: 'deleteSet', id: 'S1', exerciseIds: ['bench'] };
    // t+3 : la réponse arrive, partie avant tout cela : la base porte encore S1.
    const after = captureReducer(corrected, {
      type: 'reconcile-progress',
      base: { bench: { sets: [{ weightKg: 80, reps: 8, rir: 2, order: 1 }], setIds: ['S1'] } },
      pendingSetIds: [],
      knownAtDeparture: ['S1'],
      departure: departure.progress,
      queuedOps: [correctionOp('S1', 1, 82.5), deletion],
    });

    expect(boardRows(after)).toEqual([]);
  });
});

describe('résiduel 8 : une remontée de rang locale ne masque pas une correction reçue de la base', () => {
  it.fails('le rang local et la valeur de la base tiennent ensemble, colonne par colonne', () => {
    // t : la lecture part, le tableau porte S1 et S2 à 80 kg.
    const departure = boardWith([
      ['S1', 1, 80],
      ['S2', 2, 80],
    ]);
    // t+1 : S1 est supprimée ici, S2 remonte au rang 1.
    const moved = captureReducer(departure, { type: 'delete-set', exerciseId: 'bench', setId: 'S1' });
    expect(boardRows(moved)).toEqual([['S2', 1, 80]]);
    // t+2 : la réponse arrive. S2 a été corrigée ailleurs (90 kg) avant le départ
    // de la lecture, que cet appareil n'avait pas encore vue.
    const after = captureReducer(moved, {
      type: 'reconcile-progress',
      base: {
        bench: {
          sets: [
            { weightKg: 80, reps: 8, rir: 2, order: 1 },
            { weightKg: 90, reps: 8, rir: 2, order: 2 },
          ],
          setIds: ['S1', 'S2'],
        },
      },
      pendingSetIds: [],
      knownAtDeparture: ['S1', 'S2'],
      departure: departure.progress,
      queuedOps: [
        { type: 'deleteSet', id: 'S1', exerciseIds: ['bench'] },
        {
          type: 'patchSet',
          id: 'S2',
          executionId: 'exec-1',
          exerciseId: 'bench',
          setOrder: 1,
          weightKg: 80,
          reps: 8,
          rir: 2,
          only: 'rank',
        },
      ],
    });

    // Le rang vient d'ici, le poids vient de la base.
    expect(boardRows(after)).toEqual([['S2', 1, 90]]);
  });
});
