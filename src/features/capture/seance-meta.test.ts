// Méta de « Quelle séance ? » : quand chaque séance a été faite pour la dernière
// fois, et combien d'exos elle compte. Parties pures : la phrase et la fusion
// avec les exécutions qui attendent dans la file.
import { describe, expect, it } from 'vitest';
import { mergePendingExecutions, seanceMetaLine, type SeanceMeta } from './seance-meta';
import type { OutboxOp } from './outbox';

// Mardi 24 novembre 2026.
const TODAY = '2026-11-24';

describe('seanceMetaLine', () => {
  it('cette semaine : le jour de la semaine, puis le nombre d’exos', () => {
    expect(seanceMetaLine({ lastOn: '2026-11-19', exerciseCount: 6 }, TODAY)).toBe('dernière fois jeudi · 6 exos');
    expect(seanceMetaLine({ lastOn: '2026-11-18', exerciseCount: 4 }, TODAY)).toBe('dernière fois mercredi · 4 exos');
  });

  it('aujourd’hui et hier se disent ainsi', () => {
    expect(seanceMetaLine({ lastOn: TODAY, exerciseCount: 6 }, TODAY)).toBe('dernière fois aujourd’hui · 6 exos');
    expect(seanceMetaLine({ lastOn: '2026-11-23', exerciseCount: 6 }, TODAY)).toBe('dernière fois hier · 6 exos');
  });

  it('une semaine ou plus : la date', () => {
    expect(seanceMetaLine({ lastOn: '2026-11-17', exerciseCount: 6 }, TODAY)).toBe('dernière fois le 17 nov. · 6 exos');
    expect(seanceMetaLine({ lastOn: '2026-03-02', exerciseCount: 6 }, TODAY)).toBe('dernière fois le 2 mars · 6 exos');
  });

  it('une autre année : la date avec l’année', () => {
    expect(seanceMetaLine({ lastOn: '2025-12-30', exerciseCount: 6 }, TODAY)).toBe('dernière fois le 30 déc. 2025 · 6 exos');
  });

  it('jamais faite', () => {
    expect(seanceMetaLine({ lastOn: null, exerciseCount: 5 }, TODAY)).toBe('jamais faite · 5 exos');
  });

  it('un seul exo, aucun exo', () => {
    expect(seanceMetaLine({ lastOn: null, exerciseCount: 1 }, TODAY)).toBe('jamais faite · 1 exo');
    expect(seanceMetaLine({ lastOn: null, exerciseCount: 0 }, TODAY)).toBe('jamais faite · aucun exo');
  });

  it('rien de connu (ni copie ni réseau) : rien, pas « jamais faite »', () => {
    expect(seanceMetaLine(null, TODAY)).toBeNull();
  });
});

describe('mergePendingExecutions', () => {
  const meta: Record<string, SeanceMeta & { versionIds: string[]; lastExecutionId: string | null }> = {
    a: { lastOn: '2026-11-17', exerciseCount: 6, versionIds: ['a1', 'a2'], lastExecutionId: 'e-old' },
    b: { lastOn: null, exerciseCount: 4, versionIds: ['b1'], lastExecutionId: null },
  };
  const upsert = (id: string, seanceVersionId: string, performedOn: string): OutboxOp =>
    ({ type: 'upsertExecution', id, seanceVersionId, performedOn }) as OutboxOp;

  it('une exécution en file (séance faite hors ligne) avance la dernière fois de SA séance', () => {
    const out = mergePendingExecutions(meta, [upsert('e1', 'a1', '2026-11-24')]);
    expect(out.a).toEqual({ lastOn: '2026-11-24', exerciseCount: 6 });
    expect(out.b).toEqual({ lastOn: null, exerciseCount: 4 });
  });

  it('une séance jamais faite devient faite par une exécution en file, toute version comptée', () => {
    expect(mergePendingExecutions(meta, [upsert('e2', 'b1', '2026-11-23')]).b?.lastOn).toBe('2026-11-23');
  });

  it('une exécution en file plus ancienne ne recule pas la date', () => {
    expect(mergePendingExecutions(meta, [upsert('e1', 'a2', '2026-11-10')]).a?.lastOn).toBe('2026-11-17');
  });

  it('une exécution annulée dans la file ne compte pas', () => {
    const ops = [upsert('e1', 'a1', '2026-11-24'), { type: 'deleteExecution', id: 'e1' } as OutboxOp];
    expect(mergePendingExecutions(meta, ops).a?.lastOn).toBe('2026-11-17');
  });

  it('la dernière exécution lue en base, supprimée dans la file : la date n’est plus sûre, rien', () => {
    const out = mergePendingExecutions(meta, [{ type: 'deleteExecution', id: 'e-old' } as OutboxOp]);
    expect(out.a).toBeNull();
  });
});
