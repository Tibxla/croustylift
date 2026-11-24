import { describe, expect, it } from 'vitest';
import { DEFAULT_REGLAGES, effectiveReduceMotion, parseReglages, signalHex, signalName } from './reglages';
import { CLARTE_MAX, contrast, freeHex, HUE_MAX, readable, SIG_PRESETS } from './signal-color';

describe('parseReglages', () => {
  it('rien ou illisible : les défauts (Jaune, 1,25 kg)', () => {
    expect(parseReglages(null)).toEqual(DEFAULT_REGLAGES);
    expect(parseReglages('pas du json')).toEqual(DEFAULT_REGLAGES);
    expect(parseReglages('42')).toEqual(DEFAULT_REGLAGES);
    expect(DEFAULT_REGLAGES).toEqual({ signal: { kind: 'preset', name: 'Jaune' }, stepKg: 1.25, reduceMotion: null });
  });

  it('relit une prédéfinie, une couleur libre et un pas valides', () => {
    expect(parseReglages(JSON.stringify({ signal: { kind: 'preset', name: 'Ciel' }, stepKg: 2.5 }))).toEqual({
      signal: { kind: 'preset', name: 'Ciel' },
      stepKg: 2.5,
      reduceMotion: null,
    });
    expect(parseReglages(JSON.stringify({ signal: { kind: 'free', h: 96, l: 18 }, stepKg: 0.25, reduceMotion: true }))).toEqual({
      signal: { kind: 'free', h: 96, l: 18 },
      stepKg: 0.25,
      reduceMotion: true,
    });
  });

  it('chaque champ invalide retombe sur son défaut, sans emporter l’autre', () => {
    const r = parseReglages(JSON.stringify({ signal: { kind: 'preset', name: 'Fuchsia' }, stepKg: 5 }));
    expect(r).toEqual({ signal: DEFAULT_REGLAGES.signal, stepKg: 5, reduceMotion: null });
    const bad = [
      { kind: 'free', h: 97, l: 18 }, // hors cran de 2°
      { kind: 'free', h: 360, l: 18 },
      { kind: 'free', h: 96, l: CLARTE_MAX + 1 },
      { kind: 'free', h: '96', l: 18 },
      { kind: 'hex', hex: 'red;background:url(x)' },
    ];
    for (const signal of bad) expect(parseReglages(JSON.stringify({ signal, stepKg: 5 })).signal).toEqual(DEFAULT_REGLAGES.signal);
    for (const stepKg of [0, 0.1, 10.25, -1, 1.3, '2', null]) expect(parseReglages(JSON.stringify({ stepKg })).stepKg).toBe(1.25);
  });
});

describe('réduire les animations', () => {
  it('sans choix, la préférence du système ; un choix explicite l’emporte dans les deux sens', () => {
    const r = parseReglages(null);
    expect(effectiveReduceMotion(r, true)).toBe(true);
    expect(effectiveReduceMotion(r, false)).toBe(false);
    expect(effectiveReduceMotion({ ...r, reduceMotion: false }, true)).toBe(false);
    expect(effectiveReduceMotion({ ...r, reduceMotion: true }, false)).toBe(true);
  });

  it('une valeur stockée qui n’est pas un booléen revient à « suivre le système »', () => {
    for (const reduceMotion of ['oui', 1, null, {}]) expect(parseReglages(JSON.stringify({ reduceMotion })).reduceMotion).toBeNull();
  });
});

describe('signal', () => {
  it('une prédéfinie se lit par son nom, la couleur libre se calcule', () => {
    expect(signalHex({ kind: 'preset', name: 'Rouge' })).toBe('#ff5d5d');
    expect(signalName({ kind: 'preset', name: 'Rouge' })).toBe('Rouge');
    expect(signalHex({ kind: 'free', h: 96, l: 18 })).toBe(freeHex(96, 18));
    expect(signalName({ kind: 'free', h: 96, l: 18 })).toBe('Autre couleur');
  });

  it('la couleur libre est un #rrggbb valide sur toute la plage', () => {
    for (let h = 0; h <= HUE_MAX; h += 30) for (let l = 0; l <= CLARTE_MAX; l += 6) expect(freeHex(h, l)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('une couleur libre sombre est signalée peu lisible, une claire non', () => {
    expect(readable(freeHex(260, 0))).toBe(false);
    expect(readable(freeHex(96, 18))).toBe(true);
  });

  it('les prédéfinies tiennent 5,8:1 sur le fond', () => {
    for (const p of SIG_PRESETS) expect(contrast(p.hex, '#100e0c')).toBeGreaterThan(5.8);
  });
});
