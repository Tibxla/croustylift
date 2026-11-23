// Tests unitaires de l'OUTBOX (file d'écritures offline).
//
// Env node : pas de localStorage natif → on installe un polyfill mémoire avant
// chaque test (reset systématique). AUCUN vrai Supabase : les `SyncFns` sont
// mockées (vi.fn), on observe ce qui est appelé, dans quel ordre, et ce qui
// reste en file après échec.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  abandonRefused,
  clearOwnQueue,
  heldCounts,
  enqueueTracked,
  listRefused,
  pendingAmong,
  retryRefused,
  storageFailing,
  refusedAmong,
  enqueue,
  flush,
  readQueue,
  pendingCount,
  clearQueue,
  purgeByExecution,
  mergeByEnqueueTime,
  adoptLegacyOps,
  readOwnQueue,
  readQuarantine,
  quarantineCount,
  heldCount,
  type SyncFns,
  type OutboxOp,
  type InsertSetOp,
} from './outbox';
import { clearLocalAccount, saveLocalAccount } from '../../lib/local-account';

// La file persistée porte un `_seq` interne (identité de file, cf. outbox.ts) : on
// le retire pour comparer la FORME MÉTIER des ops par égalité profonde (toEqual).
const queueNoSeq = () => readQueue().map(({ _seq, _owner, _uid, _at, ...op }) => op);

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
  const upsertExerciseNote = vi.fn(async (op) => void order.push(op));
  const deleteExerciseNote = vi.fn(async (op) => void order.push(op));
  const deleteExecution = vi.fn(async (op) => void order.push(op));
  return {
    upsertExecution,
    insertSet,
    deleteSet,
    updateExecution,
    upsertDatedNote,
    deleteDatedNote,
    upsertExerciseNote,
    deleteExerciseNote,
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
    enqueue({ type: 'upsertExerciseNote', id: 'bench', body: 'prise serrée' });
    enqueue({ type: 'deleteExerciseNote', id: 'bench' });
    enqueue({ type: 'deleteExecution', id: 'exec-1' });
    const fns = okFns();

    await flush(fns);

    expect(fns.upsertExecution).toHaveBeenCalledTimes(1);
    expect(fns.insertSet).toHaveBeenCalledTimes(1);
    expect(fns.deleteSet).toHaveBeenCalledTimes(1);
    expect(fns.updateExecution).toHaveBeenCalledTimes(1);
    expect(fns.upsertDatedNote).toHaveBeenCalledTimes(1);
    expect(fns.deleteDatedNote).toHaveBeenCalledTimes(1);
    expect(fns.upsertExerciseNote).toHaveBeenCalledTimes(1);
    expect(fns.deleteExerciseNote).toHaveBeenCalledTimes(1);
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
    expect((fns.deleteExecution as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toMatchObject({
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
    expect(queueNoSeq()).toEqual([left, right]);

    const fns = okFns();
    await flush(fns);

    const inserts = fns.calls().filter((o): o is InsertSetOp => o.type === 'insertSet');
    expect(inserts.map((o) => o.side)).toEqual(['left', 'right']);
    expect(inserts.map((o) => o.setOrder)).toEqual([1, 1]);
  });

  it('garde-fou de tête (_seq) : deux ops même (type,id), retrait concurrent de la tête traitée ne saute pas la suivante', async () => {
    // Deux updateExecution sur le MÊME id (re-clôture) : (type,id) IDENTIQUE, _seq
    // distinct. C'est exactement le cas où l'ancien garde-fou (type,id) pouvait
    // confondre la 2ᵉ op avec « la tête déjà traitée » et la shifter sans la jouer.
    enqueue({ type: 'updateExecution', id: 'exec-1', bpmAvg: 100 });
    enqueue({ type: 'updateExecution', id: 'exec-1', bpmAvg: 200 });

    const fns = okFns();
    let n = 0;
    (fns.updateExecution as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      n += 1;
      // Pendant le traitement de la 1ʳᵉ op, une mutation concurrente (ex. purge)
      // retire EXACTEMENT la tête traitée, laissant la 2ᵉ op (même type,id) en tête.
      if (n === 1) {
        localStorage.setItem('croustylift:outbox', JSON.stringify(readQueue().slice(1)));
      }
    });

    await flush(fns);

    // La 2ᵉ op n'est PAS sautée : updateExecution est appelée 2 fois. L'ancien garde
    // (type,id) aurait matché la 2ᵉ op et l'aurait shiftée sans la jouer (1 appel).
    expect(n).toBe(2);
    expect(readQueue()).toEqual([]);
  });

  it('deux onglets : deux ops de même numéro d’ordre, type et id ne se confondent pas (identité par UUID)', async () => {
    // Le compteur d'ordre est tenu par onglet : deux onglets peuvent donner le
    // MÊME `_seq` à deux ops de même (type,id). Repérée par `_seq`, la seconde
    // était retirée à la place de la première, sans jamais avoir été envoyée.
    enqueue({ type: 'updateExecution', id: 'exec-1', bpmAvg: 100 });
    enqueue({ type: 'updateExecution', id: 'exec-1', bpmAvg: 200 });
    const [first, second] = readQueue();
    localStorage.setItem('croustylift:outbox', JSON.stringify([first, { ...second, _seq: first!._seq }]));

    const fns = okFns();
    const sent: (number | null | undefined)[] = [];
    (fns.updateExecution as ReturnType<typeof vi.fn>).mockImplementation(
      async (op: { bpmAvg?: number | null }) => {
        sent.push(op.bpmAvg);
        // L'autre onglet a déjà envoyé et retiré la première pendant notre requête.
        if (sent.length === 1) {
          localStorage.setItem('croustylift:outbox', JSON.stringify(readQueue().slice(1)));
        }
      },
    );

    await flush(fns);

    expect(sent).toEqual([100, 200]);
    expect(readQueue()).toEqual([]);
  });

  it('chaque op enfilée reçoit une identité unique, rendue à l’appelant', () => {
    const a = enqueueTracked({ type: 'deleteSet', id: 's1' });
    const b = enqueueTracked({ type: 'deleteSet', id: 's1' });

    expect(a).not.toBe(b);
    expect(readQueue().map((op) => op._uid)).toEqual([a, b]);
    expect(pendingAmong([a])).toBe(1);
    expect(pendingAmong([a, b])).toBe(2);
    expect(refusedAmong([a, b])).toBe(0);
  });

  it('l’identité de file n’est jamais passée aux fonctions de sync', async () => {
    enqueue({ type: 'deleteSet', id: 's1' });
    const fns = okFns();

    await flush(fns);

    expect(fns.calls()).toEqual([{ type: 'deleteSet', id: 's1' }]);
  });
});

describe('enqueue : étiquette de compte quand le marqueur n’a pas pu être écrit', () => {
  it('l’op porte le compte reconnu en mémoire, et part sous lui', async () => {
    // Quota plein au moment de la Connexion : le marqueur n'est pas persisté.
    const storage = localStorage as unknown as { setItem: (k: string, v: string) => void };
    const write = storage.setItem.bind(localStorage);
    storage.setItem = (k, v) => {
      if (k === 'croustylift:account') throw new Error('QuotaExceededError');
      write(k, v);
    };
    saveLocalAccount({ userId: 'user-a', email: 'a@exemple.com' });

    enqueue(execOp());

    expect(readQueue()[0]?._owner).toBe('user-a');
    const fns = okFns();
    expect(await flush(fns, async () => 'user-a')).toEqual({ remaining: 0, flushed: 1 });
    clearLocalAccount();
  });
});

// --- Un seul onglet flushe à la fois (verrou du navigateur) -------------------

describe('flush : verrou entre onglets', () => {
  /** Faux `navigator.locks` : `held` simule un autre onglet qui tient le verrou. */
  function fakeLocks(state: { held: boolean; stolen: number }) {
    return {
      request: async (
        _name: string,
        options: { ifAvailable?: boolean; steal?: boolean },
        callback: (lock: object | null) => unknown,
      ) => {
        if (options.steal) {
          state.stolen += 1;
          state.held = false;
        }
        return callback(state.held ? null : {});
      },
    };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('verrou libre : la passe tourne', async () => {
    vi.stubGlobal('navigator', { locks: fakeLocks({ held: false, stolen: 0 }) });
    enqueue(execOp());
    const fns = okFns();

    expect(await flush(fns)).toEqual({ remaining: 0, flushed: 1 });
  });

  it('verrou pris par un autre onglet : rien n’est envoyé d’ici, la file reste', async () => {
    vi.stubGlobal('navigator', { locks: fakeLocks({ held: true, stolen: 0 }) });
    enqueue(execOp());
    const fns = okFns();

    expect(await flush(fns)).toEqual({ remaining: 1, flushed: 0 });
    expect(fns.calls()).toEqual([]);
    expect(readQueue()).toHaveLength(1);
  });

  it('verrou refusé depuis plus d’une minute : il n’est JAMAIS repris à l’autre onglet', async () => {
    vi.useFakeTimers();
    const state = { held: true, stolen: 0 };
    vi.stubGlobal('navigator', { locks: fakeLocks(state) });
    enqueue(execOp());
    const fns = okFns();

    await flush(fns);
    vi.advanceTimersByTime(61_000);
    expect(await flush(fns)).toEqual({ remaining: 1, flushed: 0 });
    vi.advanceTimersByTime(600_000);
    expect(await flush(fns)).toEqual({ remaining: 1, flushed: 0 });

    expect(state.stolen).toBe(0);
    expect(fns.calls()).toEqual([]);
    expect(readQueue()).toHaveLength(1);
    clearQueue();
  });

  it('sans l’API de verrou : la passe tourne comme avant', async () => {
    vi.stubGlobal('navigator', {});
    enqueue(execOp());
    const fns = okFns();

    expect(await flush(fns)).toEqual({ remaining: 0, flushed: 1 });
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
    expect((ok.insertSet as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toMatchObject({
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

  it('clearQueue supprime AUSSI le blob de quarantaine (BUG M5, fuite appareil partagé)', () => {
    // Le blob :corrupt contient du réalisé en clair (issue F11). À la déconnexion
    // (clearQueue), il ne doit pas survivre entre deux comptes sur le même appareil.
    const CORRUPT = 'croustylift:outbox:corrupt';
    enqueue(execOp());
    localStorage.setItem(CORRUPT, '[{"type":"insertSet","id":"fuite"}]');

    clearQueue();

    expect(localStorage.getItem('croustylift:outbox')).toBeNull();
    expect(localStorage.getItem(CORRUPT)).toBeNull();
  });
});

// --- localStorage hostile (corruption / quota) — issue F11 ------------------
//
// readQueue ne doit JAMAIS perdre un blob illisible en silence : avant de repartir
// vide, il le met en QUARANTAINE (clé dédiée) pour qu'on puisse diagnostiquer/récupérer.
// writeQueue, lui, SIGNALE (console.warn) un quota plein au lieu d'un no-op muet.

const STORAGE_KEY = 'croustylift:outbox';
const CORRUPT_KEY = `${STORAGE_KEY}:corrupt`;

describe('readQueue (blob corrompu, issue F11)', () => {
  it('JSON illisible → renvoie [] et PRÉSERVE le blob sous la clé de quarantaine', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const blob = '{ pas du JSON valide';
    localStorage.setItem(STORAGE_KEY, blob);

    expect(readQueue()).toEqual([]);
    // Le blob fautif n'est pas perdu : on peut le récupérer pour diagnostic.
    expect(localStorage.getItem(CORRUPT_KEY)).toBe(blob);
    expect(warn).toHaveBeenCalledTimes(1);

    warn.mockRestore();
  });

  it('forme invalide (pas un tableau) → renvoie [] et met le blob en quarantaine', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const blob = JSON.stringify({ oops: 'objet, pas un tableau' });
    localStorage.setItem(STORAGE_KEY, blob);

    expect(readQueue()).toEqual([]);
    expect(localStorage.getItem(CORRUPT_KEY)).toBe(blob);
    expect(warn).toHaveBeenCalledTimes(1);

    warn.mockRestore();
  });

  it('blob valide → AUCUNE quarantaine, aucun warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    enqueue(execOp());

    expect(readQueue()).toHaveLength(1);
    expect(localStorage.getItem(CORRUPT_KEY)).toBeNull();
    expect(warn).not.toHaveBeenCalled();

    warn.mockRestore();
  });
});

describe('writeQueue (quota plein, issue F11)', () => {
  it('setItem qui jette → console.warn (pas de no-op muet), la file mémoire reste correcte', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // setItem rejette systématiquement (simule un quota plein / mode privé).
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });

    // enqueue → writeQueue échoue : on ne jette pas, on signale.
    expect(() => enqueue(execOp())).not.toThrow();
    expect(warn).toHaveBeenCalled();

    warn.mockRestore();
    vi.restoreAllMocks();
  });
});

// --- flush : ré-armement (op enfilée pendant la passe) — issue F12 ----------
//
// flush mémoïse `inFlight`. Une op enfilée alors qu'une passe est en cours ne doit
// PAS rester orpheline en file : la passe la rattrape (relecture à chaque tour) et,
// pour l'op qui se glisse dans la fenêtre entre la fin de boucle et la libération
// d'`inFlight`, le ré-armement relance une passe. Le FlushResult reflète l'état réel.

describe('flush (ré-armement, issue F12)', () => {
  it('une op enfilée PENDANT la passe est flushée, pas laissée en file', async () => {
    enqueue(execOp());
    const fns = okFns();
    // Pendant le traitement de l'exécution (dernière op de la file au départ), une
    // série est enfilée — exactement le cas « enqueue concurrent en cours de passe ».
    let injected = false;
    fns.upsertExecution = vi.fn(async () => {
      if (!injected) {
        injected = true;
        enqueue(setOp('s1', 1));
      }
      return undefined;
    });

    const res = await flush(fns);

    // L'op injectée est bien partie ET comptée : file vide, FlushResult cohérent.
    expect(pendingCount()).toBe(0);
    expect(readQueue()).toEqual([]);
    expect(fns.insertSet).toHaveBeenCalledTimes(1);
    expect((fns.insertSet as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toMatchObject({
      id: 's1',
    });
    expect(res).toEqual({ remaining: 0, flushed: 2 });
  });

  it('ré-arme jusqu’à vider même si une op est injectée à la TOUTE fin de file', async () => {
    // L'injection se fait sur la DERNIÈRE op traitée d'une file à 2 éléments : le
    // ré-armement doit fermer la file proprement et refléter remaining: 0.
    enqueue(execOp());
    enqueue(setOp('s1', 1));
    const fns = okFns();
    let injected = false;
    fns.insertSet = vi.fn(async () => {
      if (!injected) {
        injected = true;
        enqueue(setOp('s2', 2));
      }
      return undefined;
    });

    const res = await flush(fns);

    expect(pendingCount()).toBe(0);
    // s1 puis s2 (l'op injectée) sont tous deux passés par insertSet : la file
    // re-remplie en fin de passe a bien été drainée par le ré-armement.
    expect(
      (fns.insertSet as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0].id),
    ).toEqual(['s1', 's2']);
    expect(res).toEqual({ remaining: 0, flushed: 3 });
  });

  it('reste borné : un échec en tête arrête le ré-armement (pas de boucle infinie)', async () => {
    enqueue(execOp());
    enqueue(setOp('s1', 1));
    const fns = okFns();
    // L'exécution passe, la série échoue en boucle : la passe ne progresse plus,
    // le ré-armement s'arrête, l'op reste en file pour le prochain flush.
    fns.insertSet = vi.fn().mockRejectedValue(new Error('offline'));

    const res = await flush(fns);

    expect(res).toEqual({ remaining: 1, flushed: 1 });
    expect(readQueue().map((o) => o.id)).toEqual(['s1']);
  });
});

// --- flush : concurrence réelle (sérialisation `inFlight`) -------------------
//
// Les tests ci-dessus sont séquentiels (un seul flush awaité à la fois) : ils
// n'exercent PAS le garde-fou `if (inFlight) return inFlight`. Ici on lance DEUX
// flush qui se CHEVAUCHENT vraiment — la 1ʳᵉ passe est figée sur une SyncFn qui
// bloque sur une promesse qu'on résout à la main, le 2ᵉ flush part avant que la
// 1ʳᵉ ait fini. On vérifie qu'ils partagent la même promesse (pas de 2ᵉ passe)
// et qu'aucune op n'est rejouée (chaque SyncFn appelée une seule fois).

describe('flush (concurrence réelle, sérialisation inFlight)', () => {
  it('deux flush concurrents partagent la promesse et ne rejouent aucune op', async () => {
    enqueue(execOp());
    enqueue(setOp('s1', 1));

    const fns = okFns();
    // La 1ʳᵉ passe se fige sur la 1ʳᵉ op : on contrôle sa résolution à la main,
    // garantissant que le 2ᵉ flush part PENDANT que la 1ʳᵉ passe est en vol.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const realUpsert = fns.upsertExecution;
    let blocked = false;
    fns.upsertExecution = vi.fn(async (op) => {
      if (!blocked) {
        blocked = true;
        await gate; // fige la passe jusqu'au release manuel
      }
      return realUpsert(op);
    });

    // Deux flush SANS await entre les deux : le 2ᵉ doit retomber sur `inFlight`.
    const p1 = flush(fns);
    const p2 = flush(fns);
    expect(p1).toBe(p2); // même promesse mémoïsée, aucune 2ᵉ passe lancée

    release(); // débloque la 1ʳᵉ (et seule) passe
    const [res1, res2] = await Promise.all([p1, p2]);

    // Une seule passe a réellement tourné : chaque op n'a été jouée qu'UNE fois.
    expect(fns.upsertExecution).toHaveBeenCalledTimes(1);
    expect(fns.insertSet).toHaveBeenCalledTimes(1);
    expect(fns.calls().map((o) => o.id)).toEqual(['exec-1', 's1']);
    // Résultat partagé, file vidée.
    expect(res1).toBe(res2);
    expect(res1).toEqual({ remaining: 0, flushed: 2 });
    expect(pendingCount()).toBe(0);
  });
});

// --- flush : shift conditionnel (file mutée pendant l'await) — BUG M3 --------
//
// runFlushOnce traitait l'op en tête puis faisait un `shift()` AVEUGLE après
// l'await, en supposant que `current[0]` est encore l'op traitée. Si un
// « Réinitialiser » (purgeByExecution) ou un clearQueue modifie la file PENDANT
// l'await, la tête a changé → un shift aveugle retirerait la MAUVAISE op (perte
// d'une op d'une NOUVELLE exécution). Le fix ne shift que si la tête est encore
// l'op traitée (même type + même id).

describe('flush (shift conditionnel, BUG M3)', () => {
  it('op purgée pendant l’await : ne retire PAS l’op d’une nouvelle exécution', async () => {
    // File = [execA]. Pendant le flush de execA, l'utilisateur « Réinitialise »
    // (purge execA) puis logge une NOUVELLE exécution execB. Au retour de l'await,
    // la tête est execB, pas execA : un shift aveugle perdrait execB.
    enqueue(execOp('execA'));
    const fns = okFns();
    let mutated = false;
    fns.upsertExecution = vi.fn(async (op) => {
      if (op.id === 'execA' && !mutated) {
        mutated = true;
        purgeByExecution('execA'); // retire execA (la tête en cours de traitement)
        enqueue(execOp('execB')); // nouvelle exécution -> nouvelle tête
      }
      return undefined;
    });

    const res = await flush(fns);

    // execB n'a PAS été retiré par erreur : il a été traité au tour suivant.
    expect((fns.upsertExecution as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0].id)).toEqual(
      ['execA', 'execB'],
    );
    // File vidée proprement, sans perte ni op orpheline.
    expect(pendingCount()).toBe(0);
    expect(readQueue()).toEqual([]);
    expect(res.remaining).toBe(0);
  });

  it('clearQueue pendant l’await : ne retire rien à tort, reprend sur file vide', async () => {
    // File = [execA, s1]. Pendant le flush de execA, un clearQueue vide tout.
    // L'ancien shift aveugle aurait écrit une file « shiftée » par-dessus le vide.
    enqueue(execOp('execA'));
    enqueue(setOp('s1', 1, 'execA'));
    const fns = okFns();
    let cleared = false;
    fns.upsertExecution = vi.fn(async () => {
      if (!cleared) {
        cleared = true;
        clearQueue(); // la file disparaît pendant l'await
      }
      return undefined;
    });

    const res = await flush(fns);

    // La tête a disparu : on ne shift pas, on ne ré-écrit pas une file fantôme.
    // s1 n'est PAS rejouée (clearQueue l'a retirée), la file reste vide.
    expect(fns.insertSet).not.toHaveBeenCalled();
    expect(pendingCount()).toBe(0);
    expect(readQueue()).toEqual([]);
    expect(res.remaining).toBe(0);
  });
});

// --- flush : op de type inconnu (Codex Q6a) ---------------------------------
//
// Une op dont le `type` ne matche aucun case ne doit PAS être retirée comme un
// succès (runOp renvoyait undefined → traitée comme passée → perte silencieuse).
// runOp JETTE désormais sur type inconnu : la passe s'arrête à cette op (arrêt-
// sur-échec), l'op reste en file, jamais perdue ; les ops valides AVANT passent.

describe('flush (op de type inconnu, Codex Q6a)', () => {
  it('une op de type inconnu N’EST PAS retirée silencieusement (reste en file)', async () => {
    // Op valide d'abord, puis une op au type hors-union (blob trafiqué / version
    // future écrite par un autre onglet). L'exécution passe, l'op inconnue bloque.
    enqueue(execOp('exec-1'));
    enqueue({ type: 'mystereXYZ', id: 'mystere-1' } as unknown as OutboxOp);
    const fns = okFns();

    const res = await flush(fns);

    // L'exécution valide est passée et retirée ; l'op inconnue reste en file.
    expect(fns.upsertExecution).toHaveBeenCalledTimes(1);
    expect(res.flushed).toBe(1);
    expect(res.remaining).toBe(1);
    expect(readQueue().map((o) => o.id)).toEqual(['mystere-1']);
  });

  it('aucune SyncFn n’est appelée pour le type inconnu', async () => {
    enqueue({ type: 'mystereXYZ', id: 'mystere-1' } as unknown as OutboxOp);
    const fns = okFns();

    await flush(fns);

    // Aucune fonction de sync n'a été sollicitée : le type n'a pas de routage.
    expect(fns.calls()).toEqual([]);
    // L'op reste en file (jamais traitée comme un succès).
    expect(readQueue().map((o) => o.id)).toEqual(['mystere-1']);
  });
});

// --- note d'instructions routée par l'outbox (issue #52, blind F3) ----------
//
// La note d'instructions (table exercise_notes, singleton par user+exo) était
// écrite EN DIRECT hors outbox → perdue au reload en offline. Désormais routée
// par l'outbox. Clé idempotente = exerciseId (porté par le champ `id`), pas un
// UUID de ligne client : 1 note par couple (user, exo).

describe('note d’instructions (upsert/deleteExerciseNote)', () => {
  it('upsertExerciseNote : routée vers sa SyncFn (id = exerciseId), puis RETIRÉE', async () => {
    enqueue({ type: 'upsertExerciseNote', id: 'bench', body: 'coudes rentrés' });
    const fns = okFns();

    const res = await flush(fns);

    expect(fns.upsertExerciseNote).toHaveBeenCalledTimes(1);
    expect((fns.upsertExerciseNote as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toMatchObject({
      type: 'upsertExerciseNote',
      id: 'bench',
      body: 'coudes rentrés',
    });
    // Aucune autre SyncFn touchée ; flush réussi → file vidée.
    expect(fns.deleteExerciseNote).not.toHaveBeenCalled();
    expect(res).toEqual({ remaining: 0, flushed: 1 });
    expect(readQueue()).toEqual([]);
  });

  it('deleteExerciseNote : routée vers sa SyncFn (id = exerciseId), puis RETIRÉE', async () => {
    enqueue({ type: 'deleteExerciseNote', id: 'squat' });
    const fns = okFns();

    const res = await flush(fns);

    expect(fns.deleteExerciseNote).toHaveBeenCalledTimes(1);
    expect((fns.deleteExerciseNote as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toMatchObject({
      type: 'deleteExerciseNote',
      id: 'squat',
    });
    expect(fns.upsertExerciseNote).not.toHaveBeenCalled();
    expect(res).toEqual({ remaining: 0, flushed: 1 });
    expect(readQueue()).toEqual([]);
  });

  it('NE dépend PAS d’une exécution : s’enfile et part seule, sans upsertExecution', async () => {
    // Contrairement à une note datée, elle ne porte pas d'executionId et n'exige
    // aucune op d'exécution préalable : éditer la note d'instructions seule suffit.
    enqueue({ type: 'upsertExerciseNote', id: 'bench', body: 'tempo lent' });
    const fns = okFns();

    await flush(fns);

    expect(fns.upsertExecution).not.toHaveBeenCalled();
    expect(fns.calls().map((o) => o.id)).toEqual(['bench']);
  });

  it('idempotence : rejouer après un échec partiel ne la dédouble pas en file', async () => {
    // Une op d'exécution en tête, puis la note. L'exécution échoue → tout reste,
    // dans l'ordre. Au re-flush OK, la note (même id 'bench') ne passe qu'une fois.
    enqueue(execOp());
    enqueue({ type: 'upsertExerciseNote', id: 'bench', body: 'prise large' });
    const failing = okFns();
    failing.upsertExecution = vi.fn().mockRejectedValueOnce(new Error('offline'));
    await flush(failing);
    expect(readQueue().map((o) => o.id)).toEqual(['exec-1', 'bench']);

    const ok = okFns();
    await flush(ok);
    expect(ok.upsertExerciseNote).toHaveBeenCalledTimes(1);
    expect(pendingCount()).toBe(0);
  });

  it('SURVIT à purgeByExecution : la note vit sur la définition de l’exo, pas sur l’exécution', () => {
    // « Réinitialiser » abandonne l'exécution courante mais NE doit PAS effacer une
    // instruction tapée juste avant : elle n'est pas rattachée à l'exécution.
    enqueue(execOp('exec-1'));
    enqueue({ type: 'upsertExerciseNote', id: 'bench', body: 'serre les omoplates' });
    enqueue({ type: 'deleteExerciseNote', id: 'squat' });

    purgeByExecution('exec-1');

    // L'op d'exécution est partie ; les deux ops de note d'instructions survivent.
    expect(queueNoSeq()).toEqual([
      { type: 'upsertExerciseNote', id: 'bench', body: 'serre les omoplates' },
      { type: 'deleteExerciseNote', id: 'squat' },
    ]);
  });
});

// --- purgeByExecution (reset CIBLÉ d'une exécution abandonnée) ---------------
//
// « Réinitialiser » abandonne l'exécution courante : on retire SES ops en
// attente sans vider toute la file (sinon on perd les séries non synchronisées
// d'AUTRES exécutions ou une correction d'historique offline).

describe('purgeByExecution', () => {
  it('retire les ops de l’exécution ciblée et conserve TOUT le reste', () => {
    // File mixte : ops de exec-1 (à purger), une op de exec-2 (à garder),
    // un deleteSet (idempotent par id, à garder), une correction d'historique.
    enqueue(execOp('exec-1'));
    enqueue(setOp('s1', 1, 'exec-1'));
    enqueue({
      type: 'upsertDatedNote',
      id: 'note-1',
      executionId: 'exec-1',
      exerciseId: 'bench',
      body: 'épaule raide',
    });
    // Op d'une AUTRE exécution (séries non synchronisées en offline) : survit.
    enqueue(execOp('exec-2'));
    enqueue(setOp('s2', 1, 'exec-2'));
    // deleteSet : ne porte que l'id de la ligne (pas d'executionId) → laissé,
    // idempotent par id (sans effet si la ligne n'a jamais existé en base).
    enqueue({ type: 'deleteSet', id: 's1' });

    purgeByExecution('exec-1');

    // Les ops qui CRÉENT/RÉ-AFFIRMENT exec-1 (upsertExecution, insertSet,
    // upsertDatedNote) sont parties ; tout le reste, dans l'ordre, survit.
    expect(readQueue().map((o) => o.id)).toEqual(['exec-2', 's2', 's1']);
  });

  it('retire AUSSI l’updateExecution de l’exécution ciblée (BUG M2)', () => {
    // L'updateExecution porte l'`id` de l'exécution (BPM/durée de fin). Si on
    // abandonne l'exécution sans le retirer, il survit et poserait ces métriques
    // sur une coquille fantôme au prochain flush. Il doit partir avec le reste.
    enqueue(execOp('exec-1'));
    enqueue(setOp('s1', 1, 'exec-1'));
    enqueue({ type: 'updateExecution', id: 'exec-1', bpmAvg: 130, durationMin: 52 });
    // updateExecution d'une AUTRE exécution : survit (id différent).
    enqueue({ type: 'updateExecution', id: 'exec-2', bpmAvg: 120, durationMin: 40 });

    purgeByExecution('exec-1');

    // Seul l'updateExecution de exec-2 reste (les ops de exec-1 sont toutes parties).
    expect(queueNoSeq()).toEqual([
      { type: 'updateExecution', id: 'exec-2', bpmAvg: 120, durationMin: 40 },
    ]);
  });

  it('laisse deleteExecution en place (idempotent par id, sans executionId rattachable)', () => {
    // deleteExecution ne porte que l'id de la ligne et est idempotent : supprimer
    // l'exécution abandonnée est sain → on le LAISSE (tombe dans le default).
    enqueue(execOp('exec-1'));
    enqueue({ type: 'deleteExecution', id: 'exec-1' });

    purgeByExecution('exec-1');

    expect(queueNoSeq()).toEqual([{ type: 'deleteExecution', id: 'exec-1' }]);
  });

  it('laisse la file intacte si aucune op ne vise l’exécution', () => {
    enqueue(execOp('exec-2'));
    enqueue(setOp('s2', 1, 'exec-2'));

    purgeByExecution('exec-1');

    expect(readQueue().map((o) => o.id)).toEqual(['exec-2', 's2']);
  });

  it('est un no-op sur une file vide', () => {
    purgeByExecution('exec-1');
    expect(readQueue()).toEqual([]);
  });
});

// --- flush sans session vérifiée (audit sync, constat 4) --------------------
//
// Sans session, supabase-js envoie la clé publique : un update ou un delete
// touche alors 0 ligne SANS erreur, et l'op serait retirée comme acquittée.
// Le flush reçoit donc un lecteur de session et ne tente rien sans compte.

describe('flush (session vérifiée)', () => {
  // Les ops sont celles du compte reconnu sur l'appareil (cf. « file liée à un
  // compte » plus bas) : la session vérifiée est ici la sienne.
  beforeEach(() => {
    saveLocalAccount({ userId: 'user-1', email: 'toi@exemple.com' });
  });

  it('sans session, aucune op n’est tentée et la file reste entière', async () => {
    enqueue({ type: 'updateExecution', id: 'exec-1', closedAt: '2026-06-18T10:00:00Z' });
    enqueue({ type: 'deleteSet', id: 'set-1' });
    const fns = okFns();

    const res = await flush(fns, async () => null);

    expect(fns.calls()).toEqual([]);
    expect(res).toEqual({ remaining: 2, flushed: 0 });
    expect(readQueue().map((o) => o.id)).toEqual(['exec-1', 'set-1']);
  });

  it('lecteur de session absent côté auth (undefined) : rien n’est tenté non plus', async () => {
    enqueue({ type: 'deleteSet', id: 'set-1' });
    const fns = okFns();

    const res = await flush(fns, async () => undefined);

    expect(fns.calls()).toEqual([]);
    expect(res.remaining).toBe(1);
  });

  it('session présente : la file est vidée comme avant', async () => {
    enqueue(execOp('exec-1'));
    enqueue(setOp('set-1', 1));
    const fns = okFns();

    const res = await flush(fns, async () => 'user-1');

    expect(res).toEqual({ remaining: 0, flushed: 2 });
  });

  it('session perdue PENDANT une passe : l’op en cours n’est pas acquittée, la suite n’est pas tentée', async () => {
    enqueue({ type: 'updateExecution', id: 'exec-1', closedAt: '2026-06-18T10:00:00Z' });
    enqueue({ type: 'deleteSet', id: 'set-1' });
    const fns = okFns();
    // La session tombe pendant la requête de la 1re op (jeton expiré, refresh en
    // échec) : la requête a pu partir sous la clé publique et « réussir » à vide.
    let session: string | null = 'user-1';
    fns.updateExecution = vi.fn(async () => {
      session = null;
    });

    const res = await flush(fns, async () => session);

    expect(fns.updateExecution).toHaveBeenCalledTimes(1);
    expect(fns.deleteSet).not.toHaveBeenCalled();
    expect(res).toEqual({ remaining: 2, flushed: 0 });
    expect(readQueue().map((o) => o.id)).toEqual(['exec-1', 'set-1']);
  });

  it('la session revenue, les ops gardées repartent dans l’ordre', async () => {
    enqueue({ type: 'updateExecution', id: 'exec-1', closedAt: '2026-06-18T10:00:00Z' });
    enqueue({ type: 'deleteSet', id: 'set-1' });
    const fns = okFns();
    await flush(fns, async () => null);

    const res = await flush(fns, async () => 'user-1');

    expect(res).toEqual({ remaining: 0, flushed: 2 });
    expect(fns.calls().map((o) => o.id)).toEqual(['exec-1', 'set-1']);
  });
});

// --- file liée à un compte (audit sécurité, constat 1) ----------------------
//
// Chaque op porte l'id du compte reconnu à l'enfilement. Sous une session
// vérifiée, le flush ne rejoue que les ops de CE compte : celles d'un autre
// restent en file, jamais envoyées sous une autre identité.

describe('file liée à un compte', () => {
  const compteA = { userId: 'user-a', email: 'a@exemple.com' };
  const compteB = { userId: 'user-b', email: 'b@exemple.com' };

  it('enqueue étiquette l’op avec le compte local reconnu', () => {
    saveLocalAccount(compteA);
    enqueue(execOp('exec-1'));

    expect(readQueue()[0]?._owner).toBe('user-a');
  });

  it('le flush ne rejoue que les ops du compte connecté, les autres restent en file', async () => {
    saveLocalAccount(compteA);
    enqueue(execOp('exec-a'));
    enqueue(setOp('set-a', 1, 'exec-a'));
    saveLocalAccount(compteB);
    enqueue(execOp('exec-b'));
    saveLocalAccount(compteA);
    enqueue({ type: 'deleteSet', id: 'set-a-2' });
    saveLocalAccount(compteB);
    const fns = okFns();

    const res = await flush(fns, async () => 'user-b');

    expect(fns.calls().map((o) => o.id)).toEqual(['exec-b']);
    expect(res).toEqual({ remaining: 3, flushed: 1 });
    // Les ops de A sont intactes, dans leur ordre d'enfilement.
    expect(readQueue().map((o) => o.id)).toEqual(['exec-a', 'set-a', 'set-a-2']);
  });

  it('le compte d’origine revenu, ses ops repartent dans l’ordre', async () => {
    saveLocalAccount(compteA);
    enqueue(execOp('exec-a'));
    enqueue(setOp('set-a', 1, 'exec-a'));
    const fns = okFns();
    await flush(fns, async () => 'user-b');
    expect(fns.calls()).toEqual([]);

    const res = await flush(fns, async () => 'user-a');

    expect(res).toEqual({ remaining: 0, flushed: 2 });
    expect(fns.calls().map((o) => o.id)).toEqual(['exec-a', 'set-a']);
  });

  it('la couche de sync reçoit l’op métier, sans étiquette de file', async () => {
    saveLocalAccount(compteA);
    enqueue(execOp('exec-a'));
    const fns = okFns();

    await flush(fns, async () => 'user-a');

    expect(fns.calls()).toEqual([execOp('exec-a')]);
  });

  it('migration douce : les ops sans compte sont attribuées au compte local reconnu', async () => {
    // File écrite par un bundle antérieur : ni `_owner` ni marqueur lu à l'époque.
    localStorage.setItem(
      'croustylift:outbox',
      JSON.stringify([{ ...execOp('exec-a'), _seq: 1 }, { type: 'deleteSet', id: 'set-a', _seq: 2 }]),
    );
    saveLocalAccount(compteA);

    adoptLegacyOps();

    expect(readQueue().map((o) => o._owner)).toEqual(['user-a', 'user-a']);
    // Un autre compte arrivé ensuite (lien de récupération) ne les envoie pas.
    saveLocalAccount(compteB);
    adoptLegacyOps();
    const fns = okFns();
    const res = await flush(fns, async () => 'user-b');
    expect(fns.calls()).toEqual([]);
    expect(res).toEqual({ remaining: 2, flushed: 0 });
  });

  it('sans compte local reconnu, une op sans compte reste en file sous une session vérifiée', async () => {
    enqueue(execOp('exec-x'));
    adoptLegacyOps();
    const fns = okFns();

    const res = await flush(fns, async () => 'user-b');

    expect(fns.calls()).toEqual([]);
    expect(res.remaining).toBe(1);
  });

  it('readOwnQueue ne rend que les ops du compte reconnu (Référence, ADR 0014)', () => {
    saveLocalAccount(compteA);
    enqueue(setOp('set-a', 1, 'exec-a'));
    saveLocalAccount(compteB);
    enqueue(setOp('set-b', 1, 'exec-b'));

    expect(readOwnQueue().map((o) => o.id)).toEqual(['set-b']);
    expect(readQueue()).toHaveLength(2);
  });
});

// --- quarantaine d'une op rejetée par la base (audit sync, constat 6) -------
//
// Une op que la base refuse DÉFINITIVEMENT (contrainte, RLS) échouait à
// l'identique à chaque passe et bloquait toute la file derrière elle ; seule
// issue : la purge totale. Elle est mise de côté, conservée, jamais rejouée
// seule, et la file continue. Une erreur transitoire garde l'arrêt d'avant.

/** L'erreur telle que data.ts la relance : l'objet PostgREST, SQLSTATE en `code`. */
function rejet(code: string, message = 'rejet de la base') {
  return { code, message, details: '', hint: '' };
}

describe('quarantaine (rejet définitif de la base)', () => {
  it('l’op rejetée part en quarantaine, la file continue dans l’ordre', async () => {
    enqueue(execOp('exec-1'));
    enqueue(setOp('set-refuse', 1));
    enqueue(setOp('set-2', 2));
    enqueue({ type: 'updateExecution', id: 'exec-1', closedAt: '2026-06-18T10:00:00Z' });
    const fns = okFns();
    const insertSet = vi.fn(async (op: InsertSetOp) => {
      if (op.id === 'set-refuse') throw rejet('23503', 'exercice supprimé');
    });
    fns.insertSet = insertSet;

    const res = await flush(fns);

    expect(res).toEqual({ remaining: 0, flushed: 3 });
    expect(insertSet.mock.calls.map(([op]) => op.id)).toEqual(['set-refuse', 'set-2']);
    expect(fns.updateExecution).toHaveBeenCalledTimes(1);
    expect(pendingCount()).toBe(0);
    expect(quarantineCount()).toBe(1);
    const [entree] = readQuarantine();
    expect(entree?.op.id).toBe('set-refuse');
    expect(entree?.reason).toContain('23503');
  });

  it('une op en quarantaine n’est jamais rejouée par les passes suivantes', async () => {
    enqueue(setOp('set-refuse', 1));
    const fns = okFns();
    const insertSet = vi.fn(async () => {
      throw rejet('23514');
    });
    fns.insertSet = insertSet;
    await flush(fns);

    enqueue({ type: 'deleteSet', id: 'set-9' });
    const res = await flush(fns);

    expect(insertSet).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ remaining: 0, flushed: 1 });
    expect(quarantineCount()).toBe(1);
  });

  it.each([
    ['réseau (sans code)', new Error('TypeError: Failed to fetch')],
    ['réseau vu par postgrest-js (code vide)', rejet('')],
    ['jeton expiré (401)', rejet('PGRST301')],
    ['erreur serveur sans corps JSON (5xx)', { message: 'Bad Gateway' }],
    ['requête annulée par la base', rejet('57014')],
    ['conflit de sérialisation', rejet('40001')],
  ])('erreur transitoire, %s : arrêt et nouvel essai, rien en quarantaine', async (_nom, erreur) => {
    enqueue(execOp('exec-1'));
    enqueue(setOp('set-1', 1));
    const fns = okFns();
    fns.upsertExecution = vi.fn(async () => {
      throw erreur;
    });

    const res = await flush(fns);

    expect(res).toEqual({ remaining: 2, flushed: 0 });
    expect(fns.insertSet).not.toHaveBeenCalled();
    expect(quarantineCount()).toBe(0);
    expect(readQueue().map((o) => o.id)).toEqual(['exec-1', 'set-1']);
  });

  it('exécution rejetée : ses séries, sa note et sa clôture la suivent sans être envoyées', async () => {
    enqueue(execOp('exec-refusee'));
    enqueue(setOp('set-1', 1, 'exec-refusee'));
    enqueue(execOp('exec-saine'));
    enqueue({
      type: 'upsertDatedNote',
      id: 'note-1',
      executionId: 'exec-refusee',
      exerciseId: 'bench',
      body: 'coude',
    });
    enqueue(setOp('set-sain', 1, 'exec-saine'));
    enqueue({ type: 'updateExecution', id: 'exec-refusee', closedAt: '2026-06-18T10:00:00Z' });
    const fns = okFns();
    const upsertExecution = vi.fn(async (op: { id: string }) => {
      if (op.id === 'exec-refusee') throw rejet('23503', 'séance supprimée');
    });
    fns.upsertExecution = upsertExecution;

    const res = await flush(fns);

    expect(res).toEqual({ remaining: 0, flushed: 2 });
    expect(fns.calls().map((o) => o.id)).toEqual(['set-sain']);
    expect(fns.upsertDatedNote).not.toHaveBeenCalled();
    expect(fns.updateExecution).not.toHaveBeenCalled();
    expect(readQuarantine().map((q) => q.op.id)).toEqual([
      'exec-refusee',
      'set-1',
      'note-1',
      'exec-refusee',
    ]);
  });

  it('une série enfilée PLUS TARD pour une exécution en quarantaine la rejoint', async () => {
    enqueue(execOp('exec-refusee'));
    const fns = okFns();
    fns.upsertExecution = vi.fn(async () => {
      throw rejet('23503');
    });
    await flush(fns);

    enqueue(setOp('set-tardif', 1, 'exec-refusee'));
    const res = await flush(fns);

    expect(fns.insertSet).not.toHaveBeenCalled();
    expect(res).toEqual({ remaining: 0, flushed: 0 });
    expect(readQuarantine().map((q) => q.op.id)).toEqual(['exec-refusee', 'set-tardif']);
  });

  it('l’exécution ré-affirmée avec succès : ses séries suivantes repassent normalement', async () => {
    enqueue(execOp('exec-1'));
    const fns = okFns();
    let refuse = true;
    fns.upsertExecution = vi.fn(async () => {
      if (refuse) throw rejet('23503');
    });
    await flush(fns);
    expect(quarantineCount()).toBe(1);

    refuse = false;
    enqueue(execOp('exec-1'));
    enqueue(setOp('set-1', 1, 'exec-1'));
    const res = await flush(fns);

    expect(res).toEqual({ remaining: 0, flushed: 2 });
    expect(fns.insertSet).toHaveBeenCalledTimes(1);
    // L'op refusée reste conservée, mais ne retient plus les suivantes.
    expect(quarantineCount()).toBe(1);
  });

  it('rejet reçu alors que la session vient de tomber : pas de quarantaine, l’op reste en file', async () => {
    // Sans session la requête part sous la clé publique : un upsert est alors
    // refusé par la RLS (42501) alors que l'op est saine.
    saveLocalAccount({ userId: 'user-1', email: 'toi@exemple.com' });
    enqueue(execOp('exec-1'));
    const fns = okFns();
    let session: string | null = 'user-1';
    fns.upsertExecution = vi.fn(async () => {
      session = null;
      throw rejet('42501', 'new row violates row-level security policy');
    });

    const res = await flush(fns, async () => session);

    expect(res).toEqual({ remaining: 1, flushed: 0 });
    expect(quarantineCount()).toBe(0);
  });

  it('rejet RLS sous une session toujours vérifiée : quarantaine', async () => {
    saveLocalAccount({ userId: 'user-1', email: 'toi@exemple.com' });
    enqueue(execOp('exec-1'));
    const fns = okFns();
    fns.upsertExecution = vi.fn(async () => {
      throw rejet('42501');
    });

    const res = await flush(fns, async () => 'user-1');

    expect(res).toEqual({ remaining: 0, flushed: 0 });
    expect(quarantineCount()).toBe(1);
    expect(readQuarantine()[0]?.op._owner).toBe('user-1');
  });

  it('heldCount compte file et quarantaine ; clearQueue purge les deux', async () => {
    enqueue(setOp('set-refuse', 1));
    const fns = okFns();
    fns.insertSet = vi.fn(async () => {
      throw rejet('23503');
    });
    await flush(fns);
    enqueue({ type: 'deleteSet', id: 'set-9' });

    expect(pendingCount()).toBe(1);
    expect(heldCount()).toBe(2);

    clearQueue();
    expect(heldCount()).toBe(0);
    expect(readQuarantine()).toEqual([]);
  });

  it('quarantaine impossible à écrire (quota) : l’op reste en file, la passe s’arrête', async () => {
    enqueue(setOp('set-refuse', 1));
    enqueue(setOp('set-2', 2));
    const fns = okFns();
    fns.insertSet = vi.fn(async () => {
      throw rejet('23503');
    });
    const store = globalThis.localStorage;
    const setItem = store.setItem.bind(store);
    store.setItem = (k: string, v: string) => {
      if (k === 'croustylift:outbox:quarantine') throw new Error('QuotaExceededError');
      setItem(k, v);
    };

    const res = await flush(fns);

    expect(res).toEqual({ remaining: 2, flushed: 0 });
    expect(readQueue().map((o) => o.id)).toEqual(['set-refuse', 'set-2']);
  });

  it('retrait de la file impossible à persister (quota) : l’op n’est pas rejouée en boucle, la passe finit en mémoire', async () => {
    enqueue(execOp('exec-1'));
    enqueue(setOp('set-1', 1));
    const fns = okFns();
    const store = globalThis.localStorage;
    const setItem = store.setItem.bind(store);
    store.setItem = (k: string, v: string) => {
      if (k === 'croustylift:outbox') throw new Error('QuotaExceededError');
      setItem(k, v);
    };
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await flush(fns);

    // Le retrait de la première op n'a pas pu s'écrire : le miroir mémoire le
    // tient, donc elle n'est envoyée qu'UNE fois et la passe continue.
    expect(fns.upsertExecution).toHaveBeenCalledTimes(1);
    expect(fns.insertSet).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ remaining: 0, flushed: 2 });
    clearQueue();
  });
});

// --- Stockage plein : la file tient en mémoire (audit sync, constat 7) --------
//
// Avant : l'écriture refusée était signalée en console et c'est tout. L'op
// enfilée n'existait nulle part, la bannière disait « Synchronisé ».

describe('stockage plein (quota) : miroir mémoire de la file', () => {
  /** Le stockage refuse toute écriture de la file tant que `full` est vrai. */
  function quota(): { full: boolean } {
    const state = { full: true };
    const store = globalThis.localStorage;
    const setItem = store.setItem.bind(store);
    store.setItem = (k: string, v: string) => {
      if (state.full && k === 'croustylift:outbox') throw new Error('QuotaExceededError');
      setItem(k, v);
    };
    return state;
  }

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    clearQueue();
    vi.restoreAllMocks();
  });

  it('l’op enfilée n’est pas perdue : elle est en file, comptée, et le refus est dit', () => {
    quota();

    enqueue(execOp());
    enqueue(setOp('s1', 1));

    expect(readQueue().map((op) => op.id)).toEqual(['exec-1', 's1']);
    expect(pendingCount()).toBe(2);
    expect(storageFailing()).toBe(true);
    // Rien n'a pu être écrit sur l'appareil.
    expect(localStorage.getItem('croustylift:outbox')).toBeNull();
  });

  it('le flush envoie ce que tient le miroir', async () => {
    quota();
    enqueue(execOp());
    enqueue(setOp('s1', 1));
    const fns = okFns();

    expect(await flush(fns)).toEqual({ remaining: 0, flushed: 2 });
    expect(fns.calls().map((op) => op.id)).toEqual(['exec-1', 's1']);
    // File vide : la retirer du stockage passe toujours, le miroir est rendu.
    expect(storageFailing()).toBe(false);
  });

  it('dès que le stockage accepte de nouveau, la file est persistée et le miroir rendu', () => {
    const state = quota();
    enqueue(execOp());
    expect(storageFailing()).toBe(true);

    state.full = false;
    enqueue(setOp('s1', 1));

    expect(storageFailing()).toBe(false);
    expect(JSON.parse(localStorage.getItem('croustylift:outbox') ?? '[]')).toHaveLength(2);
  });

  it('le cache de lecture cède la place avant de renoncer au stockage', () => {
    // Stockage à capacité bornée, déjà rempli par des copies de lecture.
    const store = globalThis.localStorage as Storage & { removeItem: (k: string) => void };
    const setItem = store.setItem.bind(store);
    const removeItem = store.removeItem.bind(store);
    const sizes = new Map<string, number>();
    const CAPACITY = 1000;
    const used = () => [...sizes.values()].reduce((n, size) => n + size, 0);
    store.setItem = (k: string, v: string) => {
      if (used() - (sizes.get(k) ?? 0) + v.length > CAPACITY) throw new Error('QuotaExceededError');
      sizes.set(k, v.length);
      setItem(k, v);
    };
    store.removeItem = (k: string) => {
      sizes.delete(k);
      removeItem(k);
    };
    // Le polyfill de ce fichier n'énumère pas ses clés : la purge du cache en a besoin.
    Object.defineProperty(store, 'length', { get: () => sizes.size, configurable: true });
    (store as unknown as { key: (i: number) => string | null }).key = (i) =>
      [...sizes.keys()][i] ?? null;
    saveLocalAccount({ userId: 'user-1', email: 'toi@exemple.com' });
    localStorage.setItem(
      'croustylift:readcache:user-1:exo-execs:e1',
      JSON.stringify({ v: 1, value: 'x'.repeat(850) }),
    );

    enqueue(execOp());

    expect(storageFailing()).toBe(false);
    expect(JSON.parse(localStorage.getItem('croustylift:outbox') ?? '[]')).toHaveLength(1);
    expect(localStorage.getItem('croustylift:readcache:user-1:exo-execs:e1')).toBeNull();
  });

  it('« Annuler la séance » agit aussi sur la file tenue en mémoire', () => {
    quota();
    enqueue(execOp('exec-1'));
    enqueue(setOp('s1', 1, 'exec-1'));
    enqueue(execOp('exec-2'));

    purgeByExecution('exec-1');

    expect(readQueue().map((op) => op.id)).toEqual(['exec-2']);
  });
});

// --- « Annuler la séance » et quarantaine (relecture Codex du lot 2) --------
//
// La purge ciblée d'une exécution abandonnée retire aussi ses entrées de
// quarantaine (pour le compte reconnu) : elles n'ont plus d'objet et
// bloqueraient la Déconnexion. Et une réponse de flush encore en vol ne remet
// pas en quarantaine une op que l'annulation vient de retirer de la file.

describe('purgeByExecution et quarantaine', () => {
  const compteA = { userId: 'user-a', email: 'a@exemple.com' };
  const compteB = { userId: 'user-b', email: 'b@exemple.com' };

  it('retire les entrées de quarantaine de l’exécution abandonnée, pas les autres', async () => {
    saveLocalAccount(compteA);
    enqueue(execOp('exec-abandon'));
    enqueue(setOp('set-1', 1, 'exec-abandon'));
    enqueue({ type: 'updateExecution', id: 'exec-abandon', closedAt: '2026-06-18T10:00:00Z' });
    enqueue(setOp('set-autre', 1, 'exec-autre'));
    const fns = okFns();
    fns.upsertExecution = vi.fn(async () => {
      throw rejet('23503');
    });
    fns.insertSet = vi.fn(async (op: InsertSetOp) => {
      if (op.id === 'set-autre') throw rejet('23503');
    });
    await flush(fns, async () => 'user-a');
    expect(readQuarantine().map((q) => q.op.id)).toEqual([
      'exec-abandon',
      'set-1',
      'exec-abandon',
      'set-autre',
    ]);

    purgeByExecution('exec-abandon');

    expect(readQuarantine().map((q) => q.op.id)).toEqual(['set-autre']);
    expect(heldCount()).toBe(1);
  });

  it('ne touche pas la quarantaine d’un AUTRE compte pour la même exécution', async () => {
    saveLocalAccount(compteB);
    enqueue(setOp('set-b', 1, 'exec-1'));
    const fns = okFns();
    fns.insertSet = vi.fn(async () => {
      throw rejet('23503');
    });
    await flush(fns, async () => 'user-b');
    saveLocalAccount(compteA);

    purgeByExecution('exec-1');

    expect(readQuarantine().map((q) => q.op.id)).toEqual(['set-b']);
  });

  it('rejet reçu APRÈS l’annulation de la séance : l’op retirée de la file ne part pas en quarantaine', async () => {
    enqueue(setOp('set-1', 1, 'exec-abandon'));
    enqueue({ type: 'deleteSet', id: 'set-9' });
    const fns = okFns();
    fns.insertSet = vi.fn(async () => {
      // Pendant la requête, l'utilisateur annule la séance.
      purgeByExecution('exec-abandon');
      throw rejet('23503');
    });

    const res = await flush(fns);

    expect(quarantineCount()).toBe(0);
    // La passe continue sur ce qui reste.
    expect(fns.deleteSet).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ remaining: 0, flushed: 1 });
  });
});


// --- Saisies refusées : lister, renvoyer, abandonner --------------------------

describe('saisies refusées (quarantaine) : lister, renvoyer, abandonner', () => {
  const rejection = { code: '23514', message: 'rejet de la base', details: '', hint: '' };

  beforeEach(() => {
    saveLocalAccount({ userId: 'user-1', email: 'toi@exemple.com' });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  /** Une série refusée par la base, puis une série acceptée derrière elle. */
  async function refuseOneSet(): Promise<SyncFns & { calls: () => OutboxOp[] }> {
    enqueue(execOp());
    enqueue(setOp('set-refuse', 1));
    enqueue(setOp('set-ok', 2));
    const fns = okFns();
    (fns.insertSet as ReturnType<typeof vi.fn>).mockImplementation(async (op: InsertSetOp) => {
      if (op.id === 'set-refuse') throw rejection;
    });
    await flush(fns);
    return fns;
  }

  it('liste les saisies refusées avec leur raison et une identité', async () => {
    await refuseOneSet();

    const refused = listRefused();
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({ reason: '23514 : rejet de la base' });
    expect(refused[0]?.op).toMatchObject({ type: 'insertSet', id: 'set-refuse' });
    expect(typeof refused[0]?.refusalId).toBe('string');
  });

  it('renvoyer : la saisie repart en file et passe si la base l’accepte', async () => {
    await refuseOneSet();
    const [refused] = listRefused();

    expect(retryRefused(refused!.refusalId)).toBe(true);
    expect(quarantineCount()).toBe(0);
    expect(readQueue().map((op) => op.id)).toEqual(['set-refuse']);

    const fns = okFns();
    expect(await flush(fns)).toEqual({ remaining: 0, flushed: 1 });
    expect(fns.calls().map((op) => op.id)).toEqual(['set-refuse']);
  });

  it('renvoyer une saisie que la base refuse encore : elle revient en quarantaine', async () => {
    const fns = await refuseOneSet();

    retryRefused(listRefused()[0]!.refusalId);
    await flush(fns);

    expect(readQueue()).toEqual([]);
    expect(listRefused().map((q) => q.op.id)).toEqual(['set-refuse']);
  });

  it('abandonner : la saisie quitte la quarantaine sans jamais partir', async () => {
    await refuseOneSet();

    expect(abandonRefused(listRefused()[0]!.refusalId)).toBe(true);

    expect(quarantineCount()).toBe(0);
    expect(readQueue()).toEqual([]);
    expect(heldCount()).toBe(0);
  });

  it('identité inconnue : rien ne bouge', async () => {
    await refuseOneSet();

    expect(retryRefused('inconnue')).toBe(false);
    expect(abandonRefused('inconnue')).toBe(false);
    expect(quarantineCount()).toBe(1);
  });

  it('renvoyer une exécution refusée renvoie avec elle les saisies qui en dépendaient, dans l’ordre', async () => {
    enqueue(execOp('exec-refusee'));
    enqueue(setOp('s1', 1, 'exec-refusee'));
    enqueue(setOp('s2', 2, 'exec-refusee'));
    enqueue({ type: 'updateExecution', id: 'exec-refusee', closedAt: '2026-11-23T10:00:00Z' });
    const fns = okFns();
    (fns.upsertExecution as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      throw rejection;
    });
    await flush(fns);
    expect(quarantineCount()).toBe(4);
    const parent = listRefused().find((q) => q.op.type === 'upsertExecution')!;

    expect(retryRefused(parent.refusalId)).toBe(true);

    expect(quarantineCount()).toBe(0);
    expect(readQueue().map((op) => `${op.type}:${op.id}`)).toEqual([
      'upsertExecution:exec-refusee',
      'insertSet:s1',
      'insertSet:s2',
      'updateExecution:exec-refusee',
    ]);
    expect(await flush(fns)).toEqual({ remaining: 0, flushed: 4 });
  });

  it('les saisies refusées d’un autre compte ne sont ni listées, ni renvoyées, ni abandonnées', async () => {
    await refuseOneSet();
    const id = listRefused()[0]!.refusalId;
    saveLocalAccount({ userId: 'user-2', email: 'autre@exemple.com' });

    expect(listRefused()).toEqual([]);
    expect(retryRefused(id)).toBe(false);
    expect(abandonRefused(id)).toBe(false);
    expect(quarantineCount()).toBe(1);
  });
});

// --- Ce que l'appareil retient, par compte ------------------------------------

describe('écritures retenues par compte (heldCounts, clearOwnQueue)', () => {
  const foreignOp = { type: 'deleteSet', id: 'serie-de-b', _owner: 'user-b', _uid: 'uid-b' };
  const foreignRefused = {
    op: { type: 'deleteSet', id: 'refus-de-b', _owner: 'user-b', _uid: 'uid-b2' },
    reason: '23503 : rejet',
    at: '2026-11-22T10:00:00Z',
  };

  beforeEach(() => {
    saveLocalAccount({ userId: 'user-a', email: 'a@exemple.com' });
    // Le compte B a laissé une saisie en file et une saisie refusée.
    localStorage.setItem('croustylift:outbox', JSON.stringify([foreignOp]));
    localStorage.setItem('croustylift:outbox:quarantine', JSON.stringify([foreignRefused]));
  });

  it('sépare ce qui est au compte reconnu de ce qui est à un autre', () => {
    enqueue(execOp());

    expect(heldCounts()).toEqual({ own: 1, ownRefused: 0, foreign: 2 });
    // Le compteur global, lui, compte toujours tout.
    expect(heldCount()).toBe(3);
  });

  it('une op sans compte (bundle antérieur) est tenue pour celle du compte reconnu', () => {
    localStorage.setItem(
      'croustylift:outbox',
      JSON.stringify([foreignOp, { type: 'deleteSet', id: 'heritee', _seq: 1 }]),
    );

    expect(heldCounts()).toEqual({ own: 1, ownRefused: 0, foreign: 2 });
  });

  it('la purge de la Déconnexion ne jette que ses propres écritures, jamais celles d’un autre', () => {
    enqueue(execOp());
    enqueue(setOp('s1', 1));

    clearOwnQueue();

    expect(readQueue()).toEqual([foreignOp]);
    expect(readQuarantine()).toEqual([foreignRefused]);
    expect(heldCounts()).toEqual({ own: 0, ownRefused: 0, foreign: 2 });
  });

  it('seul le forçage (clearQueue) jette tout', () => {
    clearQueue();
    expect(heldCount()).toBe(0);
  });
});

describe('mergeByEnqueueTime (écritures en mémoire replacées à leur instant)', () => {
  const at = (id: string, _at?: number): OutboxOp => ({ type: 'deleteSet', id, ...(_at === undefined ? {} : { _at }) });
  const ids = (ops: OutboxOp[]) => ops.map((op) => op.id);
  /** Op portant son identité d'enfilement (clé de `seenBefore`), avec ou sans instant. */
  const uid = (id: string, _at?: number): OutboxOp => ({ ...at(id, _at), _uid: id });

  it('rien en mémoire : la file persistée telle quelle', () => {
    const persisted = [at('p1', 10), at('p2', 20)];
    expect(mergeByEnqueueTime(persisted, [])).toBe(persisted);
  });

  it('une écriture en mémoire passe avant la première persistée plus récente', () => {
    expect(ids(mergeByEnqueueTime([at('p1', 10), at('p3', 30)], [at('m2', 20)]))).toEqual(['p1', 'm2', 'p3']);
  });

  it('plus récente que toute la file persistée : en fin, comme avant', () => {
    expect(ids(mergeByEnqueueTime([at('p1', 10), at('p2', 20)], [at('m3', 30), at('m4', 40)]))).toEqual([
      'p1',
      'p2',
      'm3',
      'm4',
    ]);
  });

  it('à instant égal, la persistée d’abord', () => {
    expect(ids(mergeByEnqueueTime([at('p', 20)], [at('m', 20)]))).toEqual(['p', 'm']);
  });

  it('chaque liste garde son ordre interne (exécution avant ses séries)', () => {
    const merged = mergeByEnqueueTime([at('p1', 10), at('p4', 40)], [at('m2', 20), at('m3', 30), at('m5', 50)]);
    expect(ids(merged)).toEqual(['p1', 'm2', 'm3', 'p4', 'm5']);
  });

  it('ops sans instant, sans mémoire de la file : persistée, tenue pour plus ancienne ; en mémoire, laissée en fin', () => {
    expect(ids(mergeByEnqueueTime([at('vieille'), at('p2', 20)], [at('m1', 10)]))).toEqual(['vieille', 'm1', 'p2']);
    expect(ids(mergeByEnqueueTime([at('p1', 10), at('p2', 20)], [at('sans-instant'), at('m0', 5)]))).toEqual([
      'p1',
      'p2',
      'sans-instant',
      'm0',
    ]);
  });

  it('op persistée sans instant : plus ancienne si la file la portait déjà, plus récente si elle est apparue depuis', () => {
    // `m` est entrée en mémoire quand la file portait `vieille` seulement.
    const seen = new Map([['m', new Set(['vieille'])]]);
    const merged = mergeByEnqueueTime([uid('vieille'), uid('apparue-depuis')], [uid('m', 10)], seen);
    expect(ids(merged)).toEqual(['vieille', 'm', 'apparue-depuis']);
  });

  it('entre deux ops datées, l’instant décide toujours, même avec la mémoire de la file', () => {
    const seen = new Map([['m', new Set<string>()]]);
    expect(ids(mergeByEnqueueTime([uid('p', 5)], [uid('m', 10)], seen))).toEqual(['p', 'm']);
    expect(ids(mergeByEnqueueTime([uid('p', 20)], [uid('m', 10)], seen))).toEqual(['m', 'p']);
  });

  it('op en mémoire sans instant (complétée au démarrage) : après ce que la file portait, avant ce qui est apparu depuis', () => {
    const seen = new Map([['sans-instant', new Set(['p1'])]]);
    const merged = mergeByEnqueueTime([uid('p1', 10), uid('p2', 20)], [uid('sans-instant')], seen);
    expect(ids(merged)).toEqual(['p1', 'sans-instant', 'p2']);
  });
});
