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
  purgeByExecution,
  type SyncFns,
  type OutboxOp,
  type InsertSetOp,
} from './outbox';

// La file persistée porte un `_seq` interne (identité de file, cf. outbox.ts) : on
// le retire pour comparer la FORME MÉTIER des ops par égalité profonde (toEqual).
const queueNoSeq = () => readQueue().map(({ _seq, ...op }) => op);

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
