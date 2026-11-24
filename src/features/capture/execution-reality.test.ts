// LE RÉALISÉ D'UNE EXÉCUTION (execution-reality.ts), par son interface.
//
// Scénarios DATÉS, joués contre le vrai registre d'écritures : « la lecture part
// à t, des écritures locales à t+1 et t+2, la réponse arrive à t+3 ». Une
// lecture est estampillée à son départ (`readStamp`) ; à l'arrivée, le réalisé
// est cette lecture plus les écritures locales qu'elle ne contient pas
// (`writesSince`). Les règles viennent des anciens `reconcileProgress`,
// `applyQueuedSets`, `applyPendingSets` et `withoutDeletedSets`, réunis en une.
import { beforeEach, describe, expect, it } from 'vitest';
import type { PerformedSet } from '../../domain/types';
import type { PerformedSetWithExecutionRow } from './data';
import { datedNotesReality, executionReality, exerciseRowsReality, type ReadProgress } from './execution-reality';
import {
  clearQueue,
  enqueue,
  enqueueAll,
  flush,
  readStamp,
  writesSince,
  type LocalWrite,
  type OutboxOp,
  type ReadStamp,
  type SyncFns,
} from './outbox';

class MemoryStorage {
  private store = new Map<string, string>();
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

beforeEach(() => {
  (globalThis as unknown as { localStorage: Storage }).localStorage = new MemoryStorage() as unknown as Storage;
  clearQueue();
});

const EXEC = 'exec-1';
const ps = (order: number, over: Partial<PerformedSet> = {}): PerformedSet => ({ weightKg: 80, reps: 8, rir: 2, order, ...over });
const insert = (id: string, setOrder: number, over: Record<string, unknown> = {}): OutboxOp =>
  ({ type: 'insertSet', id, executionId: EXEC, exerciseId: 'bench', setOrder, weightKg: 80, reps: 8, rir: 2, ...over }) as OutboxOp;
const patch = (id: string, only: 'values' | 'rank', over: Record<string, unknown> = {}): OutboxOp =>
  ({ type: 'patchSet', id, executionId: EXEC, exerciseId: 'bench', setOrder: 1, weightKg: 80, reps: 8, rir: 2, only, ...over }) as OutboxOp;
const del = (id: string): OutboxOp => ({ type: 'deleteSet', id, exerciseIds: ['bench'] });

/** La base acquitte tout ce qui attend (les écritures restent au registre, acquittées). */
const acknowledge = () => flush(new Proxy({}, { get: () => async () => undefined }) as SyncFns);

/** Une lecture de la base : ce qu'elle rend pour `bench`, série par série. */
const read = (...rows: [id: string | null, set: PerformedSet][]): Record<string, ReadProgress> =>
  rows.length === 0 ? {} : { bench: { sets: rows.map(([, set]) => set), setIds: rows.map(([id]) => id) } };

/** Le réalisé quand la réponse d'une lecture partie à `stamp` arrive. */
const arrive = (stamp: ReadStamp | null, base: Record<string, ReadProgress>, skipped: string[] = []) =>
  executionReality({ executionId: EXEC, read: base, writes: writesSince(stamp), skipped: new Set(skipped) });

const rows = (progress: Record<string, { sets: PerformedSet[]; setIds: (string | null)[] }>, exo = 'bench') =>
  (progress[exo]?.sets ?? []).map((set, i) => `${progress[exo]?.setIds[i]}@${set.order}:${set.weightKg}x${set.reps}`);

describe('l’estampille se compare à l’acquittement, pas à l’enfilement', () => {
  it('enfilée à t-1, départ à t, acquittée à t+1, réponse à t+2 : la réponse ne la porte pas, elle est appliquée', async () => {
    enqueue(insert('s1', 1));
    const stamp = readStamp();
    await acknowledge();

    expect(rows(arrive(stamp, read()))).toEqual(['s1@1:80x8']);
  });

  it('acquittée à t-1, départ à t : la réponse la porte déjà, elle n’est pas réappliquée', async () => {
    enqueue(insert('s1', 1));
    await acknowledge();
    const stamp = readStamp();

    // La base l'a rendue telle qu'un autre appareil l'a corrigée depuis : 90 kg.
    expect(rows(arrive(stamp, read(['s1', ps(1, { weightKg: 90 })])))).toEqual(['s1@1:90x8']);
    // Et si la base ne la rend plus (supprimée ailleurs), elle ne revient pas.
    expect(arrive(stamp, read())).toEqual({});
  });

  it('enfilée à t+1, toujours en attente à l’arrivée : appliquée', () => {
    const stamp = readStamp();
    enqueue(insert('s1', 1));

    expect(rows(arrive(stamp, read()))).toEqual(['s1@1:80x8']);
  });

  it('refusée par la base : l’appareil la retient, elle reste au réalisé', async () => {
    enqueue(insert('s1', 1));
    const stamp = readStamp();
    await flush(
      new Proxy({}, { get: () => async () => Promise.reject(Object.assign(new Error('check'), { code: '23514' })) }) as SyncFns,
    );

    expect(writesSince(stamp).map((w) => w.fate)).toEqual(['refused']);
    expect(rows(arrive(stamp, read()))).toEqual(['s1@1:80x8']);
  });

  it('sans estampille (hors ligne, état d’avant ce champ) : seules les écritures non acquittées', async () => {
    enqueue(insert('s1', 1));
    await acknowledge();
    enqueue(insert('s2', 2));

    expect(writesSince(null).map((w) => w.op.id)).toEqual(['s2']);
  });
});

describe('la base fait foi, plus les écritures locales qu’elle ne contient pas', () => {
  it('série supprimée ailleurs (Journal, autre appareil), suppression déjà en base : elle ne revient pas', () => {
    // L'appareil tenait s1 et s2 ; la base ne rend plus que s1, rien n'attend.
    const progress = arrive(readStamp(), read(['s1', ps(1)]));
    expect(rows(progress)).toEqual(['s1@1:80x8']);
  });

  it('série loggée hors ligne, pas encore envoyée : elle reste (son insertion attend)', () => {
    enqueue(insert('s2', 2));
    expect(rows(arrive(readStamp(), read(['s1', ps(1)])))).toEqual(['s1@1:80x8', 's2@2:80x8']);
  });

  it('série écrite ailleurs : elle arrive, le rang suivant la compte', () => {
    const progress = arrive(readStamp(), read(['s1', ps(1)], ['s-ailleurs', ps(2)]));
    expect(progress.bench?.setIds).toEqual(['s1', 's-ailleurs']);
  });

  it('toutes les séries d’un exo supprimées ailleurs : l’exo sort du réalisé', () => {
    expect(arrive(readStamp(), read())).toEqual({});
  });

  it('un exo passé reste passé, même sans série', () => {
    expect(arrive(readStamp(), read(), ['bench']).bench).toEqual({ sets: [], setIds: [], skipped: true });
  });

  it('une série ajoutée depuis le Journal et pas encore envoyée entre au tableau, sur un exo jamais ouvert', () => {
    enqueue(insert('s1-journal', 1, { exerciseId: 'squat' }));
    expect(arrive(readStamp(), read()).squat).toEqual({ sets: [ps(1)], setIds: ['s1-journal'], skipped: false });
  });

  it('les séries d’une AUTRE exécution ne sont pas prises', () => {
    enqueue(insert('ailleurs', 2, { executionId: 'exec-2' }));
    expect(rows(arrive(readStamp(), read(['s1', ps(1)])))).toEqual(['s1@1:80x8']);
  });

  it('insérée puis supprimée : la série ne revient pas ; l’exo vide sort, sauf s’il est passé', () => {
    const stamp = readStamp();
    enqueueAll([insert('s2', 2), del('s2')]);
    expect(rows(arrive(stamp, read(['s1', ps(1)])))).toEqual(['s1@1:80x8']);

    enqueue(del('s1'));
    expect(arrive(stamp, read(['s1', ps(1)]))).toEqual({});
    expect(arrive(stamp, read(['s1', ps(1)]), ['bench']).bench).toEqual({ sets: [], setIds: [], skipped: true });
  });

  it('une écriture qui ne change rien ne touche pas l’exo : l’ordre de la lecture est gardé', () => {
    const base = read(['s1', ps(1)], ['s2', ps(2)]);
    enqueueAll([insert('s1', 1), insert('s2', 2)]);
    expect(arrive(readStamp(), base).bench?.sets).toBe(base.bench?.sets);
  });

  it('unilatéral : un exo touché est rendu trié par rang, gauche avant droite', () => {
    enqueue(insert('r1', 1, { exerciseId: 'curl', side: 'right' }));
    const progress = executionReality({
      executionId: EXEC,
      read: { curl: { sets: [ps(1, { side: 'left' }), ps(2, { side: 'left' })], setIds: ['l1', 'l2'] } },
      writes: writesSince(null),
    });
    expect(progress.curl?.setIds).toEqual(['l1', 'r1', 'l2']);
    expect(progress.curl?.sets.map((s) => `${s.order}${s.side}`)).toEqual(['1left', '1right', '2left']);
  });

  it('une série sans id (cache d’un très ancien format) reste en place : aucune écriture ne la vise', () => {
    enqueue(insert('s2', 2));
    expect(arrive(null, read([null, ps(1)])).bench?.setIds).toEqual([null, 's2']);
  });
});

describe('colonne par colonne (ADR 0003, amendement)', () => {
  it('rang remonté ici, poids corrigé ailleurs : les deux tiennent', async () => {
    const stamp = readStamp();
    enqueueAll([del('s1'), patch('s2', 'rank', { setOrder: 1 })]);
    await acknowledge();
    // La lecture, partie avant, porte encore s1, et s2 au rang 2, mais à 90 kg.
    const progress = arrive(stamp, read(['s1', ps(1)], ['s2', ps(2, { weightKg: 90 })]));
    expect(rows(progress)).toEqual(['s2@1:90x8']);
  });

  it('une correction ne pose que les colonnes qu’elle a changées', () => {
    const stamp = readStamp();
    // Ici : le poids seul. La base a entre-temps reçu d'autres reps (10).
    enqueue(patch('s1', 'values', { weightKg: 85, reps: 8, cols: ['weightKg'] }));
    expect(rows(arrive(stamp, read(['s1', ps(1, { reps: 10 })])))).toEqual(['s1@1:85x10']);
  });

  it('une correction sans liste de colonnes (écriture d’avant ce champ) pose les trois valeurs', () => {
    const stamp = readStamp();
    enqueue(patch('s1', 'values', { weightKg: 85, reps: 6, rir: 0 }));
    expect(arrive(stamp, read(['s1', ps(1, { reps: 10 })])).bench?.sets).toEqual([ps(1, { weightKg: 85, reps: 6, rir: 0 })]);
  });

  it('une écriture partielle ne crée jamais de ligne : corriger une série supprimée ailleurs ne la ressuscite pas', () => {
    const stamp = readStamp();
    enqueueAll([patch('s3', 'values', { weightKg: 85 }), patch('s3', 'rank', { setOrder: 2 })]);
    expect(rows(arrive(stamp, read(['s1', ps(1)])))).toEqual(['s1@1:80x8']);
  });

  it('renumérotation faite dans le Journal pendant la lecture : la réponse ne la défait pas', () => {
    // Le Journal supprime A et décale B et C aux rangs 1 et 2.
    const stamp = readStamp();
    enqueueAll([del('a'), insert('b', 1), insert('c', 2)]);
    // La réponse, partie avant, porte encore A, et B et C aux rangs 2 et 3.
    const progress = arrive(stamp, read(['a', ps(1)], ['b', ps(2)], ['c', ps(3)]));
    expect(rows(progress)).toEqual(['b@1:80x8', 'c@2:80x8']);
  });
});

describe('hors ligne : l’état gardé par l’appareil tient lieu de lecture', () => {
  it('son estampille dit ce qu’il contient : ce qui a été acquitté depuis, ailleurs, est appliqué', async () => {
    // L'état est enregistré à t ; un autre onglet (le Journal) ajoute s2 à t+1,
    // acquittée à t+2. Rechargé hors ligne à t+3, l'état ne porte que s1.
    const asOf = readStamp();
    enqueue(insert('s2-journal', 2));
    await acknowledge();

    expect(rows(arrive(asOf, read(['s1', ps(1)])))).toEqual(['s1@1:80x8', 's2-journal@2:80x8']);
  });

  it('rejouer les écritures que l’état contient déjà ne change rien', async () => {
    const asOf = readStamp();
    enqueueAll([insert('s1', 1), insert('s2', 2), del('s1'), patch('s2', 'rank', { setOrder: 1 })]);
    await acknowledge();

    const local = read(['s2', ps(1)]);
    expect(arrive(asOf, local).bench?.sets).toBe(local.bench?.sets);
  });
});

describe('notes datées : la même règle', () => {
  const write = (body: string, exerciseId = 'bench'): OutboxOp => ({ type: 'upsertDatedNote', id: `n-${exerciseId}`, executionId: EXEC, exerciseId, body });
  const base = { bench: { id: 'id-base', body: 'en base' } };
  const notes = (stamp: ReadStamp, read: Record<string, { id: string; body: string }>) => datedNotesReality(EXEC, read, writesSince(stamp));

  it('rien de local : les notes de la lecture, telles quelles', () => {
    expect(notes(readStamp(), base)).toBe(base);
  });

  it('effacement acquitté pendant le trajet de la lecture : la note n’est plus là', async () => {
    const stamp = readStamp();
    enqueue({ type: 'deleteDatedNote', id: 'n-bench', executionId: EXEC, exerciseId: 'bench' });
    await acknowledge();
    expect(notes(stamp, base)).toEqual({});
  });

  it('effacement d’un bundle antérieur (id seul) : retire la note de cet id, pas les autres', () => {
    const stamp = readStamp();
    enqueue({ type: 'deleteDatedNote', id: 'id-base' });
    expect(notes(stamp, { ...base, squat: { id: 'autre', body: 'x' } })).toEqual({ squat: { id: 'autre', body: 'x' } });
  });

  it('pose en attente : son corps passe par-dessus, la ligne garde son id', () => {
    const stamp = readStamp();
    enqueue(write('réécrite ici'));
    expect(notes(stamp, base)).toEqual({ bench: { id: 'id-base', body: 'réécrite ici' } });
    expect(notes(stamp, {})).toEqual({ bench: { id: 'n-bench', body: 'réécrite ici' } });
  });

  it('les notes d’une AUTRE exécution sont sans effet', () => {
    const stamp = readStamp();
    enqueue({ type: 'deleteDatedNote', id: 'x', executionId: 'exec-2', exerciseId: 'bench' });
    expect(notes(stamp, base)).toBe(base);
  });
});

describe('la Référence : lignes d’historique d’un exo (ADR 0014)', () => {
  const context = { performed_on: '2026-11-20', created_at: '2026-11-20T18:00:00Z', seance_version_id: 'v1' };
  const row = (id: string | undefined, set_order: number, over: Partial<PerformedSetWithExecutionRow> = {}): PerformedSetWithExecutionRow => ({
    ...(id ? { id } : {}),
    weight_kg: 80,
    reps: 8,
    rir: 2,
    set_order,
    side: null,
    execution_id: 'exec-old',
    executions: context,
    ...over,
  });
  const pending = (...ops: OutboxOp[]): LocalWrite[] => ops.map((op, i) => ({ uid: `u${i}`, n: i + 1, op, fate: 'pending' }));
  const creation: OutboxOp = { type: 'upsertExecution', id: EXEC, seanceVersionId: 'v2', performedOn: '2026-11-24', startedAt: '2026-11-24T18:00:00Z' };

  it('rien de local : les lignes lues passent telles quelles', () => {
    const copy = [row('a', 1)];
    expect(exerciseRowsReality(copy, [], 'bench')).toEqual(copy);
  });

  it('séance jamais remontée : ses séries entrent, datées par la création de leur exécution', () => {
    const out = exerciseRowsReality([row('a', 1)], pending(creation, insert('s1', 1)), 'bench');
    expect(out.map((r) => r.id)).toEqual(['a', 's1']);
    expect(out[1]).toMatchObject({
      execution_id: EXEC,
      executions: { performed_on: '2026-11-24', created_at: '2026-11-24T18:00:00Z', seance_version_id: 'v2' },
    });
  });

  it('une série en attente sur une exécution DÉJÀ lue hérite de sa jointure, pas d’une réaffirmation', () => {
    const out = exerciseRowsReality(
      [row('a', 1)],
      pending({ ...creation, id: 'exec-old' }, insert('b', 2, { executionId: 'exec-old' })),
      'bench',
    );
    // L'exécution garde la date et la version sous lesquelles elle est née (ADR 0021).
    expect(out[1]?.executions).toEqual(context);
  });

  it('ignore les séries d’un AUTRE exo, et celles dont l’exécution n’a ni ligne lue ni création', () => {
    const out = exerciseRowsReality(
      [row('a', 1)],
      pending(creation, insert('autre-exo', 1, { exerciseId: 'squat' }), insert('sans-contexte', 1, { executionId: 'inconnue' })),
      'bench',
    );
    expect(out.map((r) => r.id)).toEqual(['a']);
  });

  it('rejouer une série déjà lue ne la duplique pas, et rend la ligne lue elle-même', () => {
    const copy = [row('a', 1)];
    const out = exerciseRowsReality(copy, pending(insert('a', 1, { executionId: 'exec-old' })), 'bench');
    expect(out).toEqual(copy);
    expect(out[0]).toBe(copy[0]);
  });

  it('une correction en attente remplace les seules colonnes qu’elle écrit', () => {
    const out = exerciseRowsReality([row('a', 1)], pending(patch('a', 'values', { weightKg: 85, cols: ['weightKg'] })), 'bench');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'a', weight_kg: 85, reps: 8, set_order: 1, executions: context });
  });

  it('une suppression retire la ligne ; celle d’une exécution, toutes ses lignes', () => {
    const copy = [row('a', 1), row('b', 2), row('c', 1, { execution_id: 'exec-autre' })];
    expect(exerciseRowsReality(copy, pending(del('a')), 'bench').map((r) => r.id)).toEqual(['b', 'c']);
    expect(exerciseRowsReality(copy, pending({ type: 'deleteExecution', id: 'exec-old' }), 'bench').map((r) => r.id)).toEqual(['c']);
  });

  it('rend les lignes triées par date puis création de l’exécution, comme la requête', () => {
    const out = exerciseRowsReality(
      [row('recent', 1, { execution_id: 'e2', executions: { ...context, performed_on: '2026-11-22' } }), row('a', 1)],
      pending(creation, insert('s1', 1)),
      'bench',
    );
    expect(out.map((r) => r.id)).toEqual(['a', 'recent', 's1']);
  });

  it('une ligne d’une copie SANS id survit, hors de portée des écritures', () => {
    const out = exerciseRowsReality([row(undefined, 1)], pending(creation, insert('s1', 1), del('s1')), 'bench');
    expect(out).toEqual([row(undefined, 1)]);
  });

  it('série acquittée après le départ de la lecture qui a écrit la copie : la Référence la voit quand même', async () => {
    // La copie est écrite par une lecture partie à t. La série du jour est
    // enfilée puis acquittée à t+1 : elle a quitté l'attente, la copie ne l'a pas.
    const stamp = readStamp();
    enqueueAll([creation, insert('s1', 1)]);
    await acknowledge();
    expect(exerciseRowsReality([row('a', 1)], writesSince(stamp), 'bench').map((r) => r.id)).toEqual(['a', 's1']);
    // La copie relue après l'acquittement (ADR 0020) la porte : plus rien à appliquer.
    expect(writesSince(readStamp())).toEqual([]);
  });
});
