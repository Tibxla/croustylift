// Tests de l'e1RM du brouillon en Capture (grilling du 2026-09-13) : le chiffre
// affiché pendant qu'on règle poids, reps et RIR, avant de valider la série.
import { describe, expect, it } from 'vitest';
import { draftE1rm } from './draft-e1rm';

describe('draftE1rm', () => {
  it('rend l’e1RM des valeurs réglées (Epley décalé, RIR compté comme des reps)', () => {
    // 100 × 5 @ RIR 2 = 100 × (1 + 6/30) = 120
    expect(draftE1rm(100, 5, 2)).toBeCloseTo(120);
  });

  it('une rep à l’échec vaut sa charge', () => {
    expect(draftE1rm(140, 1, 0)).toBe(140);
  });

  it('sans charge (poids du corps), pas d’e1RM : rien à afficher', () => {
    expect(draftE1rm(0, 12, 1)).toBeNull();
  });

  it('une saisie invalide ne jette jamais : rien à afficher', () => {
    expect(draftE1rm(100, 0, 1)).toBeNull();
    expect(draftE1rm(100, 5, -1)).toBeNull();
    expect(draftE1rm(100, 2.5, 1)).toBeNull();
    expect(draftE1rm(Number.NaN, 5, 1)).toBeNull();
  });
});
