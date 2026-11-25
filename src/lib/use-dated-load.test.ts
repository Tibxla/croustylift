import { describe, expect, it } from 'vitest';
import { liveViewKey } from './use-dated-load';

// Une surface quittée reste montée, cachée : elle ne suit plus sa vue (ni
// relecture après un acquittement, ni au retour du réseau) jusqu'à son retour.
describe('liveViewKey', () => {
  it('surface affichée : la vue demandée', () => {
    expect(liveViewKey('vue:journal', true)).toBe('vue:journal');
    expect(liveViewKey(null, true)).toBeNull();
  });

  it('surface cachée : aucune vue suivie, donc aucune lecture de fond', () => {
    expect(liveViewKey('vue:journal', false)).toBeNull();
    expect(liveViewKey('vue:analyse', false)).toBeNull();
  });
});
