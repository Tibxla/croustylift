import { describe, it, expect } from 'vitest';
import type { Prescription, PerformedSet } from './types';
import { deriveDeviations } from './deviation';

// Construit une prescription en ne fixant que la fourchette de séries ;
// reps et RIR sont hors périmètre de ce module mais requis par le type.
function prescriptionWithSets(min: number, max: number): Prescription {
  return {
    sets: { min, max },
    reps: { min: 8, max: 12 },
    rir: { min: 1, max: 3 },
  };
}

// Fabrique `count` séries de travail quelconques (le contenu de chaque série
// n'importe pas ici : seul le NOMBRE de séries est comparé à la prescription).
function performedSets(count: number): PerformedSet[] {
  return Array.from({ length: count }, (_, i) => ({
    weightKg: 100,
    reps: 10,
    rir: 2,
    order: i + 1,
  }));
}

// Fabrique `count` séries UNILATÉRALES : chacune tient sur DEUX lignes (gauche +
// droite) au MÊME `order`, soit 2 × count lignes. Sert à prouver qu'on compare
// des séries logiques (orders distincts), pas des lignes.
function unilateralSets(count: number): PerformedSet[] {
  const sets: PerformedSet[] = [];
  for (let i = 0; i < count; i++) {
    const order = i + 1;
    sets.push({ weightKg: 100, reps: 10, rir: 2, order, side: 'left' });
    sets.push({ weightKg: 100, reps: 10, rir: 2, order, side: 'right' });
  }
  return sets;
}

describe('deriveDeviations — déviations de compte de séries', () => {
  it('ne renvoie aucune déviation quand le compte est dans la fourchette', () => {
    const prescription = prescriptionWithSets(3, 4);
    expect(deriveDeviations(prescription, performedSets(3))).toEqual([]);
  });

  it('signale "skipped" quand aucune série n\'a été faite', () => {
    const prescription = prescriptionWithSets(3, 4);
    expect(deriveDeviations(prescription, performedSets(0))).toEqual([
      { kind: 'skipped', expected: { min: 3, max: 4 }, actual: 0 },
    ]);
  });

  it('signale "fewer-sets" quand le compte est sous le min mais non nul', () => {
    const prescription = prescriptionWithSets(3, 4);
    expect(deriveDeviations(prescription, performedSets(2))).toEqual([
      { kind: 'fewer-sets', expected: { min: 3, max: 4 }, actual: 2 },
    ]);
  });

  it('signale "extra-sets" quand le compte dépasse le max', () => {
    const prescription = prescriptionWithSets(3, 4);
    expect(deriveDeviations(prescription, performedSets(5))).toEqual([
      { kind: 'extra-sets', expected: { min: 3, max: 4 }, actual: 5 },
    ]);
  });

  it('traite la borne min comme respectée (inclusif) : count === min → []', () => {
    const prescription = prescriptionWithSets(3, 4);
    expect(deriveDeviations(prescription, performedSets(3))).toEqual([]);
  });

  it('traite la borne max comme respectée (inclusif) : count === max → []', () => {
    const prescription = prescriptionWithSets(3, 4);
    expect(deriveDeviations(prescription, performedSets(4))).toEqual([]);
  });

  describe('unilatéral : compte des séries logiques, pas des lignes', () => {
    it('cible tenue : 3 séries (6 lignes) face à {3,4} → aucune déviation', () => {
      // En comptant les LIGNES (6 > 4), on aurait à tort signalé "extra-sets".
      const prescription = prescriptionWithSets(3, 4);
      expect(deriveDeviations(prescription, unilateralSets(3))).toEqual([]);
    });

    it('au-dessus réel : 5 séries (10 lignes) face à {3,4} → "extra-sets" actual=5', () => {
      const prescription = prescriptionWithSets(3, 4);
      expect(deriveDeviations(prescription, unilateralSets(5))).toEqual([
        { kind: 'extra-sets', expected: { min: 3, max: 4 }, actual: 5 },
      ]);
    });

    it('en dessous : 2 séries (4 lignes) face à {3,4} → "fewer-sets" actual=2', () => {
      const prescription = prescriptionWithSets(3, 4);
      expect(deriveDeviations(prescription, unilateralSets(2))).toEqual([
        { kind: 'fewer-sets', expected: { min: 3, max: 4 }, actual: 2 },
      ]);
    });

    it('série entamée d\'un seul côté (1 ligne) compte la série logique entamée : 3 séries → tenue', () => {
      // 2 séries complètes (4 lignes) + 1 côté seul (1 ligne) = 3 orders distincts.
      const prescription = prescriptionWithSets(3, 4);
      const sets: PerformedSet[] = [
        ...unilateralSets(2),
        { weightKg: 100, reps: 10, rir: 2, order: 3, side: 'left' },
      ];
      expect(deriveDeviations(prescription, sets)).toEqual([]);
    });
  });

  describe('prescription fixe (min === max)', () => {
    it('ne signale rien quand le compte exact est respecté', () => {
      const prescription = prescriptionWithSets(3, 3);
      expect(deriveDeviations(prescription, performedSets(3))).toEqual([]);
    });

    it('signale "fewer-sets" quand le compte est sous la cible fixe', () => {
      const prescription = prescriptionWithSets(3, 3);
      expect(deriveDeviations(prescription, performedSets(2))).toEqual([
        { kind: 'fewer-sets', expected: { min: 3, max: 3 }, actual: 2 },
      ]);
    });

    it('signale "extra-sets" quand le compte dépasse la cible fixe', () => {
      const prescription = prescriptionWithSets(3, 3);
      expect(deriveDeviations(prescription, performedSets(4))).toEqual([
        { kind: 'extra-sets', expected: { min: 3, max: 3 }, actual: 4 },
      ]);
    });
  });
});
