// Tests de la règle d'archivage (ADR 0017) : ce qui a déjà été exécuté
// s'archive, ce qui ne l'a jamais été se supprime, la routine courante ne
// s'archive pas.
import { describe, expect, it } from 'vitest';
import { executedRoutineIds, planRowActions } from './archive';

describe('executedRoutineIds', () => {
  it('une routine a un historique dès qu’une de ses séances a été exécutée', () => {
    const seances = [
      { id: 's1', routine_id: 'r1' },
      { id: 's2', routine_id: 'r1' },
      { id: 's3', routine_id: 'r2' },
    ];
    expect([...executedRoutineIds(seances, new Set(['s2']))]).toEqual(['r1']);
  });

  it('aucune exécution : aucune routine', () => {
    expect(executedRoutineIds([{ id: 's1', routine_id: 'r1' }], new Set()).size).toBe(0);
  });
});

describe('planRowActions', () => {
  it('jamais exécutée : se supprime, ne s’archive pas', () => {
    expect(planRowActions({ executed: false, archived: false, isCurrent: false })).toEqual({
      canArchive: false,
      canDelete: true,
      canUnarchive: false,
    });
  });

  it('déjà exécutée : s’archive, ne se supprime plus', () => {
    expect(planRowActions({ executed: true, archived: false, isCurrent: false })).toEqual({
      canArchive: true,
      canDelete: false,
      canUnarchive: false,
    });
  });

  it('routine courante exécutée : ni archivage ni suppression', () => {
    expect(planRowActions({ executed: true, archived: false, isCurrent: true })).toEqual({
      canArchive: false,
      canDelete: false,
      canUnarchive: false,
    });
  });

  it('routine courante jamais exécutée : se supprime encore', () => {
    expect(planRowActions({ executed: false, archived: false, isCurrent: true }).canDelete).toBe(true);
  });

  it('archivée : seul le désarchivage est proposé', () => {
    expect(planRowActions({ executed: true, archived: true, isCurrent: false })).toEqual({
      canArchive: false,
      canDelete: false,
      canUnarchive: true,
    });
  });
});
