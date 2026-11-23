// Une séance clôturée, annulée ou supprimée dont l'écriture n'est pas encore
// acquittée n'est pas reprise par la Capture.
//
// Le bug : Clôture et Annulation effacent l'état local AVANT que leur écriture
// soit acquittée. Capture rouverte le même jour avant l'envoi (clôture en salle
// sur un réseau qui flanche, puis « Nouvelle séance ») : la base montre encore
// l'exécution ouverte (`closed_at` nul), `loadTodayExecution` l'adoptait, et la
// série suivante rouvrait la séance close ou recréait l'exécution supprimée.
//
// On pilote le vrai `loadTodayExecution` avec l'outbox réelle ; seul le réseau
// est bouchonné (faux serveur derrière `lib/supabase`).
import { describe, it, expect, beforeEach, vi } from 'vitest';

const server = vi.hoisted(() => ({
  /** L'exécution du jour encore OUVERTE en base (`null` = aucune). */
  openExecutionId: null as string | null,
  /** Appelé pendant que la lecture de l'exécution est « sur le réseau ». */
  duringRead: null as (() => void) | null,
}));

vi.mock('../../lib/supabase', () => {
  const from = (table: string) => {
    if (table === 'executions') {
      const query = {
        select: () => query,
        eq: () => query,
        is: () => query,
        order: () => query,
        limit: () => query,
        maybeSingle: async () => {
          // La réponse est figée au départ de la requête : ce qui arrive à la file
          // pendant le trajet (enfilement, acquittement) n'y figure pas.
          const id = server.openExecutionId;
          await Promise.resolve();
          server.duringRead?.();
          return {
            data: id
              ? {
                  id,
                  seance_version_id: 'v1',
                  started_at: '2026-11-23T18:00:00.000Z',
                  created_at: '2026-11-23T18:01:00.000Z',
                }
              : null,
            error: null,
          };
        },
      };
      return query;
    }
    if (table === 'performed_sets' || table === 'dated_notes') {
      // Séries et notes de l'exécution : select → eq → order, sans ligne ici.
      const query = {
        select: () => query,
        eq: () => query,
        order: () => Promise.resolve({ data: [], error: null }),
      };
      return query;
    }
    throw new Error(`table inattendue dans ce test : ${table}`);
  };
  return { supabase: { from } };
});

import { isExecutionRetiredInQueue, loadTodayExecution, loadTodayExecutionWithin } from './data';
import { clearQueue, enqueue, type OutboxOp } from './outbox';
import { saveLocalAccount } from '../../lib/local-account';

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

const cloture = (id: string): OutboxOp => ({
  type: 'updateExecution',
  id,
  durationMin: 62,
  closedAt: '2026-11-23T19:02:00.000Z',
});
const suppression = (id: string): OutboxOp => ({ type: 'deleteExecution', id });

beforeEach(() => {
  (globalThis as unknown as { localStorage: Storage }).localStorage =
    new MemoryStorage() as unknown as Storage;
  saveLocalAccount({ userId: 'user-1', email: 'toi@exemple.com' });
  clearQueue();
  server.openExecutionId = 'exec-1';
  server.duringRead = null;
});

describe('isExecutionRetiredInQueue', () => {
  it('clôture en attente de cette exécution : retirée', () => {
    expect(isExecutionRetiredInQueue('exec-1', [cloture('exec-1')])).toBe(true);
  });

  it('suppression en attente de cette exécution : retirée', () => {
    expect(isExecutionRetiredInQueue('exec-1', [suppression('exec-1')])).toBe(true);
  });

  it('clôture ou suppression d’une AUTRE exécution : sans effet', () => {
    expect(isExecutionRetiredInQueue('exec-1', [cloture('exec-2'), suppression('exec-3')])).toBe(
      false,
    );
  });

  it('métriques seules (BPM corrigé, sans clôture) : l’exécution reste en cours', () => {
    expect(
      isExecutionRetiredInQueue('exec-1', [{ type: 'updateExecution', id: 'exec-1', bpmAvg: 140 }]),
    ).toBe(false);
  });

  it('série ou réaffirmation en attente : l’exécution reste en cours', () => {
    expect(
      isExecutionRetiredInQueue('exec-1', [
        { type: 'upsertExecution', id: 'exec-1', seanceVersionId: 'v1', performedOn: '2026-11-23' },
        { type: 'deleteSet', id: 'exec-1' },
      ]),
    ).toBe(false);
  });
});

describe('loadTodayExecution et les écritures en attente', () => {
  it('exécution ouverte, rien en attente : adoptée (cas nominal)', async () => {
    const today = await loadTodayExecution('seance-1', '2026-11-23');
    expect(today?.executionId).toBe('exec-1');
  });

  it('clôture pas encore envoyée : la séance close n’est pas reprise', async () => {
    enqueue(cloture('exec-1'));
    expect(await loadTodayExecution('seance-1', '2026-11-23')).toBeNull();
  });

  it('annulation ou suppression pas encore envoyée : l’exécution n’est pas reprise', async () => {
    enqueue(suppression('exec-1'));
    expect(await loadTodayExecution('seance-1', '2026-11-23')).toBeNull();
  });

  it('clôture enfilée PENDANT la lecture : la réponse, partie avant, est écartée', async () => {
    server.duringRead = () => void enqueue(cloture('exec-1'));
    expect(await loadTodayExecution('seance-1', '2026-11-23')).toBeNull();
  });

  it('clôture acquittée PENDANT la lecture : la réponse, partie avant, est écartée', async () => {
    enqueue(cloture('exec-1'));
    // Le flush lancé au même montage vide la file avant le retour de la lecture,
    // dont la réponse montre encore l'exécution ouverte.
    server.duringRead = () => clearQueue();
    expect(await loadTodayExecution('seance-1', '2026-11-23')).toBeNull();
  });

  it('clôture en attente d’une autre exécution : celle du jour reste adoptée', async () => {
    enqueue(cloture('exec-hier'));
    const today = await loadTodayExecution('seance-1', '2026-11-23');
    expect(today?.executionId).toBe('exec-1');
  });
});

// Lecture BORNÉE de l'exécution du jour (audit sync, constat 5) : hors ligne avec
// un jeton expiré, ou sur un wifi zombie, elle tenait l'ouverture de la séance.
describe('loadTodayExecutionWithin', () => {
  it('réponse dans le budget : c’est la vraie réponse, rien de tardif', async () => {
    server.openExecutionId = 'exec-1';

    const { today, late } = await loadTodayExecutionWithin('seance-1', '2026-11-23', null, 50);

    expect(today?.executionId).toBe('exec-1');
    expect(late).toBeNull();
  });

  it('absence confirmée dans le budget : null, et rien de tardif', async () => {
    server.openExecutionId = null;

    expect(await loadTodayExecutionWithin('seance-1', '2026-11-23', null, 50)).toEqual({
      today: null,
      late: null,
    });
  });

  it('délai dépassé : la séance n’attend pas, mais ce n’est pas une absence, la réponse tardive est rendue', async () => {
    server.openExecutionId = 'exec-1';
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { supabase } = await import('../../lib/supabase');
    const from = supabase.from.bind(supabase);
    // La première requête (l'exécution) pend jusqu'à l'ouverture de la vanne.
    const spy = vi.spyOn(supabase, 'from').mockImplementation(((table: string) => {
      const query = from(table as never) as unknown as { maybeSingle?: () => Promise<unknown> };
      if (table === 'executions' && query.maybeSingle) {
        const answer = query.maybeSingle.bind(query);
        query.maybeSingle = async () => {
          await gate;
          return answer();
        };
      }
      return query;
    }) as never);

    const { today, late } = await loadTodayExecutionWithin('seance-1', '2026-11-23', null, 20);
    expect(today).toBeNull();
    expect(late).not.toBeNull();

    release();
    expect((await late)?.executionId).toBe('exec-1');
    spy.mockRestore();
  });
});
