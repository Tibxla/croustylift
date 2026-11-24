import { describe, expect, it } from 'vitest';
import type { RefusedWrite } from '../features/capture/outbox';
import { describeRefusal, fmtDay, fmtWhen, refusalReason } from './refused-writes';

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
      'Séance du 24 nov.',
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

  it('la raison passe par les messages français de l’app', () => {
    expect(refusalReason(entry({ type: 'deleteExecution', id: 'x' }))).toMatch(/^Enregistrement refusé : une valeur sort des limites/);
    expect(
      refusalReason(entry({ type: 'deleteExecution', id: 'x' }, '42501 : new row violates row-level security policy for table "sets"')),
    ).toMatch(/^Action refusée/);
    expect(refusalReason(entry({ type: 'deleteExecution', id: 'x' }, 'P0001 : La routine courante ne s’archive pas.'))).toBe(
      'La routine courante ne s’archive pas.',
    );
    expect(refusalReason(entry({ type: 'insertSet', id: 's', executionId: 'x', exerciseId: 'e', setOrder: 1, weightKg: 1, reps: 1, rir: 1 }, 'dépend de l\'exécution x, en quarantaine'))).toMatch(
      /^La séance dont elle dépend/,
    );
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
