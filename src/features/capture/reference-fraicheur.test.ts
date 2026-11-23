// La Référence après un flush ACQUITTÉ (suite de l'ADR 0014).
//
// Le bug : une série loggée puis synchronisée sort de l'outbox alors que la
// copie locale de l'historique de l'exo (`exo-execs:<id>`) ne la contient pas
// encore. La séance suivante dérivait sa Référence d'une copie périmée, et il
// fallait relancer l'app pour voir sa dernière perf.
//
// On rejoue ici le vrai chemin (outbox réelle, cache de lecture réel, câblage
// `sync.ts` réel) contre un faux serveur en mémoire posé derrière
// `lib/supabase` : seul le réseau est bouchonné.
import { describe, it, expect, beforeEach, vi } from 'vitest';

interface ServerExecution {
  id: string;
  performed_on: string;
  created_at: string;
  seance_version_id: string;
}
interface ServerSet {
  id: string;
  execution_id: string;
  exercise_id: string;
  set_order: number;
  weight_kg: number;
  reps: number;
  rir: number;
  side: string | null;
}

const server = vi.hoisted(() => ({
  executions: new Map<string, ServerExecution>(),
  sets: new Map<string, ServerSet>(),
  /** Les LECTURES d'historique échouent (réseau coupé après l'acquittement). */
  failReads: false,
  /** Nombre de lectures d'historique parties vers le « réseau ». */
  reads: 0,
  clock: 0,
}));

vi.mock('../../lib/supabase', () => {
  const ok = { data: null, error: null };
  const eqThen = (run: (value: string) => void) => ({
    eq: (_column: string, value: string) => {
      run(value);
      return Promise.resolve(ok);
    },
  });
  const from = (table: string) => {
    if (table === 'executions') {
      return {
        upsert: (row: { id: string; performed_on: string; seance_version_id: string }) => {
          const known = server.executions.get(row.id);
          server.clock += 1;
          server.executions.set(row.id, {
            id: row.id,
            performed_on: row.performed_on,
            seance_version_id: row.seance_version_id,
            created_at: known?.created_at ?? `2026-01-01T00:00:${String(server.clock).padStart(2, '0')}Z`,
          });
          return Promise.resolve(ok);
        },
        update: () => eqThen(() => {}),
        delete: () =>
          eqThen((id) => {
            server.executions.delete(id);
            // Cascade DB (ADR 0008) : les séries de l'exécution partent avec elle.
            for (const [setId, set] of server.sets) {
              if (set.execution_id === id) server.sets.delete(setId);
            }
          }),
      };
    }
    if (table === 'performed_sets') {
      return {
        upsert: (row: ServerSet) => {
          server.sets.set(row.id, { ...row });
          return Promise.resolve(ok);
        },
        delete: () => eqThen((id) => void server.sets.delete(id)),
        // Lecture de l'historique d'un exo : select → eq → order → limit [→ gt].
        select: () => {
          let exerciseId = '';
          let after: string | null = null;
          const query = {
            eq: (_column: string, value: string) => ((exerciseId = value), query),
            order: () => query,
            limit: () => query,
            gt: (_column: string, value: string) => ((after = value), query),
            then: (
              resolve: (result: { data: unknown; error: unknown }) => unknown,
              reject?: (reason: unknown) => unknown,
            ) => {
              server.reads += 1;
              const result = server.failReads
                ? { data: null, error: new Error('réseau coupé') }
                : {
                    data: [...server.sets.values()]
                      .filter((s) => s.exercise_id === exerciseId)
                      .filter((s) => after === null || s.id > after)
                      .sort((a, b) => (a.id < b.id ? -1 : 1))
                      .map((s) => {
                        const exec = server.executions.get(s.execution_id);
                        return {
                          id: s.id,
                          weight_kg: s.weight_kg,
                          reps: s.reps,
                          rir: s.rir,
                          set_order: s.set_order,
                          side: s.side,
                          execution_id: s.execution_id,
                          executions: exec
                            ? {
                                performed_on: exec.performed_on,
                                created_at: exec.created_at,
                                seance_version_id: exec.seance_version_id,
                              }
                            : null,
                        };
                      }),
                    error: null,
                  };
              return Promise.resolve(result).then(resolve, reject);
            },
          };
          return query;
        },
      };
    }
    throw new Error(`table inattendue dans ce test : ${table}`);
  };
  return { supabase: { from } };
});

import { deriveExerciseHistory, loadExerciseRows } from './data';
import { clearQueue, enqueue, pendingCount } from './outbox';
import { flushOutbox } from './sync';
import { clearReadCache } from '../../lib/read-cache';
import { saveLocalAccount } from '../../lib/local-account';
import { setSessionUserReader } from '../../lib/session-identity';

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
  get length(): number {
    return this.store.size;
  }
  key(i: number): string | null {
    return [...this.store.keys()][i] ?? null;
  }
}

/** Laisse finir les lectures de fond (microtâches + macro-tick). */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const BENCH = 'bench';
const VERSION = 'ver-1';

/** La Référence (série 1) que verrait une séance qui s'ouvre maintenant. */
async function referenceOuverture(executionEnCours: string): Promise<number | undefined> {
  const rows = await loadExerciseRows(BENCH);
  const { reference } = deriveExerciseHistory(rows, BENCH, [VERSION], false, executionEnCours);
  return reference?.[0]?.weightKg;
}

/** Logge une série dans une NOUVELLE exécution, comme la Capture (enqueue puis flush). */
async function loggerSerie(executionId: string, setId: string, date: string, weightKg: number) {
  enqueue({ type: 'upsertExecution', id: executionId, seanceVersionId: VERSION, performedOn: date });
  enqueue({
    type: 'insertSet',
    id: setId,
    executionId,
    exerciseId: BENCH,
    setOrder: 1,
    weightKg,
    reps: 8,
    rir: 2,
  });
  await flushOutbox();
}

beforeEach(async () => {
  (globalThis as unknown as { localStorage: Storage }).localStorage =
    new MemoryStorage() as unknown as Storage;
  clearReadCache();
  clearQueue();
  server.executions.clear();
  server.sets.clear();
  server.failReads = false;
  server.reads = 0;
  server.clock = 0;
  saveLocalAccount({ userId: 'user-1', email: 'toi@exemple.com' });
  // Le flush exige une session vérifiée (posée par AuthProvider en production).
  setSessionUserReader(async () => 'user-1');

  // Séance 1, déjà en base ET dans la copie locale : 20 kg × 8.
  await loggerSerie('exec-1', 'set-1', '2026-11-01', 20);
  await settle();
  expect(await referenceOuverture('exec-2')).toBe(20);
  await settle();
});

describe('Référence après un flush acquitté', () => {
  it('série loggée puis synchronisée : la séance suivante la voit sans relancer', async () => {
    // Séance 2 : la copie est servie (20 kg), on logge 31,25 kg, tout remonte.
    await loggerSerie('exec-2', 'set-2', '2026-11-08', 31.25);
    expect(pendingCount()).toBe(0); // « Synchronisé. Tout est en base. »
    await settle();

    // Séance 3, même téléphone, sans relance.
    expect(await referenceOuverture('exec-3')).toBe(31.25);
  });

  it('suppression acquittée : la copie est relue, la série ne revient pas', async () => {
    await loggerSerie('exec-2', 'set-2', '2026-11-08', 31.25);
    await settle();
    // La copie locale contient la séance 2 (une ouverture la revalide en fond,
    // comme après une relance de l'app).
    await referenceOuverture('exec-3');
    await settle();
    expect(await referenceOuverture('exec-3')).toBe(31.25);
    await settle();

    // Le journal supprime la séance 2 (l'op ne porte que l'id de l'exécution).
    enqueue({ type: 'deleteExecution', id: 'exec-2' });
    await flushOutbox();
    expect(pendingCount()).toBe(0);
    await settle();

    expect(await referenceOuverture('exec-3')).toBe(20);
  });

  it('série annulée (deleteSet) acquittée : elle ne revient pas non plus', async () => {
    await loggerSerie('exec-2', 'set-2', '2026-11-08', 31.25);
    await settle();
    expect(await referenceOuverture('exec-3')).toBe(31.25);
    await settle();

    enqueue({ type: 'deleteSet', id: 'set-2' });
    await flushOutbox();
    await settle();

    expect(await referenceOuverture('exec-3')).toBe(20);
  });

  it('échec réseau à la relecture : copie inchangée, aucune erreur remontée', async () => {
    const cle = 'croustylift:readcache:user-1:exo-execs:bench';
    const avant = localStorage.getItem(cle);
    expect(avant).not.toBeNull();

    // Les écritures passent, la relecture qui suit tombe sur un réseau coupé.
    server.failReads = true;
    const lecturesAvant = server.reads;
    await expect(loggerSerie('exec-2', 'set-2', '2026-11-08', 31.25)).resolves.toBeUndefined();
    expect(pendingCount()).toBe(0);
    await settle();

    // La relecture est bien partie (sinon ce test ne prouverait rien)…
    expect(server.reads).toBeGreaterThan(lecturesAvant);
    // … et son échec a laissé la copie telle quelle.
    expect(localStorage.getItem(cle)).toBe(avant);
  });
});
