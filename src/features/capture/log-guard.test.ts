// Garde contre le double toucher de Logger : un rebond de doigt ne fait pas une
// série de plus. Deux Logger volontaires plus espacés restent deux séries (M6),
// et gauche puis droite coup sur coup reste un vrai usage en unilatéral.
import { describe, expect, it } from 'vitest';
import { DOUBLE_TAP_MS, SIDE_SWITCH_TAP_MS, isDoubleTap } from './log-guard';

describe('isDoubleTap', () => {
  const first = { exerciseId: 'dc', side: undefined, at: 10_000 };
  const left = { exerciseId: 'curl', side: 'left' as const, at: 10_000 };

  it('premier Logger : jamais ignoré', () => {
    expect(isDoubleTap(null, { exerciseId: 'dc', side: undefined, at: 10_000 })).toBe(false);
  });

  it('bilatéral, second Logger sous 600 ms : rebond, ignoré', () => {
    expect(isDoubleTap(first, { ...first, at: 10_120 })).toBe(true);
    expect(isDoubleTap(first, { ...first, at: 10_000 + DOUBLE_TAP_MS - 1 })).toBe(true);
  });

  it('bilatéral, à 600 ms ou plus : une seconde série voulue (M6)', () => {
    expect(isDoubleTap(first, { ...first, at: 10_000 + DOUBLE_TAP_MS })).toBe(false);
    expect(isDoubleTap(first, { ...first, at: 12_000 })).toBe(false);
  });

  it('unilatéral, rebond à 120 ms alors que le côté a déjà basculé : ignoré', () => {
    expect(isDoubleTap(left, { exerciseId: 'curl', side: 'right', at: 10_120 })).toBe(true);
  });

  it('unilatéral, gauche puis droite à 300 ms : deux séries', () => {
    expect(isDoubleTap(left, { exerciseId: 'curl', side: 'right', at: 10_300 })).toBe(false);
    expect(isDoubleTap(left, { exerciseId: 'curl', side: 'right', at: 10_000 + SIDE_SWITCH_TAP_MS })).toBe(false);
  });

  it('unilatéral, même côté à 400 ms : ignoré', () => {
    expect(isDoubleTap(left, { ...left, at: 10_400 })).toBe(true);
  });

  it('un autre exo, même aussitôt : jamais ignoré', () => {
    expect(isDoubleTap(first, { exerciseId: 'tirage', side: undefined, at: 10_100 })).toBe(false);
  });

  it('horloge qui recule : pas ignoré', () => {
    expect(isDoubleTap(first, { ...first, at: 9_000 })).toBe(false);
  });
});
