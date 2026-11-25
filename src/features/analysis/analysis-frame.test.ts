// La correction d'une séance passée ne dépend pas de l'aperçu de l'Analyse : une
// coupure réseau ne doit pas démonter l'éditeur (et perdre son brouillon).
import { describe, expect, it } from 'vitest';
import { analysisFrame, seanceLookup } from './analysis-frame';

describe('analysisFrame', () => {
  it('la correction reste montée pendant un aller-retour hors ligne sans copie persistée', () => {
    // En ligne, l'aperçu est lu ; puis la coupure : sans copie, `offline` ; puis le
    // retour : `loading` le temps de la relecture, puis `ready`.
    const phases = ['ready', 'offline', 'loading', 'ready'] as const;
    expect(phases.map((p) => analysisFrame('edit', p))).toEqual(['page', 'page', 'page', 'page']);
  });

  it('une erreur de lecture de l’aperçu ne ferme pas non plus la correction', () => {
    expect(analysisFrame('edit', 'error')).toBe('page');
  });

  it('les autres pages lisent l’aperçu : elles attendent, ou disent hors ligne', () => {
    expect(analysisFrame('index', 'loading')).toBe('loading');
    expect(analysisFrame('exo', 'offline')).toBe('offline');
    expect(analysisFrame('seance', 'error')).toBe('error');
    expect(analysisFrame('compare', 'ready')).toBe('page');
  });
});

describe('seanceLookup', () => {
  it('une séance absente de la copie du journal attend sa relecture, puis propose de réessayer', () => {
    const base = { found: false, copy: true, online: true };
    expect(seanceLookup({ ...base, late: false })).toBe('waiting');
    // Plus de COPY_LATE_MS sans relecture arrivée : l'attente cesse.
    expect(seanceLookup({ ...base, late: true })).toBe('late');
  });

  it('hors ligne, absente de la copie : plus récente qu’elle', () => {
    expect(seanceLookup({ found: false, copy: true, online: false, late: true })).toBe('newer-offline');
  });

  it('relue sur le réseau et absente : supprimée ; trouvée : montrée', () => {
    expect(seanceLookup({ found: false, copy: false, online: true, late: false })).toBe('missing');
    expect(seanceLookup({ found: true, copy: true, online: true, late: true })).toBe('entry');
  });
});
