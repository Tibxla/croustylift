import { describe, it, expect } from 'vitest';
import {
  type ExerciseReferenceCounts,
  isReferenced,
  describeReferenceBlock,
} from './deletion-guard';

const NONE: ExerciseReferenceCounts = { prescriptions: 0, performedSets: 0 };

describe('isReferenced', () => {
  it('aucune référence -> false', () => {
    expect(isReferenced(NONE)).toBe(false);
  });

  it('au moins une prescription -> true', () => {
    expect(isReferenced({ prescriptions: 1, performedSets: 0 })).toBe(true);
  });

  it('au moins une série réelle -> true', () => {
    expect(isReferenced({ prescriptions: 0, performedSets: 3 })).toBe(true);
  });
});

describe('describeReferenceBlock', () => {
  it('non référencé -> null (rien à signaler)', () => {
    expect(describeReferenceBlock(NONE)).toBeNull();
  });

  it('explique le blocage par les séances qui prescrivent l exo', () => {
    const msg = describeReferenceBlock({ prescriptions: 2, performedSets: 0 });
    expect(msg).toMatch(/séance/i);
    expect(msg).not.toBeNull();
    // chiffre lisible (singulier/pluriel géré)
    expect(msg).toContain('2');
  });

  it('singulier pour une seule séance', () => {
    const msg = describeReferenceBlock({ prescriptions: 1, performedSets: 0 });
    expect(msg).toMatch(/1 séance(?!s)/);
  });

  it('explique le blocage par l historique des séries faites', () => {
    const msg = describeReferenceBlock({ prescriptions: 0, performedSets: 5 });
    expect(msg).toMatch(/série/i);
    expect(msg).toContain('5');
  });

  it('cumule les deux causes', () => {
    const msg = describeReferenceBlock({ prescriptions: 2, performedSets: 4 });
    expect(msg).toMatch(/séance/i);
    expect(msg).toMatch(/série/i);
  });

  it('aucun tiret long (preference produit ferme)', () => {
    const msg = describeReferenceBlock({ prescriptions: 2, performedSets: 4 });
    expect(msg).not.toContain('—');
  });
});
