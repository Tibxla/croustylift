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
  readQueue,
  readStamp,
  registryOutdated,
  retryRefused,
  storageFailing,
  writesSince,
  type OutboxOp,
  type SyncFns,
} from './outbox';
import { clearLocalAccount, saveLocalAccount } from '../../lib/local-account';
import { legacyQueueWrites, REGISTRY_KEY, storedWrites } from '../../test/registry';

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
  const run = async (op: OutboxOp) => {
    if (options.cuts?.(op)) throw new TypeError('Failed to fetch');
    const code = options.refuses?.(op) ?? null;
    if (code !== null) throw Object.assign(new Error('rejet'), { code });
    sent.push(`${op.type}:${op.id}`);
  };
  return { sent, fns: new Proxy({}, { get: () => run }) as SyncFns };
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

  it('un enregistrement de la version courante n’est pas « plus récent »', () => {
    localStorage.removeItem(REGISTRY_KEY);
    enqueue(insert('s1'));
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

  it('d’un coup : chaque écriture garde son identité, son compte, son sort et sa place', () => {
    adoptLegacyOps();

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
    expect(legacyQueueWrites()).toHaveLength(2);
    expect(storedWrites()).toHaveLength(5);

    // Ouverture suivante.
    dead = false;
    adoptLegacyOps();
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
      if (k === REGISTRY_KEY) throw new Error('QuotaExceededError');
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
    // Il reste de la place pour une écriture, pas pour trois.
    const room = localStorage.getItem(REGISTRY_KEY)!.length;
    const setItem = localStorage.setItem.bind(localStorage);
    localStorage.setItem = (k: string, v: string) => {
      if (k === REGISTRY_KEY && v.length >= room) throw new Error('QuotaExceededError');
      setItem(k, v);
    };

    enqueue(insert('s3', 3));

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
      if (k === REGISTRY_KEY) throw new Error('QuotaExceededError');
      setItem(k, v);
    };

    adoptLegacyOps();
    // Seconde reprise (début d'une passe), réseau coupé : rien n'est acquitté.
    await flush(base({ cuts: () => true }).fns);

    expect(localStorage.getItem(LEGACY_QUEUE)).toBe(legacy);
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
  it('le registre actif pose en tête de l’ancienne file une écriture que l’ancienne version ne sait pas jouer : sa passe s’arrête dessus', () => {
    saveLocalAccount({ userId: 'user-1', email: 'toi@exemple.com' });
    adoptLegacyOps();
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
