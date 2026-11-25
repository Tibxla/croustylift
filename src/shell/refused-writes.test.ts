import { describe, expect, it } from 'vitest';
import type { OutboxOp, RefusedWrite } from '../features/capture/outbox';
import {
  abandonWarning,
  canRetry,
  describeRefusal,
  fmtDay,
  fmtWhen,
  GESTURE_TEXT,
  refusalReason,
} from './refused-writes';

const at = '2026-11-24T13:05:00.000Z';
const lookup = { exerciseName: (id: string) => (id === 'ex1' ? 'Développé couché' : undefined) };
const entry = (op: RefusedWrite['op'], reason = '23514 : new row violates check constraint "sets_reps_check"', extra: Partial<RefusedWrite> = {}): RefusedWrite => ({
  op,
  reason,
  at,
  refusalId: 'r1',
  dependents: [],
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
    // Valeur refusée : la renvoyer échouerait à l'identique.
    expect(t.retryable).toBe(false);
    expect(canRetry({ reason: '42501 : new row violates row-level security policy' })).toBe(true);
    expect(canRetry({ reason: '23503 : insert violates foreign key constraint "x"' })).toBe(false);
    expect(canRetry({ reason: '23514 : La routine courante ne s’archive pas.' })).toBe(true);
  });

  it('un exo inconnu sur l’appareil ne laisse pas de nom vide', () => {
    const t = describeRefusal(
      entry({ type: 'patchSet', id: 's', executionId: 'x', exerciseId: 'autre', setOrder: 1, weightKg: 0, reps: 10, rir: 0, side: 'left', only: 'values' }),
      lookup,
    );
    expect(t.what).toBe('Série 1');
    expect(t.detail).toBe('correction · 0 kg × 10 · RIR 0 · gauche');
  });

  it('une remontée de rang refusée le dit', () => {
    const t = describeRefusal(
      entry({ type: 'patchSet', id: 's', executionId: 'x', exerciseId: 'ex1', setOrder: 2, weightKg: 80, reps: 8, rir: 1, only: 'rank' }),
      lookup,
    );
    expect(t.what).toBe('Série 2 · Développé couché');
    expect(t.detail).toBe('nouveau rang · 80 kg × 8 · RIR 1');
  });

  it('chaque type d’écriture a sa phrase', () => {
    const ops: RefusedWrite['op'][] = [
      { type: 'upsertExecution', id: 'x', seanceVersionId: 'v', performedOn: '2026-11-24' },
      { type: 'insertSet', id: 's', executionId: 'x', exerciseId: 'ex1', setOrder: 3, weightKg: 80, reps: 8, rir: 2 },
      { type: 'patchSet', id: 's', executionId: 'x', exerciseId: 'ex1', setOrder: 3, weightKg: 80, reps: 8, rir: 2, only: 'values' },
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
      'Série 3 · Développé couché',
      'Série 3 · Développé couché',
      'Suppression d’une série · Développé couché',
      'Fin de séance',
      'Note de séance · Développé couché',
      'Effacement d’une note de séance',
      'Note d’instructions · Développé couché',
      'Effacement d’une note d’instructions · Développé couché',
      'Suppression d’une séance',
      'Retrait d’une séance vide',
    ]);
    expect(describeRefusal(entry(ops[4]!), lookup).detail).toBe('séance rangée · durée 52 min');
    expect(describeRefusal(entry(ops[5]!), lookup).detail).toBe('Épaule sensible');
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

  it('donnée mal formée (22P02 et les autres refus de données, classe 22) : pas de « Renvoyer », abandonner puis ressaisir, jamais recharger', () => {
    const op = { type: 'insertSet', id: 's', executionId: 'x', exerciseId: 'ex1', setOrder: 1, weightKg: 80, reps: 8, rir: 2 } as const;
    const malformed = [
      '22P02 : invalid input syntax for type uuid: "abc"',
      '22007 : invalid input syntax for type date: "2026-13-40"',
      '22008 : date/time field value out of range: "2026-02-30"',
      '22023 : invalid parameter value',
      '22004 : null value not allowed',
      '22P05 : unsupported Unicode escape sequence',
    ];
    for (const reason of malformed) {
      const t = describeRefusal(entry(op, reason), lookup);
      expect(t.retryable, reason).toBe(false);
      expect(canRetry({ reason }), reason).toBe(false);
      expect(t.reason, reason).toBe('Une donnée est mal formée : la renvoyer échouera encore. Abandonne-la et ressaisis-la.');
    }
  });

  it('aucun motif de la feuille ne dit de recharger l’écran', () => {
    const op = { type: 'deleteExecution', id: 'x' } as const;
    const codes = ['22P02', '22001', '22003', '22007', '22012', '23502', '23503', '23505', '23514', '23P01', '42501', 'PGRST116', '57014'];
    for (const code of codes) {
      expect(refusalReason(entry(op, `${code} : something went wrong`)), code).not.toMatch(/[Rr]echarge/);
    }
  });

  it('une saisie retenue par sa séance ne se renvoie pas seule et part avec elle', () => {
    // Le registre dit QUI la retient (`heldBy`) : la feuille ne lit aucun motif.
    const set = entry({ type: 'insertSet', id: 's', executionId: 'x1', exerciseId: 'e', setOrder: 1, weightKg: 1, reps: 1, rir: 1 }, '', {
      refusalId: 'r2',
      heldBy: 'r1',
    });
    const t = describeRefusal(set, lookup);
    expect(t.reason).toBe('Elle repart avec sa séance.');
    expect(t.retryable).toBe(false);
  });

  it('un motif qui ressemble à une dépendance ne retient rien : seul le registre le dit', () => {
    const set = entry({ type: 'insertSet', id: 's', executionId: 'x1', exerciseId: 'e', setOrder: 1, weightKg: 1, reps: 1, rir: 1 }, "dépend de l'exécution x1, en quarantaine");
    expect(describeRefusal(set, lookup).reason).not.toBe('Elle repart avec sa séance.');
    expect(canRetry(set)).toBe(true);
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

// Ce que l'abandon emporte : le registre rend les écritures qui dépendent de la
// saisie (`dependents`), la confirmation de la feuille les nomme.
describe('ce que l’abandon d’une saisie emporte avec elle', () => {
  const insert: OutboxOp = { type: 'insertSet', id: 'set-3', executionId: 'x', exerciseId: 'ex1', setOrder: 3, weightKg: 9999, reps: 8, rir: 2 };
  const correction: OutboxOp = { type: 'patchSet', id: 'set-3', executionId: 'x', exerciseId: 'ex1', setOrder: 3, weightKg: 82.5, reps: 8, rir: 2, only: 'values' };

  it('rien n’en dépend : rien à dire', () => {
    expect(abandonWarning(entry(insert))).toBe('');
  });

  it('une série refusée emporte sa correction, et la confirmation le dit', () => {
    expect(abandonWarning(entry(insert, '23514 : check', { dependents: [correction] }))).toBe(
      'Ta correction de la série 3 sera aussi abandonnée.',
    );
    expect(abandonWarning(entry(insert, '23514 : check', { dependents: [correction, correction] }))).toBe(
      'Tes 2 corrections de la série 3 seront aussi abandonnées.',
    );
  });

  it('le début d’une séance emporte les saisies qu’il retenait', () => {
    const exec: OutboxOp = { type: 'upsertExecution', id: 'x', seanceVersionId: 'v', performedOn: '2026-11-24' };
    expect(abandonWarning(entry(exec, '23503 : fk', { dependents: [insert] }))).toBe('La saisie qui en dépend part avec elle.');
    expect(abandonWarning(entry(exec, '23503 : fk', { dependents: [insert, correction] }))).toBe(
      'Les 2 saisies qui en dépendent partent avec elle.',
    );
  });

  it('une remontée de rang qui en dépend n’est pas une « correction »', () => {
    const rank: OutboxOp = { ...correction, only: 'rank' } as OutboxOp;
    expect(abandonWarning(entry(insert, '23514 : check', { dependents: [rank] }))).toBe('La saisie qui en dépend part avec elle.');
  });
});

describe('un geste de la feuille qui n’a rien fait', () => {
  it('dit pourquoi, sans parler de stockage', () => {
    expect(GESTURE_TEXT.gone).toMatch(/déjà été réglée/);
    expect(GESTURE_TEXT.busy).toMatch(/Réessaie/);
  });
});
