import { afterEach, describe, expect, it } from 'vitest';
import { SURFACE_INTENT_TTL_MS, clearSurfaceIntent, hasSurfaceIntent, peekSurfaceIntent, setSurfaceIntent } from './navigation';

describe('intention d’ouverture d’une surface', () => {
  afterEach(() => clearSurfaceIntent('analysis'));

  it('rien en attente : la surface s’ouvre sur son état de départ', () => {
    expect(peekSurfaceIntent('analysis', 0)).toBeNull();
  });

  it('déposée, elle se lit sans s’effacer, puis s’efface au montage', () => {
    setSurfaceIntent({ surface: 'analysis', open: 'journal' }, 1000);
    expect(peekSurfaceIntent('analysis', 1200)).toEqual({ surface: 'analysis', open: 'journal' });
    expect(peekSurfaceIntent('analysis', 1300)).toEqual({ surface: 'analysis', open: 'journal' });
    clearSurfaceIntent('analysis');
    expect(peekSurfaceIntent('analysis', 1400)).toBeNull();
  });

  it('périmée, elle ne ressurgit pas à une ouverture ultérieure', () => {
    setSurfaceIntent({ surface: 'analysis', open: 'journal' }, 1000);
    expect(peekSurfaceIntent('analysis', 1000 + SURFACE_INTENT_TTL_MS)).not.toBeNull();
    expect(peekSurfaceIntent('analysis', 1001 + SURFACE_INTENT_TTL_MS)).toBeNull();
  });

  it('le shell sait qu’une intention attend la surface visée (elle s’ouvre en haut), et seulement elle', () => {
    expect(hasSurfaceIntent('analysis', 0)).toBe(false);
    setSurfaceIntent({ surface: 'analysis', open: 'journal' }, 1000);
    expect(hasSurfaceIntent('analysis', 1200)).toBe(true);
    expect(hasSurfaceIntent('seances', 1200)).toBe(false);
    expect(hasSurfaceIntent('analysis', 1001 + SURFACE_INTENT_TTL_MS)).toBe(false);
  });
});
