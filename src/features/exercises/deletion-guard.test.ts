import { describe, it, expect } from 'vitest';
import {
  type ExerciseReferenceCounts,
  isReferenced,
  describeReferenceBlock,
} from './deletion-guard';

const NONE: ExerciseReferenceCounts = {
  prescriptions: 0,
  performedSets: 0,
  datedNotes: 0,
};

describe('isReferenced', () => {
  it('aucune référence -> false', () => {
    expect(isReferenced(NONE)).toBe(false);
  });

  it('au moins une prescription -> true', () => {
    expect(isReferenced({ ...NONE, prescriptions: 1 })).toBe(true);
  });

  it('au moins une série réelle -> true', () => {
    expect(isReferenced({ ...NONE, performedSets: 3 })).toBe(true);
  });

  it('au moins une note datée -> true', () => {
    expect(isReferenced({ ...NONE, datedNotes: 1 })).toBe(true);
  });
});

describe('describeReferenceBlock', () => {
  it('non référencé -> null (rien à signaler)', () => {
    expect(describeReferenceBlock(NONE)).toBeNull();
  });

  it('explique le blocage par les séances qui prescrivent l exo', () => {
    const msg = describeReferenceBlock({ ...NONE, prescriptions: 2 });
    expect(msg).toMatch(/séance/i);
    expect(msg).not.toBeNull();
    // chiffre lisible (singulier/pluriel géré)
    expect(msg).toContain('2');
  });

  it('singulier pour une seule séance', () => {
    const msg = describeReferenceBlock({ ...NONE, prescriptions: 1 });
    expect(msg).toMatch(/1 séance(?!s)/);
  });

  it('explique le blocage par l historique des séries faites', () => {
    const msg = describeReferenceBlock({ ...NONE, performedSets: 5 });
    expect(msg).toMatch(/série/i);
    expect(msg).toContain('5');
  });

  it('explique le blocage par une note datée seule (0 prescription, 0 série)', () => {
    // Le cas qui passait la garde avant le fix : la note datée doit bloquer.
    const msg = describeReferenceBlock({ ...NONE, datedNotes: 1 });
    expect(msg).not.toBeNull();
    expect(msg).toMatch(/note datée/i);
    expect(msg).toContain('1');
  });

  it('pluriel pour plusieurs notes datées', () => {
    const msg = describeReferenceBlock({ ...NONE, datedNotes: 3 });
    expect(msg).toMatch(/3 notes datées/);
  });

  it('cumule les trois causes', () => {
    const msg = describeReferenceBlock({
      prescriptions: 2,
      performedSets: 4,
      datedNotes: 1,
    });
    expect(msg).toMatch(/séance/i);
    expect(msg).toMatch(/série/i);
    expect(msg).toMatch(/note datée/i);
  });

  it('aucun tiret long (preference produit ferme)', () => {
    const msg = describeReferenceBlock({
      prescriptions: 2,
      performedSets: 4,
      datedNotes: 1,
    });
    expect(msg).not.toContain('—');
  });
});
