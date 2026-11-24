import { beforeEach, describe, expect, it } from 'vitest';
import { clearQueue, enqueue, type RefusedWrite } from '../features/capture/outbox';
import { saveLocalAccount } from '../lib/local-account';
import {
  canRetry,
  dependentsOf,
  describeRefusal,
  fmtDay,
  fmtWhen,
  refusalReason,
  RESEND_BLOCK_TEXT,
  resendBlock,
} from './refused-writes';

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

// « Renvoyer » qui ne remet rien en file (`retryRefused` rend faux) : la feuille
// dit pourquoi, avec le même prédicat que la file (`setWriteQueued`, même série
// et même compte). Une suppression de la série en file n'est pas un stockage plein.
describe('pourquoi « Renvoyer » n’a rien renvoyé', () => {
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

  const refused = (owner: string | undefined = 'user-1'): RefusedWrite =>
    entry({ type: 'insertSet', id: 'set-1', executionId: 'x', exerciseId: 'ex1', setOrder: 2, weightKg: 80, reps: 8, rir: 2, ...(owner ? { _owner: owner } : {}) }, '42501 : new row violates row-level security policy');

  beforeEach(() => {
    (globalThis as unknown as { localStorage: Storage }).localStorage = new MemoryStorage() as unknown as Storage;
    saveLocalAccount({ userId: 'user-1', email: 'toi@exemple.com' });
    clearQueue();
  });

  it('une suppression de cette série attend : le refus partira avec elle', () => {
    enqueue({ type: 'deleteSet', id: 'set-1', exerciseIds: ['ex1'] });
    expect(resendBlock(refused(), true)).toBe('deletion-queued');
    expect(RESEND_BLOCK_TEXT['deletion-queued']).toBe('Une suppression de cette série attend déjà l’envoi : ce refus partira avec elle.');
  });

  it('une correction de cette série attend : elle partira avec', () => {
    enqueue({ type: 'patchSet', id: 'set-1', executionId: 'x', exerciseId: 'ex1', setOrder: 2, weightKg: 82.5, reps: 8, rir: 2, only: 'values' });
    expect(resendBlock(refused(), true)).toBe('correction-queued');
  });

  it('correction ET suppression en file : la suppression l’emporte', () => {
    enqueue({ type: 'patchSet', id: 'set-1', executionId: 'x', exerciseId: 'ex1', setOrder: 2, weightKg: 82.5, reps: 8, rir: 2, only: 'values' });
    enqueue({ type: 'deleteSet', id: 'set-1', exerciseIds: ['ex1'] });
    expect(resendBlock(refused(), true)).toBe('deletion-queued');
  });

  it('la suppression d’une AUTRE série, ou celle d’un autre compte, ne compte pas : stockage', () => {
    enqueue({ type: 'deleteSet', id: 'set-2', exerciseIds: ['ex1'] });
    expect(resendBlock(refused(), true)).toBe('storage');
    expect(resendBlock(refused('user-2'), true)).toBe('storage');
    expect(RESEND_BLOCK_TEXT.storage).toMatch(/stockage/);
  });

  it('l’entrée a disparu : réglée depuis un autre onglet', () => {
    expect(resendBlock(refused(), false)).toBe('settled');
  });
});
