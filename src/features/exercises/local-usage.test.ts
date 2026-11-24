import { describe, expect, it } from 'vitest';
import { seancesUsing } from './local-usage';

describe('usage local d’un exo', () => {
  it('nomme les séances qui le contiennent, une fois chacune', () => {
    const t = [
      { name: 'Push A', exerciseIds: ['a', 'b'] },
      { name: 'Pull A', exerciseIds: ['c'] },
      { name: 'Push A', exerciseIds: ['a'] },
    ];
    expect(seancesUsing('a', t)).toEqual(['Push A']);
    expect(seancesUsing('c', t)).toEqual(['Pull A']);
    expect(seancesUsing('z', t)).toEqual([]);
  });
});
