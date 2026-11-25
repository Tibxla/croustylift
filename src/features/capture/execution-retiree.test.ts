// Une séance clôturée, annulée, supprimée ou quittée par « Changer de séance »
// dont l'écriture n'est pas encore acquittée n'est pas reprise par la Capture.
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
  /** Séries de l'exécution, telles que la base les rend. */
  sets: [] as { id: string; exercise_id: string; weight_kg: number; reps: number; rir: number; set_order: number; side: string | null }[],
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
      // Séries et notes de l'exécution : select → eq → order.
      const query = {
        select: () => query,
        eq: () => query,
        order: () =>
          Promise.resolve({ data: table === 'dated_notes' ? server.notes : server.sets, error: null }),
      };
      return query;
    }
    throw new Error(`table inattendue dans ce test : ${table}`);
  };
  return { supabase: { from } };
});

import { isExecutionRetired, loadTodayExecution, loadTodayExecutionWithin, type TodayExecution } from './data';
import { datedNotesReality, executionReality } from './execution-reality';
import { reconcileDatedNotes } from './state';
import { clearQueue, enqueue, writesSince, type LocalWrite, type OutboxOp } from './outbox';
import { otherTabAcknowledgesAll } from '../../test/registry';
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
/** Le ménage de « Changer de séance » : supprimée par la base si encore ouverte et vide. */
const changement = (id: string): OutboxOp => ({ type: 'deleteExecutionIfEmpty', id, exerciseIds: [] });

/** Des écritures locales telles que le registre les rend (`writesSince`). */
const writes = (ops: OutboxOp[], fate: LocalWrite['fate'] = 'pending'): LocalWrite[] =>
  ops.map((op, i) => ({ uid: `u${i}`, n: i + 1, op, fate }));
const isExecutionRetiredInQueue = (id: string, ops: OutboxOp[], carriesEntries = false) =>
  isExecutionRetired(id, writes(ops), carriesEntries);

/**
 * Ce que la Capture AFFICHE d'une lecture, au moment de s'en servir : sa
 * réponse, plus les écritures locales qu'elle ne contient pas.
 */
const shown = (today: TodayExecution) => {
  const since = writesSince(today.stamp);
  return {
    progress: executionReality({ executionId: today.executionId, read: today.progress, writes: since }),
    datedNotes: datedNotesReality(today.executionId, today.datedNotes, since),
  };
};

beforeEach(() => {
  (globalThis as unknown as { localStorage: Storage }).localStorage =
    new MemoryStorage() as unknown as Storage;
  saveLocalAccount({ userId: 'user-1', email: 'toi@exemple.com' });
  clearQueue();
  server.openExecutionId = 'exec-1';
  server.duringRead = null;
  server.notes = [];
  server.sets = [];
});

describe('isExecutionRetired (les écritures locales retirent-elles l’exécution ?)', () => {
  it('clôture ou suppression REFUSÉE par la base : elle ne retire rien', () => {
    expect(isExecutionRetired('exec-1', writes([cloture('exec-1')], 'refused'))).toBe(false);
    expect(isExecutionRetired('exec-1', writes([suppression('exec-1')], 'refused'))).toBe(false);
  });

  it('clôture ACQUITTÉE après le départ de la lecture : retirée, comme en attente', () => {
    expect(isExecutionRetired('exec-1', writes([cloture('exec-1')], 'acked'))).toBe(true);
  });

  it('clôture en attente de cette exécution : retirée', () => {
    expect(isExecutionRetiredInQueue('exec-1', [cloture('exec-1')])).toBe(true);
  });

  it('suppression en attente de cette exécution : retirée', () => {
    expect(isExecutionRetiredInQueue('exec-1', [suppression('exec-1')])).toBe(true);
  });

  it('suppression conditionnelle (« Changer de séance ») de cette exécution, vide : retirée', () => {
    expect(isExecutionRetiredInQueue('exec-1', [changement('exec-1')])).toBe(true);
  });

  it('suppression conditionnelle d’une exécution qui porte déjà une saisie : la base la garde, pas retirée', () => {
    expect(isExecutionRetiredInQueue('exec-1', [changement('exec-1')], true)).toBe(false);
    // Une suppression sans condition, elle, retire quoi qu'il y ait dedans.
    expect(isExecutionRetiredInQueue('exec-1', [suppression('exec-1')], true)).toBe(true);
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
    // Le flush lancé au même montage l'acquitte avant le retour de la lecture,
    // dont la réponse montre encore l'exécution ouverte.
    server.duringRead = () => otherTabAcknowledgesAll();
    expect(await loadTodayExecution('seance-1', '2026-11-23')).toBeNull();
  });

  // Le scénario : la séance s'ouvre à 18 h 00 (exec-1, son début acquitté), on
  // la quitte aussitôt par « Changer de séance » sans rien saisir. Sur un réseau
  // lent, la suppression conditionnelle attend encore quand on rouvre la même
  // séance vingt minutes plus tard : la base montre toujours exec-1 ouverte,
  // `started_at` à 18 h 00. Adoptée, la séance rouverte comptait ces vingt
  // minutes dans sa durée. Elle repart désormais vierge (nouvelle exécution,
  // nouveau début), et la suppression en file part comme prévu.
  it('« Changer de séance » pas encore envoyé : la séance quittée n’est pas réadoptée avec son ancien début', async () => {
    enqueue(changement('exec-1'));
    expect(await loadTodayExecution('seance-1', '2026-11-23')).toBeNull();
    expect(await loadTodayExecution('seance-1', '2026-11-23', 'exec-1')).toBeNull();
  });

  it('« Changer de séance » enfilé PENDANT la lecture : la réponse, partie avant, est écartée', async () => {
    server.duringRead = () => void enqueue(changement('exec-1'));
    expect(await loadTodayExecution('seance-1', '2026-11-23')).toBeNull();
  });

  it('« Changer de séance » acquitté PENDANT la lecture : la réponse, partie avant, est écartée', async () => {
    enqueue(changement('exec-1'));
    server.duringRead = () => otherTabAcknowledgesAll();
    expect(await loadTodayExecution('seance-1', '2026-11-23')).toBeNull();
  });

  it('« Changer de séance » en file, mais une série arrivée d’un autre appareil : la base garde l’exécution, elle reste adoptée', async () => {
    server.sets = [{ id: 'set-a', exercise_id: 'bench', weight_kg: 80, reps: 8, rir: 2, set_order: 1, side: null }];
    enqueue(changement('exec-1'));
    const today = await loadTodayExecution('seance-1', '2026-11-23');
    expect(today?.executionId).toBe('exec-1');
    expect(today?.progress.bench?.setIds).toEqual(['set-a']);
  });

  it('« Changer de séance » après une série loggée puis annulée ici : vide pour la base, pas réadoptée', async () => {
    // La série est encore en base, sa suppression attend devant le ménage.
    server.sets = [{ id: 'set-a', exercise_id: 'bench', weight_kg: 80, reps: 8, rir: 2, set_order: 1, side: null }];
    enqueue({ type: 'deleteSet', id: 'set-a', exerciseIds: ['bench'] });
    enqueue(changement('exec-1'));
    expect(await loadTodayExecution('seance-1', '2026-11-23')).toBeNull();
  });

  it('« Changer de séance » d’une note laissée par un autre onglet : la base garde l’exécution, elle reste adoptée', async () => {
    server.notes = [{ id: 'note-h', exercise_id: 'bench', body: 'coude gauche', created_at: '2026-11-23T18:05:00Z' }];
    enqueue(changement('exec-1'));
    expect((await loadTodayExecution('seance-1', '2026-11-23'))?.executionId).toBe('exec-1');
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

  it('rien en attente : les notes de la base sont rendues', async () => {
    const today = await loadTodayExecution('seance-1', '2026-11-23', 'exec-1');
    expect(Object.keys(shown(today!).datedNotes).sort()).toEqual(['bench', 'squat']);
  });

  it('effacement encore en attente au retour : la note n’est pas affichée', async () => {
    enqueue(effacement('bench'));
    const today = await loadTodayExecution('seance-1', '2026-11-23', 'exec-1');
    expect(Object.keys(shown(today!).datedNotes)).toEqual(['squat']);
  });

  it('effacement ACQUITTÉ pendant le trajet : la note n’est ni affichée ni réadoptée', async () => {
    enqueue(effacement('bench'));
    // Un autre onglet l'envoie pendant que la réponse, qui porte encore la
    // note, est en route.
    server.duringRead = () => otherTabAcknowledgesAll();
    const today = await loadTodayExecution('seance-1', '2026-11-23', 'exec-1');
    // La réponse BRUTE porte encore la note : c'est l'estampille qui l'écarte.
    expect(Object.keys(today!.datedNotes).sort()).toEqual(['bench', 'squat']);
    expect(Object.keys(shown(today!).datedNotes)).toEqual(['squat']);

    // La réponse tardive arrive sur une Capture qui ne connaît aucune note.
    expect(reconcileDatedNotes({}, shown(today!).datedNotes)).toEqual({ squat: { id: 'note-s', body: 'talons' } });
  });

  it('effacement enfilé PENDANT la lecture : la note n’est pas affichée', async () => {
    server.duringRead = () => void enqueue(effacement('squat'));
    const today = await loadTodayExecution('seance-1', '2026-11-23', 'exec-1');
    expect(Object.keys(shown(today!).datedNotes)).toEqual(['bench']);
  });

  it('effacement hérité (id seul) : retire la note de cet id, pas les autres', async () => {
    enqueue({ type: 'deleteDatedNote', id: 'note-s' });
    const today = await loadTodayExecution('seance-1', '2026-11-23', 'exec-1');
    expect(Object.keys(shown(today!).datedNotes)).toEqual(['bench']);
  });

  it('écriture (pas effacement) acquittée pendant le trajet : son corps passe par-dessus la version périmée de la base', async () => {
    enqueue({ type: 'upsertDatedNote', id: 'id-deterministe', executionId: 'exec-1', exerciseId: 'bench', body: 'corrigée' });
    server.duringRead = () => otherTabAcknowledgesAll();
    const today = await loadTodayExecution('seance-1', '2026-11-23', 'exec-1');
    expect(shown(today!).datedNotes).toEqual({
      bench: { id: 'note-h', body: 'corrigée' },
      squat: { id: 'note-s', body: 'talons' },
    });
  });

  it('effacement d’une note d’une AUTRE exécution : sans effet', async () => {
    enqueue({ type: 'deleteDatedNote', id: 'x', executionId: 'exec-2', exerciseId: 'bench' });
    const today = await loadTodayExecution('seance-1', '2026-11-23', 'exec-1');
    expect(Object.keys(shown(today!).datedNotes).sort()).toEqual(['bench', 'squat']);
  });
});

// Les écritures de séries suivent la même estampille : la Capture applique sur
// la réponse, partie avant elles, celles qui attendaient au départ (même
// acquittées pendant le trajet) et celles enfilées pendant.
describe('loadTodayExecution et les écritures de séries', () => {
  const serie = (id: string, setOrder: number): OutboxOp => ({
    type: 'insertSet',
    id,
    executionId: 'exec-1',
    exerciseId: 'bench',
    setOrder,
    weightKg: 80,
    reps: 8,
    rir: 2,
  });

  it('acquittées pendant le trajet ou enfilées pendant : toutes appliquées, dans l’ordre', async () => {
    server.sets = [{ id: 'a', exercise_id: 'bench', weight_kg: 80, reps: 8, rir: 2, set_order: 1, side: null }];
    enqueue({ type: 'deleteSet', id: 'a' });
    enqueue(serie('b', 1));
    server.duringRead = () => {
      otherTabAcknowledgesAll(); // un autre onglet a tout envoyé pendant le trajet
      enqueue(serie('c', 2)); // et le Journal a écrit de nouveau
    };
    const today = await loadTodayExecution('seance-1', '2026-11-23', 'exec-1');
    expect(writesSince(today!.stamp).map((w) => `${w.op.type}:${w.op.id}:${w.fate}`)).toEqual([
      'deleteSet:a:acked',
      'insertSet:b:acked',
      'insertSet:c:pending',
    ]);
    // La réponse, figée au départ, porte encore `a` ; le tableau montre b et c.
    expect(today!.progress.bench?.setIds).toEqual(['a']);
    expect(shown(today!).progress.bench?.setIds).toEqual(['b', 'c']);
  });

  it('rien de local : la réponse telle quelle', async () => {
    const today = await loadTodayExecution('seance-1', '2026-11-23', 'exec-1');
    expect(writesSince(today!.stamp)).toEqual([]);
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
