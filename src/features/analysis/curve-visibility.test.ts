// Tests du masquage des courbes de séance sur la carte d'un exo (grilling du
// 2026-09-13) : la légende masque ou affiche, la dernière courbe visible ne se
// masque pas, et une préférence périmée ne vide jamais une carte.
import { describe, expect, it } from 'vitest';
import { curveKey, toggleHidden, visibleCurves } from './curve-visibility';

const curves = [{ seanceId: 's-push' }, { seanceId: 's-upper' }, { seanceId: null }];
const keys = curves.map((c) => curveKey(c.seanceId));

describe('curveKey', () => {
  it('reprend l’id de séance, et une clé stable pour « Hors séance »', () => {
    expect(curveKey('s-push')).toBe('s-push');
    expect(curveKey(null)).toBe('hors-seance');
  });
});

describe('visibleCurves', () => {
  it('rend toutes les courbes sans masquage, dans l’ordre d’entrée', () => {
    expect(visibleCurves(curves, new Set())).toEqual(curves);
  });

  it('retire les courbes masquées', () => {
    expect(visibleCurves(curves, new Set(['s-push', 'hors-seance']))).toEqual([
      { seanceId: 's-upper' },
    ]);
  });

  it('une préférence qui masquerait tout rend tout : jamais de carte vide', () => {
    expect(visibleCurves(curves, new Set(keys))).toEqual(curves);
  });

  it('ignore les clés périmées (séance absente de la carte)', () => {
    expect(visibleCurves(curves, new Set(['s-disparue']))).toEqual(curves);
  });
});

describe('toggleHidden', () => {
  it('masque une courbe visible', () => {
    expect([...toggleHidden(new Set(), 's-push', keys)]).toEqual(['s-push']);
  });

  it('ré-affiche une courbe masquée', () => {
    expect([...toggleHidden(new Set(['s-push']), 's-push', keys)]).toEqual([]);
  });

  it('refuse de masquer la dernière courbe visible', () => {
    const hidden = new Set(['s-push', 'hors-seance']);
    expect([...toggleHidden(hidden, 's-upper', keys)].sort()).toEqual(['hors-seance', 's-push']);
  });

  it('les clés périmées ne comptent pas comme des courbes visibles', () => {
    const hidden = new Set(['s-push', 'hors-seance', 's-disparue']);
    expect(toggleHidden(hidden, 's-upper', keys).has('s-upper')).toBe(false);
  });

  it('ne mute pas l’ensemble reçu', () => {
    const hidden = new Set<string>();
    toggleHidden(hidden, 's-push', keys);
    expect(hidden.size).toBe(0);
  });
});
