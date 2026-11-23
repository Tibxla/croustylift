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
  /** Notes datées de l'exécution, telles que la base les rend. */
  notes: [] as { id: string; exercise_id: string; body: string; created_at: string }[],
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
      // Séries et notes de l'exécution : select → eq → order. Aucune série ici.
      const query = {
        select: () => query,
        eq: () => query,
        order: () =>
          Promise.resolve({ data: table === 'dated_notes' ? server.notes : [], error: null }),
      };
      return query;
    }
    throw new Error(`table inattendue dans ce test : ${table}`);
  };
  return { supabase: { from } };
});

import { isExecutionRetiredInQueue, loadTodayExecution, loadTodayExecutionWithin } from './data';
import { reconcileDatedNotes } from './state';
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
  server.notes = [];
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
// Une note datée effacée quitte l'état local dès le geste ; la base la porte
// tant que l'effacement n'est pas acquitté, et la réponse d'une lecture partie
// avant la porte encore APRÈS. Sans lecture de la file aux deux bouts, la note
// revenait dans la Capture (au montage, ou par une réponse tardive).
describe('loadTodayExecution et les écritures de notes en attente', () => {
  const noteBench = { id: 'note-h', exercise_id: 'bench', body: 'coude gauche', created_at: '2026-11-23T18:05:00Z' };
  const noteSquat = { id: 'note-s', exercise_id: 'squat', body: 'talons', created_at: '2026-11-23T18:06:00Z' };
  const effacement = (exerciseId: string): OutboxOp => ({
    type: 'deleteDatedNote',
    id: 'id-deterministe',
    executionId: 'exec-1',
    exerciseId,
  });

  beforeEach(() => {
    server.notes = [noteBench, noteSquat];
  });

  it('rien en attente : les notes de la base sont rendues, aucune clé relevée', async () => {
    const today = await loadTodayExecution('seance-1', '2026-11-23', 'exec-1');
    expect(Object.keys(today!.datedNotes).sort()).toEqual(['bench', 'squat']);
    expect(today!.pendingNoteKeys).toEqual([]);
  });

  it('effacement encore en file au retour : la note n’est pas rendue', async () => {
    enqueue(effacement('bench'));
    const today = await loadTodayExecution('seance-1', '2026-11-23', 'exec-1');
    expect(Object.keys(today!.datedNotes)).toEqual(['squat']);
    expect(today!.pendingNoteKeys).toEqual(['bench']);
  });

  it('effacement ACQUITTÉ pendant le trajet (file vide au retour) : la note n’est ni rendue ni réadoptée', async () => {
    enqueue(effacement('bench'));
    // Un autre onglet vide la file pendant que la réponse, qui porte encore la
    // note, est en route.
    server.duringRead = () => clearQueue();
    const today = await loadTodayExecution('seance-1', '2026-11-23', 'exec-1');
    expect(Object.keys(today!.datedNotes)).toEqual(['squat']);
    expect(today!.pendingNoteKeys).toEqual(['bench']);

    // La réponse tardive arrive sur une Capture qui ne connaît aucune note : la
    // file relue à l'arrivée est vide, seules les clés relevées par la lecture
    // retiennent la note effacée.
    const adoptees = reconcileDatedNotes({}, { bench: { id: 'note-h', body: 'coude gauche' }, ...today!.datedNotes }, today!.pendingNoteKeys);
    expect(adoptees).toEqual({ squat: { id: 'note-s', body: 'talons' } });
  });

  it('effacement enfilé PENDANT la lecture : la note n’est pas rendue', async () => {
    server.duringRead = () => void enqueue(effacement('squat'));
    const today = await loadTodayExecution('seance-1', '2026-11-23', 'exec-1');
    expect(Object.keys(today!.datedNotes)).toEqual(['bench']);
  });

  it('effacement hérité (id seul) : retire la note de cet id, pas les autres', async () => {
    enqueue({ type: 'deleteDatedNote', id: 'note-s' });
    const today = await loadTodayExecution('seance-1', '2026-11-23', 'exec-1');
    expect(Object.keys(today!.datedNotes)).toEqual(['bench']);
    expect(today!.pendingNoteKeys).toEqual(['note-s']);
  });

  it('écriture (pas effacement) en attente : la note de la base reste rendue, sa clé est relevée', async () => {
    enqueue({ type: 'upsertDatedNote', id: 'id-deterministe', executionId: 'exec-1', exerciseId: 'bench', body: 'corrigée' });
    server.duringRead = () => clearQueue();
    const today = await loadTodayExecution('seance-1', '2026-11-23', 'exec-1');
    expect(Object.keys(today!.datedNotes).sort()).toEqual(['bench', 'squat']);
    // La version de la base est périmée pour cet exo : elle ne sera pas adoptée.
    expect(today!.pendingNoteKeys).toEqual(['bench']);
    expect(reconcileDatedNotes({}, today!.datedNotes, today!.pendingNoteKeys)).toEqual({
      squat: { id: 'note-s', body: 'talons' },
    });
  });

  it('effacement d’une note d’une AUTRE exécution : sans effet', async () => {
    enqueue({ type: 'deleteDatedNote', id: 'x', executionId: 'exec-2', exerciseId: 'bench' });
    const today = await loadTodayExecution('seance-1', '2026-11-23', 'exec-1');
    expect(Object.keys(today!.datedNotes).sort()).toEqual(['bench', 'squat']);
    expect(today!.pendingNoteKeys).toEqual([]);
  });
});

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
