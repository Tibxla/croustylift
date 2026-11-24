// Deux ONGLETS sur le même registre (relecture Codex du lot 3A) : deux instances
// du module `outbox`, un seul stockage partagé, comme deux onglets du navigateur.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { OutboxOp, SyncFns } from './outbox';

import { otherTabRewrites, storedPendingIds } from '../../test/registry';

type Outbox = typeof import('./outbox');

/** Stockage partagé, énumérable, dont l'écriture de la file peut être refusée. */
class SharedStorage {
  store = new Map<string, string>();
  /** Refuse l'écriture de la file (quota plein). */
  full = false;
  getItem(k: string): string | null {
    return this.store.has(k) ? (this.store.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    if (this.full && k.startsWith('croustylift:registre')) throw new Error('QuotaExceededError');
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

let storage: SharedStorage;

/** Une instance neuve du module : un onglet, avec sa mémoire propre. */
async function openTab(): Promise<Outbox> {
  vi.resetModules();
  return import('./outbox');
}

const setOp = (id: string): OutboxOp => ({
  type: 'insertSet',
  id,
  executionId: 'exec-1',
  exerciseId: 'bench',
  setOrder: 1,
  weightKg: 80,
  reps: 8,
  rir: 2,
});

/** SyncFns qui notent ce qui part, avec un `insertSet` remplaçable. */
function recorder(insertSet?: (op: OutboxOp) => Promise<void>): { fns: SyncFns; sent: string[] } {
  const sent: string[] = [];
  const ok = async (op: { id: string }) => void sent.push(op.id);
  const fns = {
    upsertExecution: ok,
    insertSet: insertSet ?? ok,
    patchSet: ok,
    deleteSet: ok,
    updateExecution: ok,
    upsertDatedNote: ok,
    deleteDatedNote: ok,
    upsertExerciseNote: ok,
    deleteExerciseNote: ok,
    deleteExecution: ok,
    deleteExecutionIfEmpty: ok,
  } as unknown as SyncFns;
  return { fns, sent };
}

/** Laisse tourner promesses et verrous jusqu'à ce que `ready` soit vrai. */
async function until(ready: () => boolean): Promise<void> {
  for (let i = 0; i < 50 && !ready(); i += 1) await vi.advanceTimersByTimeAsync(0);
  if (!ready()) throw new Error('condition jamais atteinte');
}

/** Les écritures EN ATTENTE que l'appareil porte (enregistrement et boîte d'entrée). */
const persistedIds = () => storedPendingIds(storage);

beforeEach(() => {
  storage = new SharedStorage();
  (globalThis as unknown as { localStorage: Storage }).localStorage = storage as unknown as Storage;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('stockage plein dans un onglet, écritures d’un autre onglet', () => {
  it('le repli mémoire de A n’efface pas la série persistée entre-temps par B', async () => {
    const a = await openTab();
    const b = await openTab();
    // A persiste S0, puis le stockage refuse S1 : A la tient en mémoire.
    a.enqueue(setOp('S0'));
    storage.full = true;
    a.enqueue(setOp('S1'));
    expect(a.storageFailing()).toBe(true);
    // B envoie S0, la place revient, B persiste S2.
    storage.full = false;
    const tabB = recorder();
    await b.flush(tabB.fns);
    expect(tabB.sent).toEqual(['S0']);
    b.enqueue(setOp('S2'));
    expect(persistedIds()).toEqual(['S2']);

    // A reprend la synchro : il voit S2 (file relue) et sa propre S1.
    expect(a.readQueue().map((op) => op.id).sort()).toEqual(['S1', 'S2']);
    const tabA = recorder();
    await a.flush(tabA.fns);

    // Avant : A réécrivait la file depuis son miroir, S2 disparaissait sans
    // jamais avoir été envoyée. S0, déjà envoyée par B, ne repart pas.
    expect(tabA.sent.sort()).toEqual(['S1', 'S2']);
    expect(persistedIds()).toEqual([]);
    expect(a.storageFailing()).toBe(false);
  });

  it('une écriture ancienne tenue en mémoire par A part AVANT la correction persistée ensuite par B', async () => {
    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const a = await openTab();
    const b = await openTab();
    const note = (body: string): OutboxOp => ({ type: 'upsertExerciseNote', id: 'bench', body });

    // Stockage plein : A garde l'ancienne note en mémoire.
    storage.full = true;
    a.enqueue(note('ancienne'));
    // Plus tard, la place revient et B persiste la correction de la même note.
    now = 2_000;
    storage.full = false;
    b.enqueue(note('corrigée'));
    expect(persistedIds()).toEqual(['bench']);

    // A relit la file : son écriture, plus ancienne, précède celle de B.
    const bodies = (ops: OutboxOp[]) =>
      ops.map((op) => (op.type === 'upsertExerciseNote' ? op.body : op.type));
    expect(bodies(a.readQueue())).toEqual(['ancienne', 'corrigée']);

    // Et c'est dans cet ordre qu'elles partent : la correction est la dernière
    // écrite en base. Avant, A envoyait la file persistée puis sa mémoire, et
    // l'ancienne note écrasait la correction.
    const sent: string[] = [];
    const fns = {
      ...recorder().fns,
      upsertExerciseNote: async (op: { body: string }) => void sent.push(op.body),
    } as unknown as SyncFns;
    await a.flush(fns);
    expect(sent).toEqual(['ancienne', 'corrigée']);
    expect(persistedIds()).toEqual([]);
  });

  it('pendant un déploiement : la correction d’un ANCIEN onglet (sans instant) arrivée après part après', async () => {
    const a = await openTab(); // onglet à jour
    const note = (body: string): OutboxOp => ({ type: 'upsertExerciseNote', id: 'bench', body });
    /** Ce qu'écrit un onglet resté sur l'ancien bundle : ni `_at` ni `_uid`. */
    const oldTabAppends = (op: OutboxOp, seq: number) => {
      const queue = JSON.parse(storage.getItem('croustylift:outbox') ?? '[]') as OutboxOp[];
      storage.store.set('croustylift:outbox', JSON.stringify([...queue, { ...op, _seq: seq }]));
    };

    // Une écriture de l'ancien onglet est DÉJÀ en file : elle est plus ancienne.
    oldTabAppends({ type: 'deleteSet', id: 'deja-la' }, 1);
    // Stockage plein : l'onglet à jour garde sa note en mémoire.
    storage.full = true;
    a.enqueue(note('gardée en mémoire'));
    expect(a.storageFailing()).toBe(true);
    // La place revient ; l'ancien onglet enregistre ENSUITE sa correction.
    storage.full = false;
    oldTabAppends(note('corrigée par l’ancien onglet'), 2);

    const label = (op: OutboxOp) => (op.type === 'upsertExerciseNote' ? op.body : op.id);
    expect(a.readQueue().map(label)).toEqual([
      'deja-la',
      'gardée en mémoire',
      'corrigée par l’ancien onglet',
    ]);

    // Elles partent dans cet ordre : la correction, plus récente, est la
    // dernière écrite. Avant, sans instant, elle passait pour plus ancienne que
    // tout, partait d'abord, et la note gardée en mémoire l'écrasait.
    const sent: string[] = [];
    const fns = {
      ...recorder().fns,
      upsertExerciseNote: async (op: { body: string }) => void sent.push(op.body),
    } as unknown as SyncFns;
    await a.flush(fns);
    expect(sent).toEqual(['gardée en mémoire', 'corrigée par l’ancien onglet']);
    expect(persistedIds()).toEqual([]);
  });

  it('un retrait tenu en mémoire par A ne réécrit pas la file : la série de B reste', async () => {
    const a = await openTab();
    const b = await openTab();
    a.enqueue(setOp('S0'));
    a.enqueue(setOp('S1'));
    // Le stockage refuse le retrait de S0 après son envoi par A.
    storage.full = true;
    const tabA = recorder(async (op) => {
      if (op.id === 'S1') throw new Error('offline');
    });
    await a.flush(tabA.fns);
    expect(a.readQueue().map((op) => op.id)).toEqual(['S1']);
    // B, lui, peut écrire : il ajoute S2 à la file persistée.
    storage.full = false;
    b.enqueue(setOp('S2'));

    // A relit : S0 reste retirée pour lui, S1 et S2 sont là.
    expect(a.readQueue().map((op) => op.id)).toEqual(['S1', 'S2']);
  });
});

describe('verrou de flush occupé par un autre onglet', () => {
  it('la file de B n’attend pas une autre saisie : un nouvel essai part seul quand A a libéré le verrou', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const a = await openTab();
    const b = await openTab();
    a.enqueue(setOp('S0'));
    // A tient le verrou pendant sa requête, qui finira par échouer (transitoire).
    let failA!: () => void;
    const tabA = recorder(
      () => new Promise<void>((_resolve, reject) => (failA = () => reject(new Error('offline')))),
    );
    const flushA = a.flush(tabA.fns);
    await until(() => typeof failA === 'function');
    // B logge sa dernière série : verrou pris, rien ne part.
    b.enqueue(setOp('S1'));
    const tabB = recorder();
    expect(await b.flush(tabB.fns)).toMatchObject({ remaining: 2, flushed: 0 });
    expect(tabB.sent).toEqual([]);

    // La requête de A échoue, A libère le verrou. Aucune nouvelle saisie dans B.
    failA();
    await flushA;
    await vi.advanceTimersByTimeAsync(1000);

    // Avant : B n'avait aucun réveil planifié, sa file attendait indéfiniment.
    expect(tabB.sent).toEqual(['S0', 'S1']);
    expect(persistedIds()).toEqual([]);
  });

  it('tant que le verrou reste pris, les essais s’espacent (pas de boucle serrée)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const a = await openTab();
    const b = await openTab();
    a.enqueue(setOp('S0'));
    const tabA = recorder();
    let holding = false;
    const gate: { release: (() => void) | null } = { release: null };
    // La première requête de A pend (verrou tenu) ; les suivantes passent.
    tabA.fns.insertSet = () => {
      if (holding) return Promise.resolve();
      holding = true;
      return new Promise<void>((resolve) => (gate.release = resolve));
    };
    const flushA = a.flush(tabA.fns);
    await until(() => holding);
    b.enqueue(setOp('S1'));
    await b.flush(recorder().fns);
    const lockRequests = vi.spyOn(navigator.locks, 'request');

    await vi.advanceTimersByTimeAsync(10_000);

    // 0,5 s, 1 s, 2 s, 4 s : quatre essais en dix secondes, pas des centaines.
    expect(lockRequests.mock.calls.length).toBe(4);
    // Le verrou du navigateur est commun au processus de test : on le rend.
    lockRequests.mockRestore();
    gate.release?.();
    await flushA;
    await vi.advanceTimersByTimeAsync(60_000);
  });

  it('flush long dans A : B réessaie plus d’une minute sans jamais écrire tant que A tient le verrou', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const a = await openTab();
    const b = await openTab();
    a.enqueue(setOp('S0'));
    const tabA = recorder();
    let holding = false;
    const gate: { release: (() => void) | null } = { release: null };
    // La requête de A dure (réseau lent) : A tient le verrou tout ce temps.
    tabA.fns.insertSet = (op) => {
      if (holding) {
        tabA.sent.push(op.id);
        return Promise.resolve();
      }
      holding = true;
      return new Promise<void>((resolve) => {
        gate.release = () => {
          tabA.sent.push(op.id);
          resolve();
        };
      });
    };
    const flushA = a.flush(tabA.fns);
    await until(() => holding);
    b.enqueue(setOp('S1'));
    const tabB = recorder();
    await b.flush(tabB.fns);
    const lockRequests = vi.spyOn(navigator.locks, 'request');

    // Deux minutes d'essais automatiques dans B.
    await vi.advanceTimersByTimeAsync(120_000);

    // B a réessayé (avec des attentes qui s'allongent), sans jamais reprendre le
    // verrou ni rien envoyer : avant, passé une minute, il le volait et écrivait
    // en même temps que A.
    expect(lockRequests.mock.calls.length).toBeGreaterThan(4);
    expect(lockRequests.mock.calls.every(([, options]) => (options as { steal?: boolean }).steal !== true)).toBe(true);
    expect(tabB.sent).toEqual([]);
    expect(persistedIds()).toEqual(['S0', 'S1']);

    // A finit : c'est lui qui envoie, dans l'ordre, y compris la série de B.
    lockRequests.mockRestore();
    gate.release?.();
    await flushA;
    expect(tabA.sent).toEqual(['S0', 'S1']);
    expect(persistedIds()).toEqual([]);
    await vi.advanceTimersByTimeAsync(60_000);
  });

  it('file vidée entre-temps (l’autre onglet a tout envoyé) : plus d’essai planifié', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const a = await openTab();
    const b = await openTab();
    a.enqueue(setOp('S0'));
    let succeedA!: () => void;
    const tabA = recorder(() => new Promise<void>((resolve) => (succeedA = resolve)));
    const flushA = a.flush(tabA.fns);
    await until(() => typeof succeedA === 'function');
    const tabB = recorder();
    await b.flush(tabB.fns);
    succeedA();
    await flushA;
    const lockRequests = vi.spyOn(navigator.locks, 'request');

    await vi.advanceTimersByTimeAsync(5_000);

    expect(tabB.sent).toEqual([]);
    // Un seul réveil, qui trouve la file vide et ne redemande pas le verrou.
    expect(lockRequests.mock.calls.length).toBe(0);
  });
});

// Constat 2 de la relecture contradictoire : `localStorage` n'a pas de verrou
// entre processus. L'onglet A lit le registre pour acquitter une série, l'onglet
// B enfile au même instant, puis A écrit son brouillon, d'avant la saisie de B.
describe('enfilement dans un onglet pendant l’acquittement dans l’autre', () => {
  it('la saisie de B survit à l’écriture, périmée, de A', async () => {
    const a = await openTab();
    const b = await openTab();
    a.enqueue(setOp('S0'));
    const tabA = recorder();
    await a.flush(tabA.fns); // S0 est au registre, acquittée
    a.enqueue(setOp('S1'));
    // Au moment précis où A écrit le registre (acquittement de S1), B enfile S2 :
    // l'écriture de A, préparée avant, ne la contient pas.
    const setItem = storage.setItem.bind(storage);
    let interleaved = false;
    storage.setItem = (k: string, v: string) => {
      if (k.startsWith('croustylift:registre') && !interleaved && v.includes('"acked"') && v.includes('S1')) {
        interleaved = true;
        b.enqueue(setOp('S2'));
      }
      setItem(k, v);
    };

    await a.flush(tabA.fns);
    storage.setItem = setItem;

    expect(interleaved).toBe(true);
    // S2 n'a pas été écrasée : elle est partie (ici, la passe de A l'a reprise
    // en relisant le registre), une seule fois, et plus rien n'attend.
    const tabB = recorder();
    await b.flush(tabB.fns);
    expect([...tabA.sent, ...tabB.sent].filter((id) => id === 'S2')).toEqual(['S2']);
    expect(b.readQueue()).toEqual([]);
    expect(persistedIds()).toEqual([]);
  });

  it('un geste est UNE écriture de l’appareil, dans une clé que personne d’autre ne réécrit', async () => {
    const a = await openTab();
    const writes: string[] = [];
    const setItem = storage.setItem.bind(storage);
    storage.setItem = (k: string, v: string) => {
      writes.push(k);
      setItem(k, v);
    };
    a.enqueueAll([setOp('S1'), setOp('S2')]);
    storage.setItem = setItem;

    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatch(/^croustylift:registre:in:/);
    expect(a.readQueue().map((op) => op.id)).toEqual(['S1', 'S2']);
  });
});

describe('troisième tour : une saisie reste lisible pendant son transfert de la boîte d’entrée au registre', () => {
  /**
   * Joue `read` dans l'onglet A pendant que l'onglet B fait entrer la saisie
   * au registre (écriture de l'enregistrement, puis effacement de la clé),
   * juste avant le `at`-ième accès de A au stockage. Rend faux quand `read`
   * fait moins de `at` accès : toutes les positions ont été essayées.
   */
  async function duringTransfer(at: number, read: (a: Outbox, uid: string) => void): Promise<boolean> {
    storage = new SharedStorage();
    (globalThis as unknown as { localStorage: Storage }).localStorage = storage as unknown as Storage;
    const a = await openTab();
    const b = await openTab();
    const [uid] = b.enqueueAll([setOp('S1')]);
    let accesses = 0;
    let moved = false;
    const transfer = () => {
      accesses += 1;
      if (moved || accesses !== at) return;
      moved = true;
      // Ce que fait la passe de B sous le verrou : la saisie entre à
      // l'enregistrement, sa clé de la boîte d'entrée disparaît.
      otherTabRewrites((writes) => writes, storage);
    };
    const getItem = storage.getItem.bind(storage);
    const key = storage.key.bind(storage);
    storage.getItem = (k: string) => (transfer(), getItem(k));
    storage.key = (i: number) => (transfer(), key(i));
    read(a, uid!);
    storage.getItem = getItem;
    storage.key = key;
    return moved;
  }

  it('son sort ne passe jamais par « disparue » : la sauvegarde n’est pas annoncée trop tôt', async () => {
    let positions = 0;
    for (let at = 1; ; at += 1) {
      let fate: string | undefined;
      const moved = await duringTransfer(at, (a, uid) => void ([fate] = a.fatesOf([uid])));
      if (!moved) break;
      positions += 1;
      expect(`${at}:${fate}`).toBe(`${at}:pending`);
    }
    expect(positions).toBeGreaterThan(1);
  });

  it('« Annuler la séance » pendant le transfert : la saisie de la séance est bien retirée', async () => {
    let positions = 0;
    for (let at = 1; ; at += 1) {
      let a: Outbox | undefined;
      const moved = await duringTransfer(at, (tab) => {
        a = tab;
        tab.purgeByExecution('exec-1');
      });
      if (!moved) break;
      positions += 1;
      expect(`${at}:${a!.readQueue().map((op) => op.id).join()}`).toBe(`${at}:`);
      // L'écriture sur l'appareil suit, sous le verrou.
      await vi.waitFor(() => expect(`${at}:${persistedIds().join()}`).toBe(`${at}:`));
    }
    expect(positions).toBeGreaterThan(1);
  });
});

describe('relecture entière : le journal de secours d’un onglet ne défait pas ce qu’un autre a écrit', () => {
  it('A tient un refus en mémoire, B envoie la même saisie et l’acquitte : elle reste acquittée', async () => {
    const a = await openTab();
    const b = await openTab();
    const [uid] = a.enqueueAll([setOp('S1')]);
    // Le registre ne peut pas être écrit : le refus de A ne tient qu'en mémoire.
    const setItem = storage.setItem.bind(storage);
    storage.setItem = (k: string, v: string) => {
      if (k === 'croustylift:registre') throw new Error('QuotaExceededError');
      setItem(k, v);
    };
    const refusing = recorder(async () => {
      throw Object.assign(new Error('rejet'), { code: '42501' });
    });
    await a.flush(refusing.fns);
    expect(a.fatesOf([uid!])).toEqual(['refused']);
    // La place revient, la base accepte : B envoie la saisie et l'écrit acquittée.
    storage.setItem = setItem;
    const tabB = recorder();
    await b.flush(tabB.fns);
    expect(tabB.sent).toEqual(['S1']);
    expect(b.fatesOf([uid!])).toEqual(['acked']);

    // A repasse : son journal ne doit pas ramener le refus.
    await a.flush(recorder().fns);

    expect(b.fatesOf([uid!])).toEqual(['acked']);
    expect(a.listRefused()).toEqual([]);
  });
});
