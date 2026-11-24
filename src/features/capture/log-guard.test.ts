// Garde contre le double toucher de Logger : un rebond de doigt ne fait pas une
// série de plus. Deux Logger volontaires plus espacés restent deux séries (M6).
import { describe, expect, it } from 'vitest';
import { DOUBLE_TAP_MS, isDoubleTap } from './log-guard';

describe('isDoubleTap', () => {
  const first = { exerciseId: 'dc', at: 10_000 };

  it('premier Logger : jamais ignoré', () => {
    expect(isDoubleTap(null, 'dc', 10_000)).toBe(false);
  });

  it('second Logger du même exo sous 600 ms : rebond, ignoré', () => {
    expect(isDoubleTap(first, 'dc', 10_100)).toBe(true);
    expect(isDoubleTap(first, 'dc', 10_000 + DOUBLE_TAP_MS - 1)).toBe(true);
  });

  it('même exo à 600 ms ou plus : une seconde série voulue (M6)', () => {
    expect(isDoubleTap(first, 'dc', 10_000 + DOUBLE_TAP_MS)).toBe(false);
    expect(isDoubleTap(first, 'dc', 12_000)).toBe(false);
  });

  it('un autre exo, même aussitôt : jamais ignoré', () => {
    expect(isDoubleTap(first, 'tirage', 10_100)).toBe(false);
  });

  it('horloge qui recule (veille, changement d’heure) : pas ignoré', () => {
    expect(isDoubleTap(first, 'dc', 9_000)).toBe(false);
  });
});
