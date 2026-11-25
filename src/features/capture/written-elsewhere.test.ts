// La Salle cachée et ce que le Journal, Exos ou Séances écrivent sous elle.
//
// Le bug : la Salle reste montée, cachée, au changement d'onglet. Séance en
// cours, le Journal la corrige (une série retirée) ou la supprime ; au retour,
// la Salle ne relisait rien tant qu'une séance était ouverte. Le tableau gardait
// les séries périmées, la persistance réécrivait l'état effacé, et la série
// suivante partait vers une exécution supprimée sans être réaffirmée (elle ne
// l'est qu'une fois par montage du tableau).
//
// Logique pure : le marqueur posé par l'écrivain, la décision au retour, la clé
// qui remonte le tableau, et la persistance qui refuse une exécution supprimée.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  captureBoardKey,
  forgetPendingWrites,
  isExecutionRetired,
  markDefinitionsWritten,
  markExecutionCorrected,
  markExecutionDeleted,
  salleReturnAction,
  type SalleAtReturn,
} from './written-elsewhere';
import { initialState, loadPersisted, persist } from './state';
import { upperA } from './fixtures';
import { invalidateExerciseNoteCopy, invalidatePlanCopies } from './plan-copies';

const open = (executionId: string): SalleAtReturn => ({ phase: 'ready', closed: false, executionId });

afterEach(() => forgetPendingWrites());

describe('retour sur la Salle', () => {
  it('séance ouverte, rien écrit ailleurs : elle se retrouve telle quelle', () => {
    expect(salleReturnAction(open('exec-1'))).toBe('keep');
  });

  it('le Journal corrige la séance ouverte : le retour relance le chargement complet', () => {
    markExecutionCorrected('exec-1');
    expect(salleReturnAction(open('exec-1'))).toBe('reload');
  });

  it('le Journal supprime la séance ouverte : son état est effacé puis tout se relit', () => {
    markExecutionDeleted('exec-1');
    expect(salleReturnAction(open('exec-1'))).toBe('forget-and-reload');
  });

  it('une suppression n’est pas rétrogradée par une correction posée après', () => {
    markExecutionDeleted('exec-1');
    markExecutionCorrected('exec-1');
    expect(salleReturnAction(open('exec-1'))).toBe('forget-and-reload');
  });

  it('corriger une AUTRE séance (passée) ne coûte pas son brouillon à la séance ouverte', () => {
    markExecutionCorrected('exec-ancienne');
    markExecutionDeleted('exec-ancienne-2');
    expect(salleReturnAction(open('exec-1'))).toBe('keep');
  });

  it('un exo ou une séance modifiés pendant la séance : les définitions se relisent', () => {
    markDefinitionsWritten();
    expect(salleReturnAction(open('exec-1'))).toBe('reload');
  });

  it('le chargement relancé efface les marqueurs : le retour suivant garde la séance', () => {
    markExecutionCorrected('exec-1');
    markDefinitionsWritten();
    expect(salleReturnAction(open('exec-1'))).toBe('reload');
    forgetPendingWrites();
    expect(salleReturnAction(open('exec-1'))).toBe('keep');
  });

  it('en plein chargement, rien : le marqueur reste pour le retour suivant', () => {
    markExecutionCorrected('exec-1');
    expect(salleReturnAction({ phase: 'loading', closed: false, executionId: null })).toBe('keep');
    expect(salleReturnAction(open('exec-1'))).toBe('reload');
  });

  it('sans séance ouverte ou séance rangée : toujours relue, comme avant', () => {
    for (const phase of ['choosing', 'empty', 'error'] as const) {
      expect(salleReturnAction({ phase, closed: false, executionId: null })).toBe('reload');
    }
    expect(salleReturnAction({ phase: 'ready', closed: true, executionId: 'exec-1' })).toBe('reload');
  });
});

// Exos ou Séances modifiés pendant une séance ouverte en Salle : avant, le retour
// remontait la Salle, qui relisait nom, unilatéral et note de ses exos. Toute
// écriture du plan et toute note d'exo écrite hors de la file passent par
// l'invalidation des copies de la Capture (plan-copies.ts) : c'est là que le
// marqueur se pose, pour tous les écrans d'un coup. Le chargement relancé lit
// alors le réseau d'abord (copies périmées) ; la version de la séance entamée,
// elle, reste celle de son état local (`adoptedVersionId`).
describe('définitions écrites ailleurs', () => {
  it('une écriture du plan (exo, séance, version) relance le chargement au retour', () => {
    invalidatePlanCopies();
    expect(salleReturnAction(open('exec-1'))).toBe('reload');
  });

  it('une note d’exo écrite depuis Exos ou Séances aussi', () => {
    invalidateExerciseNoteCopy('exo-1');
    expect(salleReturnAction(open('exec-1'))).toBe('reload');
  });
});

describe('clé du tableau de capture', () => {
  it('change à chaque chargement, même sur la même exécution : le tableau est remonté, l’exécution réaffirmée', () => {
    // Les refs « exécution enfilée depuis ce montage » et « exécution née »
    // vivent dans le tableau : seul un remontage les remet à zéro, et donc
    // réenfile l'`upsertExecution` avant la série suivante.
    const before = captureBoardKey({ templateId: 'seance-1', executionId: 'exec-1', generation: 3 });
    const after = captureBoardKey({ templateId: 'seance-1', executionId: 'exec-1', generation: 4 });
    expect(after).not.toBe(before);
  });

  it('une adoption tardive (même génération, autre exécution) remonte aussi', () => {
    expect(captureBoardKey({ templateId: 's', executionId: 'provisoire', generation: 2 })).not.toBe(
      captureBoardKey({ templateId: 's', executionId: 'adoptee', generation: 2 }),
    );
  });
});

// Le tableau caché tient encore l'exécution supprimée : un rafraîchissement de
// la Référence (acquittement de la suppression) relance sa persistance. Elle ne
// doit pas réécrire l'état que le Journal vient d'effacer, sinon le retour
// reprendrait la séance supprimée au lieu de « Quelle séance ? ».
class MemoryStorage {
  private store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  key(i: number): string | null {
    return Array.from(this.store.keys())[i] ?? null;
  }
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
}

describe('persistance d’une exécution supprimée ailleurs', () => {
  const DATE = '2026-06-18';
  beforeEach(() => {
    (globalThis as unknown as { localStorage: Storage }).localStorage = new MemoryStorage() as unknown as Storage;
  });

  it('n’est plus jamais réécrite, même après l’effacement des marqueurs', () => {
    markExecutionDeleted('exec-supprimee-persist');
    forgetPendingWrites();
    expect(isExecutionRetired('exec-supprimee-persist')).toBe(true);
    persist({ ...initialState(upperA, DATE), executionId: 'exec-supprimee-persist' });
    expect(loadPersisted(upperA, DATE)).toBeNull();
  });

  it('une exécution corrigée, elle, continue de s’écrire', () => {
    markExecutionCorrected('exec-corrigee');
    persist({ ...initialState(upperA, DATE), executionId: 'exec-corrigee' });
    expect(loadPersisted(upperA, DATE)?.executionId).toBe('exec-corrigee');
  });
});
