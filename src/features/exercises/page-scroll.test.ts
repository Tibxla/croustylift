import { describe, expect, it } from 'vitest';
import { scrollStep } from './page-scroll';

describe('scrollStep', () => {
  it('une page plus profonde s’ouvre en haut et retient la position quittée', () => {
    expect(scrollStep([], 0, 1, 840, false)).toEqual({ stack: [840], target: 0 });
  });

  it('un retour sans message retrouve la position de la liste', () => {
    expect(scrollStep([840], 1, 0, 120, false)).toEqual({ stack: [], target: 840 });
  });

  it('un retour avec message s’ouvre en haut, là où la phrase s’affiche', () => {
    expect(scrollStep([840], 1, 0, 120, true)).toEqual({ stack: [], target: 0 });
  });

  it('liste, fiche, formulaire puis annuler : chaque niveau retrouve sa position', () => {
    const toFiche = scrollStep([], 0, 1, 840, false);
    const toEdit = scrollStep(toFiche.stack, 1, 2, 300, false);
    expect(toEdit).toEqual({ stack: [840, 300], target: 0 });
    const backFiche = scrollStep(toEdit.stack, 2, 1, 0, false);
    expect(backFiche).toEqual({ stack: [840], target: 300 });
    expect(scrollStep(backFiche.stack, 1, 0, 0, false)).toEqual({ stack: [], target: 840 });
  });

  it('une page de même profondeur s’ouvre en haut sans toucher à la pile', () => {
    expect(scrollStep([840], 1, 1, 200, false)).toEqual({ stack: [840], target: 0 });
  });

  it('un retour sans position connue s’ouvre en haut', () => {
    expect(scrollStep([], 1, 0, 200, false)).toEqual({ stack: [], target: 0 });
  });
});
