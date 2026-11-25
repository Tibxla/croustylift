// LE REGISTRE D'ÉCRITURES (outbox.ts), par son interface : ce que le format v1
// apporte en plus de la file d'avant (outbox.test.ts garde les règles d'envoi,
// de compte, de stockage plein et de purge).
//
//   - un seul enregistrement, versionné ; une version inconnue arrête tout ;
//   - la conversion de l'ancienne file et de l'ancienne quarantaine, puis la
//     reprise en continu de ce qu'un onglet de l'ancienne version y écrit ;
//   - le numéro d'écriture, qui ne recule jamais ;
//   - le sort de chaque écriture, rendu par la passe et suivi dans sa lignée ;
//   - la parenté : ce qui est retenu, ce qui part avec un renvoi ou un abandon ;
//   - la rétention des écritures acquittées.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  abandonRefused,
  adoptLegacyOps,
  clearOwnQueue,
  clearQueue,
  enqueue,
  enqueueAll,
  fatesOf,
  flush,
  hasUnpersistedOps,
  heldCounts,
  listRefused,
  pendingCount,
  purgeByExecution,
  readQueue,
  readStamp,
  registryOutdated,
  retryPersistQueue,
  retryRefused,
  storageFailing,
  writesSince,
  type OutboxOp,
  type SyncFns,
} from './outbox';
import { clearLocalAccount, saveLocalAccount } from '../../lib/local-account';
import { legacyQueueWrites, REGISTRY_KEY, registrySettled, storedWrites } from '../../test/registry';

class MemoryStorage {
  store = new Map<string, string>();
  getItem(k: string): string | null {
    return this.store.get(k) ?? null;
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

const LEGACY_QUEUE = 'croustylift:outbox';
const LEGACY_QUARANTINE = 'croustylift:outbox:quarantine';

beforeEach(() => {
  (globalThis as unknown as { localStorage: Storage }).localStorage = new MemoryStorage() as unknown as Storage;
  clearQueue();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const exec = (id = 'exec-1'): OutboxOp => ({ type: 'upsertExecution', id, seanceVersionId: 'v1', performedOn: '2026-11-24' });
const insert = (id: string, setOrder = 1, over: Record<string, unknown> = {}): OutboxOp =>
  ({ type: 'insertSet', id, executionId: 'exec-1', exerciseId: 'bench', setOrder, weightKg: 80, reps: 8, rir: 2, ...over }) as OutboxOp;
const correction = (id: string, weightKg: number): OutboxOp =>
  ({ type: 'patchSet', id, executionId: 'exec-1', exerciseId: 'bench', setOrder: 1, weightKg, reps: 8, rir: 2, only: 'values', cols: ['weightKg'] }) as OutboxOp;
const del = (id: string): OutboxOp => ({ type: 'deleteSet', id, exerciseIds: ['bench'] });

/** Fausse base : note ce qui part ; `refuses` rend un SQLSTATE pour refuser, `cuts` coupe le réseau. */
function base(options: { refuses?: (op: OutboxOp) => string | null; cuts?: (op: OutboxOp) => boolean } = {}) {
  const sent: string[] = [];
  /** Toutes les requêtes parties, acceptées ou non. */
  const tried: string[] = [];
  const run = async (op: OutboxOp) => {
    tried.push(`${op.type}:${op.id}`);
    if (options.cuts?.(op)) throw new TypeError('Failed to fetch');
    const code = options.refuses?.(op) ?? null;
    if (code !== null) throw Object.assign(new Error('rejet'), { code });
    sent.push(`${op.type}:${op.id}`);
  };
  return { sent, tried, fns: new Proxy({}, { get: () => run }) as SyncFns };
}

const refusal = (type: OutboxOp['type'], id: string) => listRefused().find((r) => r.op.type === type && r.op.id === id)!;

// --- Version de l'enregistrement ------------------------------------------------

describe('version inconnue : une version plus récente de l’app a écrit le registre', () => {
  const future = JSON.stringify({ v: 2, seq: 12, entries: [{ futur: true }], autre: 'champ inconnu' });

  beforeEach(() => {
    saveLocalAccount({ userId: 'user-1', email: 'toi@exemple.com' });
    localStorage.setItem(REGISTRY_KEY, future);
  });

  it('rien n’est envoyé, rien n’est modifié : l’enregistrement reste identique à l’octet', async () => {
    const b = base();
    enqueue(insert('s1'));
    await flush(b.fns);
    await retryRefused('x');
    await abandonRefused('x');
    adoptLegacyOps();
    clearOwnQueue();
    clearQueue();

    expect(b.sent).toEqual([]);
    expect(localStorage.getItem(REGISTRY_KEY)).toBe(future);
  });

  it('l’app le sait, pour demander de recharger ; ce n’est pas un stockage plein', () => {
    expect(registryOutdated()).toBe(true);
    enqueue(insert('s1'));
    // La saisie tient en mémoire, le temps de recharger.
    expect(readQueue().map((op) => op.id)).toEqual(['s1']);
    expect(storageFailing()).toBe(false);
    // Recharger est la seule issue : rien ne doit le retenir.
    expect(hasUnpersistedOps()).toBe(false);
  });

  it('l’ancienne file n’est ni convertie ni effacée', () => {
    const legacy = JSON.stringify([{ ...insert('vieille'), _uid: 'u1', _at: 1 }]);
    localStorage.setItem(LEGACY_QUEUE, legacy);
    adoptLegacyOps();
    expect(localStorage.getItem(LEGACY_QUEUE)).toBe(legacy);
    expect(localStorage.getItem(REGISTRY_KEY)).toBe(future);
  });

  it('un enregistrement de la version courante n’est pas « plus récent »', async () => {
    localStorage.removeItem(REGISTRY_KEY);
    enqueue(insert('s1'));
    await flush(base().fns);
    expect(registryOutdated()).toBe(false);
    expect(JSON.parse(localStorage.getItem(REGISTRY_KEY)!)).toMatchObject({ v: 1 });
  });
});

// --- Conversion de l'ancien format, puis reprise en continu ---------------------

describe('première ouverture : la file et la quarantaine de l’ancien format entrent au registre', () => {
  const owner = 'user-1';
  const legacyQueue = [
    { ...exec('exec-2'), _uid: 'q1', _owner: owner, _at: 3000, _seq: 3 },
    { ...insert('s9', 1, { executionId: 'exec-2' }), _uid: 'q2', _owner: owner, _at: 3001, _seq: 4 },
  ];
  const legacyQuarantine = [
    { op: { ...exec('exec-1'), _uid: 'r1', _owner: owner, _at: 1000 }, reason: '23503 : fk', at: '2026-11-23T10:00:00.000Z' },
    {
      op: { ...insert('s1'), _uid: 'r2', _owner: owner, _at: 1001 },
      reason: "dépend de l'exécution exec-1, en quarantaine",
      at: '2026-11-23T10:00:01.000Z',
    },
    { op: { ...insert('s5', 5, { executionId: 'exec-0' }), _uid: 'r3', _owner: owner, _at: 500 }, reason: '23514 : check', at: '2026-11-22T10:00:00.000Z' },
  ];

  beforeEach(() => {
    saveLocalAccount({ userId: owner, email: 'toi@exemple.com' });
    localStorage.setItem(LEGACY_QUEUE, JSON.stringify(legacyQueue));
    localStorage.setItem(LEGACY_QUARANTINE, JSON.stringify(legacyQuarantine));
  });

  it('d’un coup : chaque écriture garde son identité, son compte, son sort et sa place', async () => {
    adoptLegacyOps();
    await registrySettled();

    expect(storedWrites().map((w) => `${w.uid}:${w.fate}`)).toEqual([
      'r3:refused',
      'r1:refused',
      // Retenue par sa séance : elle redevient une écriture en attente, que sa
      // parenté retient (plus de motif écrit en clair).
      'r2:pending',
      'q1:pending',
      'q2:pending',
    ]);
    expect(storedWrites().every((w) => w.owner === owner)).toBe(true);
    // Le registre d'abord, les anciennes clés ensuite.
    expect(legacyQueueWrites()).toEqual([]);
    expect(localStorage.getItem(LEGACY_QUARANTINE)).toBeNull();
  });

  it('la saisie retenue par sa séance l’est toujours, et le registre dit par qui', () => {
    adoptLegacyOps();

    expect(readQueue().map((op) => op.id)).toEqual(['exec-2', 's9']);
    expect(heldCounts()).toEqual({ own: 5, ownRefused: 3, foreign: 0 });
    expect(refusal('insertSet', 's1')).toMatchObject({ heldBy: 'r1', reason: '', at: '2026-11-23T10:00:00.000Z' });
    expect(refusal('upsertExecution', 'exec-1').dependents).toMatchObject([{ type: 'insertSet', id: 's1' }]);
    expect(refusal('insertSet', 's5')).toMatchObject({ reason: '23514 : check', dependents: [] });
  });

  it('app arrêtée entre l’écriture du registre et l’effacement des anciennes clés : le registre fait foi, rien n’entre deux fois', async () => {
    // L'app meurt juste après l'écriture du registre : les anciennes clés ne
    // sont ni vidées ni effacées.
    const removeItem = localStorage.removeItem.bind(localStorage);
    const setItem = localStorage.setItem.bind(localStorage);
    let dead = true;
    localStorage.removeItem = (k: string) => {
      if (dead && k.startsWith(LEGACY_QUEUE)) throw new Error('arrêt de l’app');
      removeItem(k);
    };
    localStorage.setItem = (k: string, v: string) => {
      if (dead && k.startsWith(LEGACY_QUEUE)) throw new Error('arrêt de l’app');
      setItem(k, v);
    };
    adoptLegacyOps();
    await registrySettled();
    expect(legacyQueueWrites()).toHaveLength(2);
    expect(storedWrites()).toHaveLength(5);

    // Ouverture suivante.
    dead = false;
    adoptLegacyOps();
    await registrySettled();
    expect(storedWrites()).toHaveLength(5);
    expect(legacyQueueWrites()).toEqual([]);
    expect(localStorage.getItem(LEGACY_QUARANTINE)).toBeNull();

    const b = base();
    await flush(b.fns);
    expect(b.sent).toEqual(['upsertExecution:exec-2', 'insertSet:s9']);
  });

  it('stockage plein à la conversion : les anciennes clés restent la seule trace, rien n’est effacé', () => {
    const setItem = localStorage.setItem.bind(localStorage);
    localStorage.setItem = (k: string, v: string) => {
      if (k.startsWith(REGISTRY_KEY)) throw new Error('QuotaExceededError');
      setItem(k, v);
    };
    adoptLegacyOps();

    expect(localStorage.getItem(LEGACY_QUEUE)).toBe(JSON.stringify(legacyQueue));
    expect(localStorage.getItem(LEGACY_QUARANTINE)).toBe(JSON.stringify(legacyQuarantine));
    // La page les voit quand même, et les enverra.
    expect(readQueue().map((op) => op.id)).toEqual(['exec-2', 's9']);
  });
});

describe('ancien onglet : ce qu’il écrit encore dans les anciennes clés est repris en continu', () => {
  beforeEach(() => {
    saveLocalAccount({ userId: 'user-1', email: 'toi@exemple.com' });
    adoptLegacyOps();
  });
  /** Ce qu'écrit l'onglet resté sur l'ancienne version : sa file, dans sa clé. */
  const oldTabQueue = (...ops: (OutboxOp & { _uid: string; _at: number })[]) =>
    localStorage.setItem(LEGACY_QUEUE, JSON.stringify(ops.map((op) => ({ ...op, _owner: 'user-1' }))));

  it('visible tout de suite, puis entré au registre et envoyé à la passe suivante', async () => {
    oldTabQueue({ ...insert('vieux'), _uid: 'old-1', _at: Date.now() });
    expect(pendingCount()).toBe(1);

    const b = base();
    await flush(b.fns);

    expect(b.sent).toEqual(['insertSet:vieux']);
    expect(legacyQueueWrites()).toEqual([]);
  });

  it('une écriture de l’ancien onglet prend sa place par son instant : son insertion part AVANT la correction faite ici ensuite', async () => {
    const before = Date.now() - 10_000;
    // Ici, une correction de la série que l'ancien onglet a loggée plus tôt.
    enqueue(correction('s1', 90));
    oldTabQueue({ ...insert('s1'), _uid: 'old-1', _at: before });

    const b = base();
    await flush(b.fns);

    expect(b.sent).toEqual(['insertSet:s1', 'patchSet:s1']);
  });

  it('l’ancien onglet réécrit sa clé depuis une lecture d’avant : une écriture déjà acquittée ici ne repart pas', async () => {
    const op = { ...insert('vieux'), _uid: 'old-1', _at: Date.now() };
    oldTabQueue(op);
    const b = base();
    await flush(b.fns);
    expect(b.sent).toEqual(['insertSet:vieux']);

    // Sa copie périmée de la file revient, avec une écriture de plus.
    oldTabQueue(op, { ...insert('suivant', 2), _uid: 'old-2', _at: Date.now() });
    await flush(b.fns);

    expect(b.sent).toEqual(['insertSet:vieux', 'insertSet:suivant']);
  });

  it('une saisie que l’ancien onglet a vue refusée arrive parmi les refus', () => {
    localStorage.setItem(
      LEGACY_QUARANTINE,
      JSON.stringify([{ op: { ...insert('s1'), _uid: 'old-r', _owner: 'user-1', _at: 1 }, reason: '23514 : check', at: '2026-11-24T10:00:00.000Z' }]),
    );
    expect(listRefused().map((r) => r.refusalId)).toEqual(['old-r']);
  });

  it('pendant une passe, une écriture sans compte n’est attribuée à personne et ne part pas', async () => {
    localStorage.setItem(LEGACY_QUEUE, JSON.stringify([{ ...insert('sans-compte'), _uid: 'old-1', _at: Date.now() }]));
    // Un autre compte est arrivé entre-temps.
    saveLocalAccount({ userId: 'user-2', email: 'autre@exemple.com' });
    const b = base();

    await flush(b.fns, async () => 'user-2');

    expect(b.sent).toEqual([]);
    expect(storedWrites().map((w) => w.owner)).toEqual([undefined]);
  });
});

// --- Le numéro d'écriture -------------------------------------------------------

describe('le numéro d’écriture ne recule jamais', () => {
  it('croît à chaque enfilement et à chaque acquittement, même horloge figée', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const stamps = [readStamp()];
    enqueueAll([insert('s1'), insert('s2', 2)]);
    stamps.push(readStamp());
    await flush(base().fns);
    stamps.push(readStamp());

    expect(stamps[1]).toBeGreaterThan(stamps[0]!);
    expect(stamps[2]).toBeGreaterThan(stamps[1]!);
    expect(storedWrites().map((w) => w.n)).toEqual([...storedWrites().map((w) => w.n)].sort((a, b) => a - b));
  });

  it('une horloge qui recule ne fait pas reculer les numéros', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 5_000_000);
    enqueue(insert('s1'));
    now.mockReturnValue(1000);
    enqueue(insert('s2', 2));

    const [first, second] = storedWrites();
    expect(second!.n).toBeGreaterThan(first!.n);
  });

  it.each([
    ['forçage de purge', () => clearQueue()],
    ['Déconnexion', () => clearOwnQueue()],
    ['enregistrement illisible mis de côté', () => localStorage.setItem(REGISTRY_KEY, '{ cassé')],
    ['stockage vidé', () => localStorage.removeItem(REGISTRY_KEY)],
  ])('après %s : une estampille relevée avant reste sous les nouveaux numéros', async (_cas, reset) => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000_000);
    enqueueAll([insert('a'), insert('b', 2), insert('c', 3)]);
    await flush(base().fns);
    // Une lecture part : son estampille dépasse l'horloge (trois écritures et
    // trois acquittements dans la même milliseconde).
    const stamp = readStamp();

    reset();
    enqueue(insert('apres', 4));
    await flush(base().fns);

    // Acquittée APRÈS le départ de la lecture : elle doit lui être appliquée.
    expect(writesSince(stamp).map((w) => w.op.id)).toEqual(['apres']);
  });
});

// --- Le sort de chaque écriture ---------------------------------------------------

describe('la passe rend le sort de chaque écriture', () => {
  it('acquittée, refusée, écartée : dans l’ordre, avec les exos touchés en base', async () => {
    const uids = enqueueAll([exec(), insert('ok'), insert('refusee', 2), insert('depassee', 3), insert('depassee', 3, { weightKg: 85 })]);
    const b = base({ refuses: (op) => (op.id === 'refusee' || (op.id === 'depassee' && 'weightKg' in op && op.weightKg === 80) ? '23514' : null) });

    const result = await flush(b.fns);

    expect(result.settled.map((w) => `${w.op.id}:${w.fate}`)).toEqual([
      'exec-1:acked',
      'ok:acked',
      'refusee:refused',
      // Refusée, mais une réécriture complète de la même série la suit : pas gardée.
      'depassee:replaced',
      'depassee:acked',
    ]);
    expect(result.settled.map((w) => w.uid)).toEqual(uids);
    expect(result.settled[1]?.touches).toEqual(['bench']);
    expect(result.settled[0]?.touches).toEqual([]);
    expect(result).toMatchObject({ flushed: 3, remaining: 0 });
  });

  it('une suppression touche les exos que l’émetteur nomme et ceux que le registre retient pour cette série', async () => {
    enqueueAll([insert('s1', 1, { exerciseId: 'squat' })]);
    await flush(base().fns);
    enqueue({ type: 'deleteSet', id: 's1', exerciseIds: ['bench'] });

    const result = await flush(base().fns);

    expect(result.settled[0]?.touches.sort()).toEqual(['bench', 'squat']);
  });

  it('suppression conditionnelle que la base n’a pas faite : acquittée, sans effet, aucun exo touché', async () => {
    enqueue({ type: 'deleteExecutionIfEmpty', id: 'exec-1', exerciseIds: ['bench'] });
    const kept = new Proxy({}, { get: () => async () => 'kept' }) as SyncFns;

    const result = await flush(kept);

    expect(result.settled).toMatchObject([{ fate: 'acked', touches: [], noEffect: true }]);
  });

  it('`fatesOf` suit une écriture dans sa lignée : écartée, elle a le sort de sa remplaçante', async () => {
    const [first] = enqueueAll([insert('s1', 1, { weightKg: 9999 })]);
    const [second] = enqueueAll([insert('s1', 1, { weightKg: 85 })]);
    // La première est refusée ; le réseau tombe avant l'envoi de la seconde.
    await flush(base({ refuses: (op) => ('weightKg' in op && op.weightKg === 9999 ? '23514' : null), cuts: (op) => 'weightKg' in op && op.weightKg === 85 }).fns);

    expect(fatesOf([first!, second!])).toEqual(['pending', 'pending']);
    expect(listRefused()).toEqual([]);

    await flush(base().fns);
    expect(fatesOf([first!, second!])).toEqual(['acked', 'acked']);
    expect(fatesOf(['inconnue'])).toEqual(['gone']);
  });
});

// --- Parenté : retenir, renvoyer, abandonner --------------------------------------

describe('une séance refusée retient ses saisies, sans les envoyer', () => {
  it('séries, note datée et clôture sont retenues ; une suppression et une note d’instructions partent', async () => {
    enqueueAll([
      exec(),
      insert('s1'),
      { type: 'upsertDatedNote', id: 'n1', executionId: 'exec-1', exerciseId: 'bench', body: 'x' },
      { type: 'updateExecution', id: 'exec-1', closedAt: '2026-11-24T19:00:00Z' },
      del('ailleurs'),
      { type: 'upsertExerciseNote', id: 'bench', body: 'prise serrée' },
    ]);
    const b = base({ refuses: (op) => (op.type === 'upsertExecution' ? '23503' : null) });

    await flush(b.fns);

    expect(b.sent).toEqual(['deleteSet:ailleurs', 'upsertExerciseNote:bench']);
    expect(listRefused().map((r) => `${r.op.type}:${r.heldBy ? 'retenue' : 'refusée'}`)).toEqual([
      'upsertExecution:refusée',
      'insertSet:retenue',
      'upsertDatedNote:retenue',
      'updateExecution:retenue',
    ]);
    expect(pendingCount()).toBe(0);
  });

  it('la séance recréée avec succès : ses saisies retenues repartent seules, à leur place', async () => {
    enqueueAll([exec(), insert('s1')]);
    let refusing = true;
    const b = base({ refuses: (op) => (op.type === 'upsertExecution' && refusing ? '23503' : null) });
    await flush(b.fns);
    expect(refusal('insertSet', 's1').heldBy).toBeDefined();

    // Au remontage suivant, la Capture réaffirme l'exécution : cette fois elle passe.
    refusing = false;
    enqueueAll([exec(), insert('s2', 2)]);
    await flush(b.fns);

    expect(b.sent).toEqual(['upsertExecution:exec-1', 'insertSet:s1', 'insertSet:s2']);
    // L'ancien refus reste listé, sans effet, jusqu'à son abandon.
    expect(listRefused().map((r) => `${r.op.type}:${r.superseded ?? false}`)).toEqual(['upsertExecution:true']);
  });
});

describe('renvoyer', () => {
  it('une séance refusée repart avec ses saisies, dans l’ordre d’origine', async () => {
    enqueueAll([exec(), insert('s1'), insert('s2', 2)]);
    let refusing = true;
    const b = base({ refuses: (op) => (op.type === 'upsertExecution' && refusing ? '23503' : null) });
    await flush(b.fns);
    refusing = false;

    expect(await retryRefused(refusal('upsertExecution', 'exec-1').refusalId)).toBe('done');
    expect(listRefused()).toEqual([]);
    await flush(b.fns);

    expect(b.sent).toEqual(['upsertExecution:exec-1', 'insertSet:s1', 'insertSet:s2']);
  });

  it('une saisie retenue ne se renvoie pas seule ; une saisie acquittée ou inconnue non plus', async () => {
    const [, held] = enqueueAll([exec(), insert('s1')]);
    await flush(base({ refuses: (op) => (op.type === 'upsertExecution' ? '23503' : null) }).fns);

    expect(await retryRefused(held!)).toBe('gone');
    expect(await retryRefused('inconnue')).toBe('gone');
    expect(refusal('insertSet', 's1').heldBy).toBeDefined();
  });

  it('la saisie renvoyée garde sa place : la correction plus récente de la même série passe APRÈS elle', async () => {
    enqueue(insert('s3', 3, { weightKg: 9999 }));
    let refusing = true;
    const b = base({ refuses: (op) => (op.type === 'insertSet' && refusing ? '23514' : null) });
    await flush(b.fns);
    enqueue(correction('s3', 82.5));
    refusing = false;

    await retryRefused(refusal('insertSet', 's3').refusalId);
    await flush(b.fns);

    expect(b.sent).toEqual(['insertSet:s3', 'patchSet:s3']);
  });
});

describe('abandonner (Q5) : ce qui dépend de la saisie part avec elle', () => {
  it('le registre dit d’avance ce qui partira, pour que la feuille le dise', async () => {
    enqueue(insert('s3', 3, { weightKg: 9999 }));
    await flush(base({ refuses: () => '23514' }).fns);
    enqueue(correction('s3', 82.5));

    expect(refusal('insertSet', 's3').dependents).toMatchObject([{ type: 'patchSet', id: 's3', weightKg: 82.5 }]);
  });

  it('une série refusée emporte sa correction : elle ne part pas seule, à vide', async () => {
    enqueue(insert('s3', 3, { weightKg: 9999 }));
    await flush(base({ refuses: () => '23514' }).fns);
    const [fix] = enqueueAll([correction('s3', 82.5)]);

    expect(await abandonRefused(refusal('insertSet', 's3').refusalId)).toBe('done');

    expect(fatesOf([fix!])).toEqual(['gone']);
    expect(heldCounts().own).toBe(0);
    const b = base();
    await flush(b.fns);
    expect(b.sent).toEqual([]);
  });

  it('le début d’une séance emporte ses saisies retenues, et leurs corrections', async () => {
    enqueueAll([exec(), insert('s1'), correction('s1', 85), insert('autre', 1, { executionId: 'exec-2' })]);
    await flush(base({ refuses: (op) => (op.type === 'upsertExecution' ? '23503' : null), cuts: (op) => op.id === 'autre' }).fns);
    const parent = refusal('upsertExecution', 'exec-1');
    expect(parent.dependents.map((op) => `${op.type}:${op.id}`)).toEqual(['insertSet:s1', 'patchSet:s1']);

    await abandonRefused(parent.refusalId);

    // Ce qui ne dépend pas d'elle reste.
    expect(readQueue().map((op) => op.id)).toEqual(['autre']);
    expect(listRefused()).toEqual([]);
  });

  it('une saisie en attente ordinaire ne s’abandonne pas par ce geste', async () => {
    const [uid] = enqueueAll([insert('s1')]);
    expect(await abandonRefused(uid!)).toBe('gone');
    expect(pendingCount()).toBe(1);
  });
});

describe('une suppression efface un ancien refus (Q6)', () => {
  it('dès l’enfilement : plus rien à renvoyer pour cette série', async () => {
    enqueue(insert('s1', 1, { weightKg: 9999 }));
    await flush(base({ refuses: () => '23514' }).fns);
    expect(listRefused()).toHaveLength(1);

    enqueue(del('s1'));

    expect(listRefused()).toEqual([]);
    expect(readQueue().map((op) => op.type)).toEqual(['deleteSet']);
  });

  it('série retenue par sa séance, supprimée et suppression acquittée : le renvoi de la séance ne la recrée pas', async () => {
    enqueueAll([exec(), insert('s1')]);
    let refusing = true;
    const b = base({ refuses: (op) => (op.type === 'upsertExecution' && refusing ? '23503' : null) });
    await flush(b.fns);
    enqueue(del('s1'));
    await flush(b.fns);
    refusing = false;

    await retryRefused(refusal('upsertExecution', 'exec-1').refusalId);
    await flush(b.fns);

    expect(b.sent).toEqual(['deleteSet:s1', 'upsertExecution:exec-1']);
  });

  it('une insertion qui attend encore part quand même avant la suppression (sa requête est peut-être déjà en vol)', async () => {
    enqueueAll([insert('s1'), del('s1')]);
    const b = base();
    await flush(b.fns);
    expect(b.sent).toEqual(['insertSet:s1', 'deleteSet:s1']);
  });
});

describe('renvoyer et abandonner passent sous le verrou de la passe', () => {
  /** Un `navigator.locks` tenu par un autre onglet, qui n'honore que l'abandon de l'attente. */
  const heldElsewhere = () => ({
    request: (_name: string, options: { ifAvailable?: boolean; signal?: AbortSignal }, callback: (lock: object | null) => unknown) => {
      if (options.ifAvailable) return Promise.resolve(callback(null));
      return new Promise((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => reject(new DOMException('abandon', 'AbortError')));
      });
    },
  });

  it('verrou tenu trop longtemps par un autre onglet : le geste renonce, rien ne bouge', async () => {
    enqueue(insert('s1', 1, { weightKg: 9999 }));
    await flush(base({ refuses: () => '23514' }).fns);
    const id = listRefused()[0]!.refusalId;
    vi.useFakeTimers();
    vi.stubGlobal('navigator', { locks: heldElsewhere() });

    const retrying = retryRefused(id);
    const abandoning = abandonRefused(id);
    await vi.advanceTimersByTimeAsync(4000);

    expect(await retrying).toBe('busy');
    expect(await abandoning).toBe('busy');
    expect(listRefused().map((r) => r.refusalId)).toEqual([id]);
  });

  it('verrou libre : le geste demande bien le verrou de la passe, sans `ifAvailable`', async () => {
    enqueue(insert('s1', 1, { weightKg: 9999 }));
    await flush(base({ refuses: () => '23514' }).fns);
    const requests: { name: string; ifAvailable?: boolean }[] = [];
    vi.stubGlobal('navigator', {
      locks: {
        request: async (name: string, options: { ifAvailable?: boolean }, callback: (lock: object | null) => unknown) => {
          requests.push({ name, ifAvailable: options.ifAvailable });
          return callback({});
        },
      },
    });

    expect(await abandonRefused(listRefused()[0]!.refusalId)).toBe('done');
    expect(requests).toEqual([{ name: 'croustylift:outbox:flush', ifAvailable: undefined }]);
  });
});

// --- Rétention des écritures acquittées --------------------------------------------

describe('une écriture acquittée reste le temps qu’une lecture partie avant puisse revenir', () => {
  it('gardée dix minutes, puis retirée à la transition suivante', async () => {
    // Une horloge en avance sur tout ce que ce fichier a déjà numéroté : les
    // numéros suivent alors l'horloge, comme en vrai.
    let now = Date.now() + 1_000_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const stamp = readStamp();
    enqueue(insert('s1'));
    await flush(base().fns);

    now += 9 * 60 * 1000;
    enqueue(insert('s2', 2));
    expect(writesSince(stamp).map((w) => `${w.op.id}:${w.fate}`)).toEqual(['s1:acked', 's2:pending']);

    now += 2 * 60 * 1000;
    enqueue(insert('s3', 3));
    expect(writesSince(stamp).map((w) => w.op.id)).toEqual(['s2', 's3']);
  });

  it('au plus cinq cents : les plus anciennes cèdent', async () => {
    enqueueAll(Array.from({ length: 510 }, (_, i) => insert(`s${i}`, i + 1)));
    await flush(base().fns);

    const acked = storedWrites().filter((w) => w.fate === 'acked');
    expect(acked).toHaveLength(500);
    expect(acked[0]?.op.id).toBe('s10');
  });

  it('appareil plein : les écritures acquittées cèdent la place avant toute saisie en attente', async () => {
    enqueueAll([insert('s1'), insert('s2', 2)]);
    await flush(base().fns);
    expect(storedWrites().map((w) => w.fate)).toEqual(['acked', 'acked']);
    // Il reste de la place pour une écriture au registre, pas pour trois.
    const room = localStorage.getItem(REGISTRY_KEY)!.length;
    const setItem = localStorage.setItem.bind(localStorage);
    localStorage.setItem = (k: string, v: string) => {
      if (k === REGISTRY_KEY && v.length >= room) throw new Error('QuotaExceededError');
      setItem(k, v);
    };

    enqueue(insert('s3', 3));
    // La passe fait entrer la saisie au registre (réseau coupé : rien ne part).
    await flush(base({ cuts: () => true }).fns);

    expect(storageFailing()).toBe(false);
    expect(storedWrites().map((w) => `${w.op.id}:${w.fate}`)).toEqual(['s3:pending']);
  });
});

describe('sans compte reconnu', () => {
  it('une écriture enfilée sans compte reste lisible et comptée comme la sienne', () => {
    clearLocalAccount();
    enqueue(insert('s1'));
    expect(heldCounts()).toEqual({ own: 1, ownRefused: 0, foreign: 0 });
    expect(writesSince(null).map((w) => w.op.id)).toEqual(['s1']);
  });
});

// --- Constats de la relecture contradictoire (Codex, 24/11) -----------------------

describe('relecture contradictoire : conversion sous stockage plein', () => {
  it('deux reprises de suite sans pouvoir écrire le registre : les anciennes clés, seule trace, ne sont jamais effacées', async () => {
    saveLocalAccount({ userId: 'user-1', email: 'toi@exemple.com' });
    const legacy = JSON.stringify([{ ...insert('seule-trace'), _uid: 'q1', _owner: 'user-1', _at: 1000 }]);
    localStorage.setItem(LEGACY_QUEUE, legacy);
    const setItem = localStorage.setItem.bind(localStorage);
    localStorage.setItem = (k: string, v: string) => {
      if (k.startsWith(REGISTRY_KEY)) throw new Error('QuotaExceededError');
      setItem(k, v);
    };

    adoptLegacyOps();
    await registrySettled();
    // Seconde reprise (début d'une passe), réseau coupé : rien n'est acquitté.
    await flush(base({ cuts: () => true }).fns);

    expect(legacyQueueWrites()).toEqual(JSON.parse(legacy));
  });
});

describe('relecture contradictoire : ordre de l’ancienne file', () => {
  it('une insertion sans instant suivie d’une suppression datée garde l’ordre de la file', async () => {
    saveLocalAccount({ userId: 'user-1', email: 'toi@exemple.com' });
    localStorage.setItem(
      LEGACY_QUEUE,
      JSON.stringify([
        { ...insert('s1'), _uid: 'q1', _owner: 'user-1', _seq: 1 },
        { ...del('s1'), _uid: 'q2', _owner: 'user-1', _seq: 2, _at: 5000 },
      ]),
    );
    adoptLegacyOps();
    const b = base();
    await flush(b.fns);
    expect(b.sent).toEqual(['insertSet:s1', 'deleteSet:s1']);
  });
});

describe('relecture contradictoire : l’ancien onglet n’envoie plus sa propre file', () => {
  it('le registre actif pose en tête de l’ancienne file une écriture que l’ancienne version ne sait pas jouer : sa passe s’arrête dessus', async () => {
    saveLocalAccount({ userId: 'user-1', email: 'toi@exemple.com' });
    adoptLegacyOps();
    await registrySettled();
    const queue = JSON.parse(localStorage.getItem(LEGACY_QUEUE)!) as { type: string; _owner?: string }[];
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ _owner: 'user-1' });
    // Aucun type que l'ancienne version envoie.
    expect([
      'upsertExecution', 'insertSet', 'patchSet', 'deleteSet', 'updateExecution', 'upsertDatedNote',
      'deleteDatedNote', 'upsertExerciseNote', 'deleteExerciseNote', 'deleteExecution', 'deleteExecutionIfEmpty',
    ]).not.toContain(queue[0]!.type);
    // Et ce n'est une écriture pour personne ici.
    expect(heldCounts()).toEqual({ own: 0, ownRefused: 0, foreign: 0 });
  });

  it('ce que l’ancien onglet enfile derrière est repris ici, à sa place : la correction la plus récente part en dernier', async () => {
    saveLocalAccount({ userId: 'user-1', email: 'toi@exemple.com' });
    adoptLegacyOps();
    await registrySettled();
    // Ici d'abord : 90 kg. Puis l'ancien onglet, plus tard : 100 kg, derrière le verrou.
    enqueue(correction('s1', 90));
    const now = storedWrites()[0]!.n;
    const stop = JSON.parse(localStorage.getItem(LEGACY_QUEUE)!) as unknown[];
    localStorage.setItem(
      LEGACY_QUEUE,
      JSON.stringify([...stop, { ...correction('s1', 100), _uid: 'old-1', _owner: 'user-1', _at: now + 60_000 }]),
    );
    const weights: number[] = [];
    const fns = new Proxy({}, { get: () => async (op: { weightKg: number }) => void weights.push(op.weightKg) }) as SyncFns;

    await flush(fns);

    expect(weights).toEqual([90, 100]);
    // L'ancienne file est de nouveau réduite à son verrou.
    expect(JSON.parse(localStorage.getItem(LEGACY_QUEUE)!)).toHaveLength(1);
  });
});

describe('relecture contradictoire : un refus dépassé par une écriture acquittée', () => {
  it('correction refusée, puis correction plus récente acquittée : l’ancienne n’est plus appliquée ni renvoyable', async () => {
    enqueue(correction('s1', 90));
    await flush(base({ refuses: () => '42501' }).fns);
    expect(listRefused()).toHaveLength(1);
    enqueue(correction('s1', 100));
    await flush(base().fns);

    expect(listRefused()).toEqual([]);
    // Une lecture fraîche porte 100 kg : plus aucune écriture locale à lui appliquer.
    expect(writesSince(readStamp())).toEqual([]);
  });

  it('colonnes disjointes : le refus garde ce que la nouvelle écriture ne couvre pas', async () => {
    enqueue({ ...correction('s1', 90), reps: 12, cols: ['weightKg', 'reps'] } as OutboxOp);
    await flush(base({ refuses: () => '42501' }).fns);
    enqueue(correction('s1', 100));
    await flush(base().fns);

    expect(listRefused().map((r) => (r.op as { cols?: string[] }).cols)).toEqual([['reps']]);
  });

  it('une remontée de rang acquittée n’efface pas une correction de valeurs refusée', async () => {
    enqueue(correction('s1', 90));
    await flush(base({ refuses: () => '42501' }).fns);
    enqueue({ ...correction('s1', 80), only: 'rank', cols: undefined, setOrder: 2 } as OutboxOp);
    await flush(base().fns);
    expect(listRefused()).toHaveLength(1);
  });
});

describe('relecture contradictoire : une écriture acquittée trop ancienne n’est plus rejouée', () => {
  it('passé dix minutes sans aucune transition, une lecture antérieure ne la reçoit plus', async () => {
    let now = Date.now() + 2_000_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const stamp = readStamp();
    enqueue(insert('s1'));
    await flush(base().fns);
    expect(writesSince(stamp)).toHaveLength(1);

    now += 60 * 60 * 1000;

    expect(writesSince(stamp)).toEqual([]);
  });
});

// --- Second tour (constats 5 et 3 de la vérification ciblée) ----------------------

describe('second tour : un renvoi réussi n’efface pas un refus plus récent', () => {
  it('deux corrections refusées, 90 puis 100 kg : la première renvoyée avec succès, la seconde reste', async () => {
    enqueue(correction('s1', 90));
    enqueue(correction('s1', 100));
    await flush(base({ refuses: () => '42501' }).fns);
    const [first, second] = listRefused();
    expect([first!.op, second!.op]).toMatchObject([{ weightKg: 90 }, { weightKg: 100 }]);

    await retryRefused(first!.refusalId);
    await flush(base().fns);

    expect(listRefused().map((r) => (r.op as { weightKg: number }).weightKg)).toEqual([100]);
  });
});

describe('second tour : le verrou de l’ancienne file suit le compte, et tient sous stockage plein', () => {
  const stops = () =>
    (JSON.parse(localStorage.getItem(LEGACY_QUEUE) ?? '[]') as { _uid?: string; _owner?: string }[]).filter(
      (op) => op._uid === 'registre-actif',
    );

  it('posé avant toute connexion, il est complété dès qu’un compte est reconnu', async () => {
    clearLocalAccount();
    adoptLegacyOps();
    await flush(base().fns);
    // Connexion : la passe qui suit l'arrivée du compte complète le verrou.
    saveLocalAccount({ userId: 'user-1', email: 'toi@exemple.com' });
    await flush(base().fns, async () => 'user-1');

    expect(stops().map((op) => op._owner)).toContain('user-1');
  });

  it('un autre compte arrive : le verrou vaut pour les deux', async () => {
    saveLocalAccount({ userId: 'user-1', email: 'toi@exemple.com' });
    await flush(base().fns);
    saveLocalAccount({ userId: 'user-2', email: 'autre@exemple.com' });
    await flush(base().fns);

    expect(stops().map((op) => op._owner).sort()).toEqual(['user-1', 'user-2']);
  });

  it('stockage plein : le verrou est posé EN TÊTE de l’ancienne file, sans rien en retirer', async () => {
    saveLocalAccount({ userId: 'user-1', email: 'toi@exemple.com' });
    const op = { ...insert('seule-trace'), _uid: 'q1', _owner: 'user-1', _at: 1000 };
    localStorage.setItem(LEGACY_QUEUE, JSON.stringify([op]));
    const setItem = localStorage.setItem.bind(localStorage);
    localStorage.setItem = (k: string, v: string) => {
      if (k.startsWith(REGISTRY_KEY)) throw new Error('QuotaExceededError');
      setItem(k, v);
    };

    await flush(base({ cuts: () => true }).fns);

    const queue = JSON.parse(localStorage.getItem(LEGACY_QUEUE)!) as { _uid: string }[];
    expect(queue.map((o) => o._uid)).toEqual(['registre-actif', 'q1']);
  });
});

describe('second tour : un ancien onglet enfile derrière le verrou, la reprise est réveillée', () => {
  /** Un onglet neuf, avec une fenêtre qui reçoit les événements `storage` des autres onglets. */
  async function tabWithWindow() {
    const target = new EventTarget();
    vi.stubGlobal('window', target);
    vi.resetModules();
    const tab = await import('./outbox');
    const storageEvent = (key: string | null) => target.dispatchEvent(Object.assign(new Event('storage'), { key }));
    return { tab, storageEvent };
  }

  it('une écriture dans l’ancienne clé relance la passe de l’app, sans attendre une saisie ici', async () => {
    const { tab, storageEvent } = await tabWithWindow();
    const runner = vi.fn(async () => undefined);
    tab.setFlushRetryRunner(runner);
    localStorage.setItem(LEGACY_QUEUE, JSON.stringify([{ ...insert('vieux'), _uid: 'old-1', _at: Date.now() }]));

    storageEvent(LEGACY_QUEUE);

    expect(runner).toHaveBeenCalledTimes(1);
  });

  it('une autre clé, ou rien à envoyer, ne réveille rien', async () => {
    const { tab, storageEvent } = await tabWithWindow();
    const runner = vi.fn(async () => undefined);
    tab.setFlushRetryRunner(runner);

    storageEvent(LEGACY_QUEUE); // rien n'y attend
    localStorage.setItem(LEGACY_QUEUE, JSON.stringify([{ ...insert('vieux'), _uid: 'old-1', _at: Date.now() }]));
    storageEvent('croustylift:readcache:x');
    storageEvent(null);

    expect(runner).not.toHaveBeenCalled();
  });
});

// --- Troisième tour (constats C, E et I) ------------------------------------------

/** Le stockage refuse désormais toute écriture du registre et de sa boîte d'entrée, même plus petite (quota plein). */
function registryStorageFull(): { free: () => void } {
  const setItem = localStorage.setItem.bind(localStorage);
  let full = true;
  localStorage.setItem = (k: string, v: string) => {
    if (full && k.startsWith(REGISTRY_KEY)) throw new Error('QuotaExceededError');
    setItem(k, v);
  };
  return { free: () => void (full = false) };
}

describe('troisième tour : une séance annulée ne revient pas par l’ancienne file', () => {
  it('séance annulée puis stockage plein : sa saisie, reprise de l’ancienne file, ne revient pas', async () => {
    saveLocalAccount({ userId: 'user-1', email: 'toi@exemple.com' });
    localStorage.setItem(
      LEGACY_QUEUE,
      JSON.stringify([
        { ...insert('gardée', 1, { executionId: 'exec-2' }), _uid: 'q1', _owner: 'user-1', _at: 1000 },
        { ...insert('annulée'), _uid: 'q2', _owner: 'user-1', _at: 1001 },
      ]),
    );
    registryStorageFull();

    purgeByExecution('exec-1');
    await registrySettled();

    expect(readQueue().map((op) => op.id)).toEqual(['gardée']);
    // Même après une passe (réseau coupé) et une autre lecture.
    await flush(base({ cuts: () => true }).fns);
    expect(readQueue().map((op) => op.id)).toEqual(['gardée']);
  });
});

describe('troisième tour : une écriture acquittée sans pouvoir être écrite ne repart pas', () => {
  it('un geste de trois écritures, registre impossible à écrire : les deux acquittées partent une fois, pas plus', async () => {
    enqueueAll([insert('s1'), insert('s2', 2), insert('s3', 3)]);
    const setItem = localStorage.setItem.bind(localStorage);
    localStorage.setItem = (k: string, v: string) => {
      if (k === REGISTRY_KEY) throw new Error('QuotaExceededError');
      setItem(k, v);
    };
    // Le réseau tombe sur la troisième : elle reste, et sa clé de la boîte d'entrée avec elle.
    const b = base({ cuts: (op) => op.id === 's3' });

    await flush(b.fns);
    await flush(b.fns);

    expect(b.sent).toEqual(['insertSet:s1', 'insertSet:s2']);
    expect(readQueue().map((op) => op.id)).toEqual(['s3']);
  });
});

describe('troisième tour : un geste tenu en mémoire entre au registre comme les autres', () => {
  const refusing = () => base({ refuses: (op) => (op.type === 'upsertExecution' ? '23503' : null) });

  it('stockage plein, séance refusée : le refus ne peut pas s’écrire, la passe s’arrête, rien ne part ni ne se perd', async () => {
    registryStorageFull();
    enqueueAll([exec(), insert('s1')]);
    expect(storageFailing()).toBe(true);

    const b = refusing();
    for (let i = 0; i < 4; i += 1) await flush(b.fns);

    // Une seule question posée à la base, pas une par passe ; la série n'est pas partie sans sa séance.
    expect(b.tried).toEqual(['upsertExecution:exec-1']);
    expect(listRefused()).toEqual([]);
    expect(readQueue().map((op) => op.id)).toEqual(['exec-1', 's1']);
    // Toujours en mémoire seulement : recharger reste interdit.
    expect(hasUnpersistedOps()).toBe(true);
  });

  it('la place revient : la séance est refusée, sa série retenue ; renvoyée avec succès, la série repart avec elle', async () => {
    const device = registryStorageFull();
    enqueueAll([exec(), insert('s1')]);
    await flush(refusing().fns);

    device.free();
    await flush(refusing().fns);
    expect(refusal('insertSet', 's1')).toMatchObject({ heldBy: refusal('upsertExecution', 'exec-1').refusalId });
    expect(storageFailing()).toBe(false);

    await retryRefused(refusal('upsertExecution', 'exec-1').refusalId);
    const b = base();
    await flush(b.fns);

    expect(b.sent).toEqual(['upsertExecution:exec-1', 'insertSet:s1']);
    expect(listRefused()).toEqual([]);
  });
});

describe('troisième tour : la rétention des acquittées tient à l’heure réelle de l’acquittement', () => {
  it('horloge reculée d’une heure avant l’acquittement : onze minutes après, l’écriture n’est plus rejouée', async () => {
    let now = Date.now() + 3_000_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const stamp = readStamp();
    enqueue(insert('s1'));
    // L'horloge recule : le numéro d'acquittement, lui, ne recule pas.
    now -= 60 * 60 * 1000;
    await flush(base().fns);
    expect(writesSince(stamp).map((w) => w.op.id)).toEqual(['s1']);

    now += 11 * 60 * 1000;

    expect(writesSince(stamp)).toEqual([]);
  });

  it('horloge reculée APRÈS l’acquittement : l’écriture ne dépasse pas dix minutes non plus', async () => {
    let now = Date.now() + 4_000_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const stamp = readStamp();
    enqueue(insert('s1'));
    await flush(base().fns);

    now -= 60 * 60 * 1000;

    expect(writesSince(stamp)).toEqual([]);
  });
});

// --- Troisième tour (constats A, B, F et G : les clés de l'ancien format) ------------

/** Un rechargement de la page : un module neuf, sans rien de ce que l'ancien tenait en mémoire. */
async function reloaded(): Promise<typeof import('./outbox')> {
  vi.resetModules();
  return import('./outbox');
}

/** L'appareil est plein : aucune clé ne peut être créée, aucune valeur ne peut grandir. */
function deviceFull(): { free: () => void } {
  const setItem = localStorage.setItem.bind(localStorage);
  let full = true;
  localStorage.setItem = (k: string, v: string) => {
    const old = localStorage.getItem(k);
    if (full && (old === null || v.length > old.length)) throw new Error('QuotaExceededError');
    setItem(k, v);
  };
  return { free: () => void (full = false) };
}

const legacyQueueNow = () => JSON.parse(localStorage.getItem(LEGACY_QUEUE) ?? '[]') as { type: string; _uid?: string; _owner?: string; _at?: number }[];
const OLD_TYPES = [
  'upsertExecution', 'insertSet', 'patchSet', 'deleteSet', 'updateExecution', 'upsertDatedNote',
  'deleteDatedNote', 'upsertExerciseNote', 'deleteExerciseNote', 'deleteExecution', 'deleteExecutionIfEmpty',
];
/** Ce que la passe de l'ANCIENNE version jouerait pour ce compte : la première écriture du compte, si elle sait la jouer. */
const oldTabWouldSend = (owner: string) => {
  const head = legacyQueueNow().find((op) => op._owner === owner);
  return head !== undefined && OLD_TYPES.includes(head.type) ? head : null;
};

describe('troisième tour : la reprise ne retire des anciennes clés que ce qu’elle a lu', () => {
  beforeEach(async () => {
    saveLocalAccount({ userId: 'user-1', email: 'toi@exemple.com' });
    adoptLegacyOps();
    await registrySettled();
  });

  it('l’ancien onglet enfile PENDANT la reprise : sa saisie reste dans sa file, et part à la passe suivante', async () => {
    const read = { ...insert('lue'), _uid: 'old-1', _owner: 'user-1', _at: Date.now() };
    const late = { ...insert('tardive', 2), _uid: 'old-2', _owner: 'user-1', _at: Date.now() + 1 };
    const lateRefused = {
      op: { ...insert('refus-tardif', 3), _uid: 'old-r', _owner: 'user-1', _at: Date.now() + 2 },
      reason: '23514 : check',
      at: '2026-11-24T10:00:00.000Z',
    };
    localStorage.setItem(LEGACY_QUEUE, JSON.stringify([...legacyQueueNow(), read]));
    // L'ancien onglet écrit entre la lecture de la reprise et son écriture des anciennes clés.
    const setItem = localStorage.setItem.bind(localStorage);
    let written = false;
    localStorage.setItem = (k: string, v: string) => {
      setItem(k, v);
      if (k !== REGISTRY_KEY || written) return;
      written = true;
      setItem(LEGACY_QUEUE, JSON.stringify([...legacyQueueNow(), late]));
      setItem(LEGACY_QUARANTINE, JSON.stringify([lateRefused]));
    };

    await flush(base({ cuts: () => true }).fns);

    expect(legacyQueueWrites()).toMatchObject([{ _uid: 'old-2' }]);
    expect(JSON.parse(localStorage.getItem(LEGACY_QUARANTINE)!)).toMatchObject([{ op: { _uid: 'old-r' } }]);
    const b = base();
    await flush(b.fns);
    expect(b.sent).toEqual(['insertSet:lue', 'insertSet:tardive']);
    expect(listRefused().map((r) => r.refusalId)).toEqual(['old-r']);
    expect(legacyQueueWrites()).toEqual([]);
  });
});

describe('troisième tour : le verrou de l’ancienne file sur un appareil plein', () => {
  beforeEach(() => saveLocalAccount({ userId: 'user-1', email: 'toi@exemple.com' }));

  it('il est écrit AVANT le registre : c’est lui qui prend les derniers octets', async () => {
    const order: string[] = [];
    const setItem = localStorage.setItem.bind(localStorage);
    localStorage.setItem = (k: string, v: string) => {
      order.push(k);
      setItem(k, v);
    };
    enqueue(insert('s1'));

    await flush(base().fns);

    expect(order.indexOf(LEGACY_QUEUE)).toBeGreaterThan(-1);
    expect(order.indexOf(LEGACY_QUEUE)).toBeLessThan(order.indexOf(REGISTRY_KEY));
  });

  it('plus un octet : la première écriture du compte arrête l’ancienne version sur place, et reste lisible ici', async () => {
    const op = { ...insert('seule-trace'), _uid: 'q1', _owner: 'user-1', _at: 1000 };
    localStorage.setItem(LEGACY_QUEUE, JSON.stringify([op, { ...insert('suivante', 2), _uid: 'q2', _owner: 'user-1', _at: 1001 }]));
    expect(oldTabWouldSend('user-1')).not.toBeNull();
    const size = localStorage.getItem(LEGACY_QUEUE)!.length;
    deviceFull();

    await flush(base({ cuts: () => true }).fns);

    // L'ancienne version ne sait plus jouer la tête de sa file : sa passe s'arrête.
    expect(oldTabWouldSend('user-1')).toBeNull();
    expect(localStorage.getItem(LEGACY_QUEUE)!.length).toBeLessThanOrEqual(size);
    // Ici, rien n'a changé : les deux écritures attendent, sous leur vrai type.
    expect(readQueue().map((o) => `${o.type}:${o.id}`)).toEqual(['insertSet:seule-trace', 'insertSet:suivante']);

    // La première part : la suivante prend le relais, l'ancienne version reste arrêtée.
    const b = base({ cuts: (o) => o.id === 'suivante' });
    await flush(b.fns);
    expect(b.sent).toEqual(['insertSet:seule-trace']);
    expect(legacyQueueWrites()).toMatchObject([{ _uid: 'q2' }]);
    expect(oldTabWouldSend('user-1')).toBeNull();
    // Après un rechargement, l'écriture marquée est toujours une insertion.
    const tab = await reloaded();
    expect(tab.readQueue().map((o) => `${o.type}:${o.id}`)).toEqual(['insertSet:suivante']);
  });

  it('rien à marquer et pas un octet : c’est dit, puis posé dès que la place revient', async () => {
    const device = deviceFull();

    await flush(base().fns);
    expect(localStorage.getItem(LEGACY_QUEUE)).toBeNull();
    expect(storageFailing()).toBe(true);

    device.free();
    await flush(base().fns);
    expect(legacyQueueNow()).toMatchObject([{ _uid: 'registre-actif', _owner: 'user-1' }]);
    expect(storageFailing()).toBe(false);
  });
});

describe('troisième tour : sous stockage plein, une série refusée garde sa trace après un rechargement', () => {
  it('correction héritée envoyée comme série entière et refusée sans pouvoir l’écrire : la série est toujours parmi les refus après rechargement', async () => {
    saveLocalAccount({ userId: 'user-1', email: 'toi@exemple.com' });
    localStorage.setItem(
      LEGACY_QUARANTINE,
      JSON.stringify([{ op: { ...insert('s1'), _uid: 'r1', _owner: 'user-1', _at: 1000 }, reason: '23514 : check', at: '2026-11-23T10:00:00.000Z' }]),
    );
    localStorage.setItem(LEGACY_QUEUE, JSON.stringify([{ ...correction('s1', 90), _uid: 'q1', _owner: 'user-1', _at: 2000 }]));
    registryStorageFull();
    // La correction part comme la série entière, et la base la refuse à son tour :
    // ce second refus ne peut pas s'écrire (voie 1), la passe s'arrête. Le refus
    // listé est toujours celui de l'ancienne quarantaine.
    await flush(base({ refuses: () => '23514' }).fns);
    expect(listRefused().map((r) => `${r.op.type}:${r.op.id}`)).toEqual(['insertSet:s1']);

    const tab = await reloaded();

    // Avant : l'insertion d'origine avait quitté l'ancienne quarantaine, la
    // correction brute s'acquittait sur zéro ligne et la série disparaissait.
    expect(tab.listRefused().map((r) => r.op.id)).toContain('s1');
    const b = base();
    await tab.flush(b.fns);
    expect(b.sent).not.toContain('patchSet:s1');
  });
});

describe('troisième tour : sous stockage plein, une écriture héritée sans instant garde sa place', () => {
  it('sa voisine datée est acquittée puis retirée, la page recharge : elle part toujours AVANT la correction faite ici ensuite', async () => {
    saveLocalAccount({ userId: 'user-1', email: 'toi@exemple.com' });
    // Ici, écrite sur l'appareil : 90 kg.
    enqueue(correction('s1', 90));
    await flush(base({ cuts: () => true }).fns);
    const before = storedWrites()[0]!.n - 60_000;
    // L'ancienne file : une écriture datée d'avant, puis une correction à 85 kg sans instant.
    const stops = legacyQueueNow();
    localStorage.setItem(
      LEGACY_QUEUE,
      JSON.stringify([
        ...stops,
        { ...insert('autre', 1, { exerciseId: 'squat' }), _uid: 'q1', _owner: 'user-1', _at: before },
        { ...correction('s1', 85), _uid: 'q2', _owner: 'user-1' },
      ]),
    );
    registryStorageFull();
    // La voisine datée part ; la passe s'arrête sur la correction (réseau coupé).
    const first = base({ cuts: (op) => op.type === 'patchSet' });
    await flush(first.fns);
    expect(first.sent).toEqual(['insertSet:autre']);
    expect(legacyQueueWrites()).toMatchObject([{ _uid: 'q2' }]);

    const tab = await reloaded();
    const weights: number[] = [];
    const fns = new Proxy({}, { get: () => async (op: { weightKg: number }) => void weights.push(op.weightKg) }) as SyncFns;
    await tab.flush(fns);

    expect(weights).toEqual([85, 90]);
  });
});

// --- Relecture entière du troisième tour (Codex, modèle profond) ---------------------

describe('relecture entière : sous stockage plein, la boîte d’entrée garde la lignée d’une série refusée', () => {
  it('insertion et correction dans deux clés, toutes deux refusées, registre impossible à écrire : après rechargement l’insertion est toujours là', async () => {
    enqueue(insert('s1'));
    enqueue(correction('s1', 90));
    const setItem = localStorage.setItem.bind(localStorage);
    localStorage.setItem = (k: string, v: string) => {
      if (k === REGISTRY_KEY) throw new Error('QuotaExceededError');
      setItem(k, v);
    };
    await flush(base({ refuses: () => '23514' }).fns);
    // Le refus de l'insertion n'a pas pu s'écrire : il n'a pas lieu, la passe s'arrête.
    expect(listRefused()).toEqual([]);
    expect(storedWrites().map((w) => `${w.op.type}:${w.fate}`)).toEqual(['insertSet:pending', 'patchSet:pending']);

    const tab = await reloaded();

    // Les deux gestes, toujours sur l'appareil, repartent dans l'ordre. Avant,
    // la clé de l'insertion était effacée : la correction partait seule, sur
    // une ligne qui n'existe pas.
    const b = base();
    await tab.flush(b.fns);
    expect(b.sent).toEqual(['insertSet:s1', 'patchSet:s1']);
  });
});

describe('relecture entière : une écriture acquittée n’efface que les refus qui la précèdent', () => {
  it('deux réécritures complètes refusées, 90 puis 100 kg : la première renvoyée avec succès, la seconde reste un refus', async () => {
    // Comme le Journal en produit : la série réécrite entière, deux fois de suite.
    enqueue(insert('s1', 1, { weightKg: 90 }));
    await flush(base({ refuses: () => '42501' }).fns);
    const [second] = enqueueAll([insert('s1', 1, { weightKg: 100 })]);
    await flush(base({ refuses: () => '42501' }).fns);
    const [first] = listRefused();
    expect(listRefused().map((r) => (r.op as { weightKg: number }).weightKg)).toEqual([90, 100]);

    await retryRefused(first!.refusalId);
    await flush(base().fns);

    expect(listRefused().map((r) => (r.op as { weightKg: number }).weightKg)).toEqual([100]);
    expect(fatesOf([second!])).toEqual(['refused']);
  });
});

describe('relecture entière : un refus de création dépassé ne tient plus rien', () => {
  it('séance recréée avec succès, réseau coupé avant sa série : abandonner l’ancien refus n’emporte pas la série', async () => {
    enqueueAll([exec(), insert('s1')]);
    await flush(base({ refuses: (op) => (op.type === 'upsertExecution' ? '23503' : null) }).fns);
    const old = refusal('upsertExecution', 'exec-1').refusalId;
    // La séance est réaffirmée et passe ; le réseau tombe avant la série.
    enqueue(exec());
    await flush(base({ cuts: (op) => op.type === 'insertSet' }).fns);
    expect(readQueue().map((op) => op.id)).toEqual(['s1']);
    expect(refusal('upsertExecution', 'exec-1').dependents).toEqual([]);

    await abandonRefused(old);

    expect(readQueue().map((op) => op.id)).toEqual(['s1']);
  });

  it('une série loggée ensuite ne dépend pas de l’ancien refus', async () => {
    enqueue(exec());
    await flush(base({ refuses: () => '23503' }).fns);
    const old = refusal('upsertExecution', 'exec-1').refusalId;
    enqueue(exec());
    await flush(base().fns);

    enqueue(insert('s2', 2));
    await abandonRefused(old);

    expect(readQueue().map((op) => op.id)).toEqual(['s2']);
  });
});

describe('relecture entière : une écriture acquittée tenue pour passée le reste', () => {
  it('horloge reculée puis revenue à l’heure : l’écriture ne redevient pas applicable, et quitte le registre', async () => {
    let now = Date.now() + 5_000_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const stamp = readStamp();
    enqueue(insert('s1'));
    await flush(base().fns);
    expect(writesSince(stamp)).toHaveLength(1);

    now -= 60 * 60 * 1000;
    expect(writesSince(stamp)).toEqual([]);
    // L'horloge rattrape l'heure de l'acquittement.
    now += 60 * 60 * 1000 + 1000;

    expect(writesSince(stamp)).toEqual([]);
    await registrySettled();
    await vi.waitFor(() => expect(storedWrites()).toEqual([]));
  });
});

// --- Vérification ciblée de la relecture entière (second tour) ----------------------

describe('vérification ciblée : refus de création dépassé, sous stockage plein', () => {
  it('la réaffirmation passe en base sans pouvoir être écrite : elle reste en attente, et abandonner l’ancien refus n’emporte rien d’autre', async () => {
    enqueue(exec());
    await flush(base({ refuses: () => '23503' }).fns);
    const old = refusal('upsertExecution', 'exec-1').refusalId;
    enqueue(exec());
    const device = registryStorageFull();
    const b = base();
    await flush(b.fns);
    await flush(b.fns);
    // L'acquittement aurait marqué l'ancien refus comme dépassé : impossible à
    // écrire, il n'a pas lieu. Une seule requête, et la séance attend toujours.
    expect(b.tried).toEqual(['upsertExecution:exec-1']);
    enqueue(insert('s1'));
    expect(refusal('upsertExecution', 'exec-1').dependents).toEqual([]);

    // Abandonner retire : cela passe même appareil plein.
    expect(await abandonRefused(old)).toBe('done');
    expect(readQueue().map((op) => op.id)).toEqual(['exec-1', 's1']);

    device.free();
    await flush(b.fns);
    expect(b.sent).toEqual(['upsertExecution:exec-1', 'upsertExecution:exec-1', 'insertSet:s1']);
    expect(listRefused()).toEqual([]);
  });
});

describe('vérification ciblée : une lignée écrite en deux fois se reconstruit en une', () => {
  it('insertion sur l’appareil, correction tenue en mémoire, place revenue pour la boîte d’entrée, rechargement, les deux refusées : un seul refus, et l’abandonner n’envoie rien', async () => {
    enqueue(insert('s1', 1, { weightKg: 70 }));
    registryStorageFull();
    enqueue(correction('s1', 90));
    await flush(base({ refuses: () => '23514' }).fns);
    // Voie 1 : le refus de l'insertion n'a pas pu s'écrire, rien n'est refusé.
    expect(listRefused()).toEqual([]);
    // La place revient pour la boîte d'entrée seulement : le geste tenu en mémoire y est écrit.
    const store = localStorage as unknown as MemoryStorage;
    store.setItem = (k: string, v: string) => MemoryStorage.prototype.setItem.call(store, k, v);
    expect(retryPersistQueue()).toBe(true);
    expect(hasUnpersistedOps()).toBe(false);

    const tab = await reloaded();
    await tab.flush(base({ refuses: () => '23514' }).fns);
    const [only] = tab.listRefused();
    expect(tab.listRefused().map((r) => (r.op as { weightKg: number }).weightKg)).toEqual([90]);
    await tab.abandonRefused(only!.refusalId);

    const b = base();
    await tab.flush(b.fns);
    expect(b.sent).toEqual([]);
  });
});

describe('vérification ciblée : une écriture complète acquittée écarte aussi une ancienne suppression refusée', () => {
  it('suppression refusée, puis série réécrite et acquittée : la vieille suppression n’est plus renvoyable', async () => {
    enqueue(del('s1'));
    await flush(base({ refuses: () => '42501' }).fns);
    expect(listRefused()).toHaveLength(1);

    enqueue(insert('s1', 1, { weightKg: 90 }));
    await flush(base().fns);

    expect(listRefused()).toEqual([]);
  });
});

describe('vérification ciblée : une série réécrite garde sa marque d’une reconstruction à l’autre', () => {
  it('réécriture du Journal refusée, puis correction de la Salle refusée à son tour : toujours une réécriture', async () => {
    enqueue(insert('s1', 1, { rewrites: true }));
    await flush(base({ refuses: () => '23514' }).fns);
    enqueue(correction('s1', 90));
    await flush(base({ refuses: () => '23514' }).fns);

    expect(listRefused().map((r) => r.op)).toMatchObject([{ type: 'insertSet', weightKg: 90, rewrites: true }]);
  });
});

describe('vérification ciblée : abandonner rend ce qui est réellement parti', () => {
  it('la série acquittée pendant l’attente du verrou n’est pas rendue avec le refus abandonné', async () => {
    enqueueAll([exec(), insert('s1')]);
    await flush(base({ refuses: (op) => (op.type === 'upsertExecution' ? '23503' : null) }).fns);
    const old = refusal('upsertExecution', 'exec-1');
    expect(old.dependents).toHaveLength(1);
    // Pendant que la feuille attend : la séance est réaffirmée, la série part.
    enqueue(exec());
    await flush(base().fns);

    const removed: OutboxOp[] = [];
    await abandonRefused(old.refusalId, (ops) => removed.push(...ops));

    expect(removed.map((op) => op.type)).toEqual(['upsertExecution']);
  });
});

describe('vérification ciblée : l’âge monotone d’une acquittée part de l’âge déjà écoulé', () => {
  it('vue pour la première fois à neuf minutes, horloge reculée de huit : à onze minutes réelles elle n’est plus appliquée', async () => {
    let now = Date.now() + 6_000_000_000;
    let mono = 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    vi.spyOn(performance, 'now').mockImplementation(() => mono);
    const stamp = readStamp();
    enqueue(insert('s1'));
    await flush(base().fns);
    // Une autre page : elle n'a encore jamais vu cette écriture.
    const tab = await reloaded();
    now += 9 * 60 * 1000;
    mono += 9 * 60 * 1000;
    expect(tab.writesSince(stamp)).toHaveLength(1);

    now += 2 * 60 * 1000 - 8 * 60 * 1000;
    mono += 2 * 60 * 1000;

    expect(tab.writesSince(stamp)).toEqual([]);
  });
});

// --- Voie 1 (ADR 0025) : écrite, ou pas lieu --------------------------------------
// Le journal de secours (transitions tenues en mémoire puis rejouées) n'existe
// plus. Appareil plein : un acquittement se règle en retirant l'écriture de sa
// source, ce qui passe toujours ; un refus, qui grossit l'enregistrement, n'a
// pas lieu, et la passe s'arrête sans rien retirer ni rien renvoyer en boucle.

describe('voie 1 : appareil plein, un acquittement se règle en rétrécissant sa source', () => {
  it('plus un octet : tout part une fois, depuis l’enregistrement comme depuis la boîte d’entrée, et l’appareil se vide', async () => {
    enqueue(exec());
    await flush(base({ cuts: () => true }).fns); // la séance entre à l'enregistrement
    enqueueAll([insert('s1'), insert('s2', 2)]); // un geste, une clé de la boîte d'entrée
    deviceFull();

    const b = base();
    const result = await flush(b.fns);

    expect(b.tried).toEqual(['upsertExecution:exec-1', 'insertSet:s1', 'insertSet:s2']);
    expect(result).toMatchObject({ remaining: 0, flushed: 3 });
    expect(storedWrites()).toEqual([]);
    expect(storageFailing()).toBe(false);
  });

  it('saisie que l’appareil a refusée, tenue en mémoire : elle part, et plus rien n’interdit de recharger', async () => {
    await flush(base().fns); // le verrou de l'ancienne file est posé tant qu'il y a de la place
    deviceFull();
    enqueue(insert('s1'));
    expect(hasUnpersistedOps()).toBe(true);
    expect(storageFailing()).toBe(true);

    const b = base();
    await flush(b.fns);

    expect(b.tried).toEqual(['insertSet:s1']);
    expect(hasUnpersistedOps()).toBe(false);
    expect(storageFailing()).toBe(false);
  });

  it('une suppression restée dans la boîte d’entrée emporte, une fois acquittée, le refus qu’elle écartait', async () => {
    enqueue(insert('s1'));
    await flush(base({ refuses: () => '23514' }).fns);
    expect(listRefused()).toHaveLength(1);
    enqueue(del('s1'));
    // L'enregistrement ne peut pas recevoir la suppression : elle reste dans sa clé.
    const setItem = localStorage.setItem.bind(localStorage);
    localStorage.setItem = (k: string, v: string) => {
      if (k === REGISTRY_KEY && v.includes('deleteSet')) throw new Error('QuotaExceededError');
      setItem(k, v);
    };

    const b = base();
    await flush(b.fns);
    expect(b.sent).toEqual(['deleteSet:s1']);

    // Après un rechargement, l'ancien refus n'est pas redevenu renvoyable.
    const tab = await reloaded();
    expect(tab.listRefused()).toEqual([]);
    expect(storedWrites()).toEqual([]);
  });
});

describe('voie 1 : appareil plein, un refus qui ne peut pas s’écrire arrête la passe', () => {
  const refusing = () => base({ refuses: (op) => (op.id === 'refusée' ? '23514' : null) });

  it('rien n’est retiré, la saisie indépendante attend, et six passes ne font qu’une requête', async () => {
    enqueue(del('refusée'));
    enqueue(insert('indépendante', 1, { executionId: 'exec-2', exerciseId: 'squat' }));
    await flush(base({ cuts: () => true }).fns);
    deviceFull();

    const b = refusing();
    for (let i = 0; i < 6; i += 1) await flush(b.fns);

    // Avant : la suppression refusée repartait 504 fois par passe.
    expect(b.tried).toEqual(['deleteSet:refusée']);
    expect(listRefused()).toEqual([]);
    expect(storedWrites().map((w) => `${w.op.id}:${w.fate}`)).toEqual(['refusée:pending', 'indépendante:pending']);
    expect(pendingCount()).toBe(2);
    expect(storageFailing()).toBe(true);
  });

  it('une saisie faite pendant l’arrêt est gardée ; la place revient, le refus est rangé et tout le reste part', async () => {
    enqueue(del('refusée'));
    enqueue(insert('indépendante', 1, { executionId: 'exec-2', exerciseId: 'squat' }));
    await flush(base({ cuts: () => true }).fns);
    const device = deviceFull();
    const b = refusing();
    await flush(b.fns);
    enqueue(insert('pendant', 2, { executionId: 'exec-2', exerciseId: 'squat' }));
    await flush(b.fns);
    expect(b.tried).toEqual(['deleteSet:refusée']);
    expect(hasUnpersistedOps()).toBe(true);

    device.free();
    await flush(b.fns);

    expect(listRefused().map((r) => r.op.id)).toEqual(['refusée']);
    expect(b.sent).toEqual(['insertSet:indépendante', 'insertSet:pendant']);
    expect(storageFailing()).toBe(false);
    expect(hasUnpersistedOps()).toBe(false);
  });

  it('scénario R1 des relectures : insertion refusée écrite, puis enregistrement seul impossible à écrire, suppression refusée et saisie indépendante', async () => {
    enqueue(insert('s1'));
    await flush(base({ refuses: () => '23514' }).fns);
    // Seul l'enregistrement (et la sonde) est refusé : la boîte d'entrée reçoit encore les gestes.
    const setItem = localStorage.setItem.bind(localStorage);
    let full = true;
    localStorage.setItem = (k: string, v: string) => {
      if (full && k.startsWith(REGISTRY_KEY) && !k.startsWith(`${REGISTRY_KEY}:in:`)) throw new Error('QuotaExceededError');
      setItem(k, v);
    };
    enqueue(del('s1'));
    enqueue(insert('s9', 1, { executionId: 'exec-2', exerciseId: 'squat' }));

    const b = base({ refuses: (op) => (op.type === 'deleteSet' ? '42501' : null) });
    for (let i = 0; i < 4; i += 1) await flush(b.fns);

    // Avant : 504 essais par passe. Une seule question. La suppression a écarté
    // l'ancien refus de la même série (règle de lignée) ; elle et la saisie
    // indépendante sont toujours sur l'appareil.
    expect(b.tried).toEqual(['deleteSet:s1']);
    expect(storedWrites().map((w) => `${w.op.type}:${w.op.id}:${w.fate}`)).toEqual(['deleteSet:s1:pending', 'insertSet:s9:pending']);
    expect(storageFailing()).toBe(true);

    full = false;
    await flush(b.fns);
    expect(listRefused().map((r) => `${r.op.type}:${r.op.id}`)).toEqual(['deleteSet:s1']);
    expect(b.sent).toEqual(['insertSet:s9']);
    expect(storageFailing()).toBe(false);
  });

  it('l’écriture qui arrêtait la passe est annulée avec sa séance : la suite part sans attendre la place', async () => {
    enqueue(insert('refusée'));
    enqueue(insert('indépendante', 1, { executionId: 'exec-2', exerciseId: 'squat' }));
    await flush(base({ cuts: () => true }).fns);
    deviceFull();
    const b = refusing();
    await flush(b.fns);
    expect(storageFailing()).toBe(true);

    purgeByExecution('exec-1');
    await flush(b.fns);

    expect(b.tried).toEqual(['insertSet:refusée', 'insertSet:indépendante']);
    expect(pendingCount()).toBe(0);
    expect(storageFailing()).toBe(false);
  });

  it('après un rechargement pendant l’arrêt, rien n’est perdu : les deux saisies sont toujours sur l’appareil', async () => {
    enqueue(del('refusée'));
    enqueue(insert('indépendante', 1, { executionId: 'exec-2', exerciseId: 'squat' }));
    await flush(base({ cuts: () => true }).fns);
    deviceFull();
    await flush(refusing().fns);

    const tab = await reloaded();

    expect(tab.readQueue().map((op) => op.id)).toEqual(['refusée', 'indépendante']);
  });
});

describe('voie 1 : un acquittement que l’appareil refuse même de retirer n’a pas lieu', () => {
  it('l’écriture reste en attente, la passe s’arrête, et elle ne repart qu’une fois la place revenue', async () => {
    enqueue(insert('s1'));
    enqueue(insert('s2', 2));
    await flush(base({ cuts: () => true }).fns);
    const device = registryStorageFull();

    const b = base();
    for (let i = 0; i < 4; i += 1) await flush(b.fns);

    expect(b.tried).toEqual(['insertSet:s1']);
    expect(readQueue().map((op) => op.id)).toEqual(['s1', 's2']);
    expect(storageFailing()).toBe(true);

    device.free();
    await flush(b.fns);
    // s1 repart une fois (sans effet : idempotente par id), puis s2.
    expect(b.tried).toEqual(['insertSet:s1', 'insertSet:s1', 'insertSet:s2']);
    expect(pendingCount()).toBe(0);
    expect(storageFailing()).toBe(false);
  });
});

describe('voie 1 : les gestes de la feuille des refus disent quand l’appareil n’a rien pu écrire', () => {
  it('renvoyer ou abandonner sans pouvoir écrire : rien ne bouge, le tableau n’oublie rien, et c’est dit', async () => {
    enqueue(insert('s1'));
    enqueue(insert('s2', 2));
    await flush(base({ refuses: () => '23514' }).fns);
    const [first] = listRefused();
    const device = registryStorageFull();
    const removed: OutboxOp[] = [];

    expect(await retryRefused(first!.refusalId)).toBe('unsaved');
    expect(await abandonRefused(first!.refusalId, (ops) => removed.push(...ops))).toBe('unsaved');

    expect(removed).toEqual([]);
    expect(listRefused()).toHaveLength(2);

    device.free();
    expect(await abandonRefused(first!.refusalId, (ops) => removed.push(...ops))).toBe('done');
    expect(removed.map((op) => op.id)).toEqual(['s1']);
    expect(listRefused().map((r) => r.op.id)).toEqual(['s2']);
  });
});
