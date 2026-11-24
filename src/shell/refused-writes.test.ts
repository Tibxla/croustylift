import { describe, expect, it } from 'vitest';
import type { RefusedWrite } from '../features/capture/outbox';
import { dependentsOf, describeRefusal, fmtDay, fmtWhen, refusalReason } from './refused-writes';

const at = '2026-11-24T13:05:00.000Z';
const lookup = { exerciseName: (id: string) => (id === 'ex1' ? 'Développé couché' : undefined) };
const entry = (op: RefusedWrite['op'], reason = '23514 : new row violates check constraint "sets_reps_check"', extra: Partial<RefusedWrite> = {}): RefusedWrite => ({
  op,
  reason,
  at,
  refusalId: 'r1',
  ...extra,
});

describe('saisies refusées lues par un humain', () => {
  it('une série dit son rang, son exo et ses valeurs', () => {
    const t = describeRefusal(
      entry({ type: 'insertSet', id: 's', executionId: 'x', exerciseId: 'ex1', setOrder: 3, weightKg: 82.5, reps: 8, rir: 2 }),
      lookup,
    );
    expect(t.what).toBe('Série 3 · Développé couché');
    expect(t.detail).toBe('82,5 kg × 8 · RIR 2');
    expect(t.retryable).toBe(true);
  });

  it('un exo inconnu sur l’appareil ne laisse pas de nom vide', () => {
    const t = describeRefusal(
      entry({ type: 'insertSet', id: 's', executionId: 'x', exerciseId: 'autre', setOrder: 1, weightKg: 0, reps: 10, rir: 0, side: 'left', only: 'values' }),
      lookup,
    );
    expect(t.what).toBe('Série 1');
    expect(t.detail).toBe('correction · 0 kg × 10 · RIR 0 · gauche');
  });

  it('chaque type d’écriture a sa phrase', () => {
    const ops: RefusedWrite['op'][] = [
      { type: 'upsertExecution', id: 'x', seanceVersionId: 'v', performedOn: '2026-11-24' },
      { type: 'deleteSet', id: 's', exerciseIds: ['ex1'] },
      { type: 'updateExecution', id: 'x', closedAt: at, durationMin: 52 },
      { type: 'upsertDatedNote', id: 'n', executionId: 'x', exerciseId: 'ex1', body: 'Épaule  sensible' },
      { type: 'deleteDatedNote', id: 'n' },
      { type: 'upsertExerciseNote', id: 'ex1', body: 'Coudes serrés' },
      { type: 'deleteExerciseNote', id: 'ex1' },
      { type: 'deleteExecution', id: 'x' },
      { type: 'deleteExecutionIfEmpty', id: 'x' },
    ];
    const whats = ops.map((op) => describeRefusal(entry(op), lookup).what);
    expect(whats).toEqual([
      'Début de la séance du 24 nov.',
      'Suppression d’une série · Développé couché',
      'Fin de séance',
      'Note de séance · Développé couché',
      'Effacement d’une note de séance',
      'Note d’instructions · Développé couché',
      'Effacement d’une note d’instructions · Développé couché',
      'Suppression d’une séance',
      'Retrait d’une séance vide',
    ]);
    expect(describeRefusal(entry(ops[2]!), lookup).detail).toBe('séance rangée · durée 52 min');
    expect(describeRefusal(entry(ops[3]!), lookup).detail).toBe('Épaule sensible');
  });

  it('la raison dit si renvoyer peut servir, sans code ni consigne impossible', () => {
    const op = { type: 'deleteExecution', id: 'x' } as const;
    for (const code of ['23514', '22003', '22001', '23502']) {
      expect(refusalReason(entry(op, `${code} : new row violates something`))).toBe(
        'Une valeur dépasse ce que le serveur accepte : la renvoyer échouera encore. Abandonne-la et ressaisis-la.',
      );
    }
    expect(refusalReason(entry(op, '23503 : insert or update on table "sets" violates foreign key constraint "x"'))).toBe(
      'Elle visait un élément supprimé depuis un autre appareil. Abandonne-la.',
    );
    expect(refusalReason(entry(op, '42501 : new row violates row-level security policy for table "sets"'))).toMatch(/^Action refusée/);
    // Un motif écrit par un trigger, en français, passe tel quel, même sous un code de valeur.
    expect(refusalReason(entry(op, '23514 : La routine courante ne s’archive pas.'))).toBe('La routine courante ne s’archive pas.');
    expect(refusalReason(entry(op, '42P01 : relation "x" does not exist'))).toBe('Le serveur l’a refusée sans dire pourquoi.');
    expect(refusalReason(entry(op, ''))).toBe('Le serveur l’a refusée sans dire pourquoi.');
  });

  it('une saisie retenue par sa séance ne se renvoie pas seule et part avec elle', () => {
    const exec = entry({ type: 'upsertExecution', id: 'x1', seanceVersionId: 'v', performedOn: '2026-11-24' }, '23503 : fk');
    const set = { ...entry({ type: 'insertSet', id: 's', executionId: 'x1', exerciseId: 'e', setOrder: 1, weightKg: 1, reps: 1, rir: 1 }, "dépend de l'exécution x1, en quarantaine"), refusalId: 'r2' };
    const other = { ...entry({ type: 'insertSet', id: 't', executionId: 'x2', exerciseId: 'e', setOrder: 1, weightKg: 1, reps: 1, rir: 1 }, "dépend de l'exécution x2, en quarantaine"), refusalId: 'r3' };
    const t = describeRefusal(set, lookup);
    expect(t.reason).toBe('Elle repart avec sa séance.');
    expect(t.retryable).toBe(false);
    expect(dependentsOf(exec, [exec, set, other])).toEqual([set]);
    expect(dependentsOf(set, [exec, set])).toEqual([]);
  });

  it('une création de séance dépassée ne se renvoie pas', () => {
    const t = describeRefusal(entry({ type: 'upsertExecution', id: 'x', seanceVersionId: 'v', performedOn: '2026-11-24' }, '23505 : dup', { superseded: true }), lookup);
    expect(t.retryable).toBe(false);
    expect(t.reason).toMatch(/créée depuis/);
  });

  it('les dates se lisent en français', () => {
    expect(fmtDay('2026-03-05')).toBe('5 mars');
    expect(fmtWhen(at)).toMatch(/^le 24 nov\. à \d{1,2} h 05$/);
  });
});
