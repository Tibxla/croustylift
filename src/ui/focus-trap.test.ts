import { describe, expect, it } from 'vitest';
import { trapTarget } from './focus-trap';

describe('trapTarget', () => {
  it('boucle du dernier au premier, et du premier au dernier en arrière', () => {
    expect(trapTarget(2, 3, false)).toBe(0);
    expect(trapTarget(0, 3, true)).toBe(2);
  });

  it('laisse la tabulation ordinaire au milieu de la feuille', () => {
    expect(trapTarget(0, 3, false)).toBeNull();
    expect(trapTarget(1, 3, true)).toBeNull();
  });

  it('ramène dans la feuille un focus resté au titre ou ailleurs', () => {
    expect(trapTarget(-1, 3, false)).toBe(0);
    expect(trapTarget(-1, 3, true)).toBe(2);
  });

  it('sans élément focalisable, rien à faire', () => {
    expect(trapTarget(-1, 0, false)).toBeNull();
  });
});
