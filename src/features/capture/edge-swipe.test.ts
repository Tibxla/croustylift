// La décision du glissé depuis le bord gauche, qui ramène au Sommaire : zone de
// départ, verrouillage du sens, seuil ou coup sec au lâcher.
import { describe, expect, it } from 'vitest';
import { EDGE_PX, edgeLock, edgeRelease, edgeStarts, releaseVelocity, trimTrail } from './edge-swipe';

describe('edgeStarts : seul un départ dans la bande du bord compte', () => {
  it('dans les 20 px du bord, sans feuille ouverte : le geste peut commencer', () => {
    expect(EDGE_PX).toBe(20);
    expect(edgeStarts({ x: 0, sheetOpen: false })).toBe(true);
    expect(edgeStarts({ x: 19.5, sheetOpen: false })).toBe(true);
  });

  it('un départ hors de la bande reste à la règle ou à la rangée, même vers la droite', () => {
    expect(edgeStarts({ x: 20.5, sheetOpen: false })).toBe(false);
    expect(edgeStarts({ x: 200, sheetOpen: false })).toBe(false);
  });

  it('une feuille ouverte coupe le geste', () => {
    expect(edgeStarts({ x: 4, sheetOpen: true })).toBe(false);
  });
});

describe('edgeLock : le sens se décide après quelques pixels', () => {
  it('sous 6 px dans les deux sens : rien de décidé (un toucher sur place)', () => {
    expect(edgeLock(3, -4)).toBe('pending');
  });

  it('vers la droite, plus horizontal que vertical : le glissé est pris', () => {
    expect(edgeLock(12, 5)).toBe('swipe');
  });

  it('vers le haut ou le bas, ou vers la gauche : abandonné', () => {
    expect(edgeLock(4, 14)).toBe('abandon');
    expect(edgeLock(-10, 1)).toBe('abandon');
    expect(edgeLock(8, -8)).toBe('abandon');
  });
});

describe('edgeRelease : au lâcher, retour au Sommaire ou l’écran revient', () => {
  it('au-delà de 30 % de la largeur : retour au Sommaire', () => {
    expect(edgeRelease({ dx: 119, width: 393, velocity: 0 })).toBe('back');
  });

  it('en deçà de 30 %, lentement : l’écran revient', () => {
    expect(edgeRelease({ dx: 117, width: 393, velocity: 0.2 })).toBe('stay');
  });

  it('un coup sec (plus de 0,5 px/ms) sur 40 px au moins suffit', () => {
    expect(edgeRelease({ dx: 45, width: 393, velocity: 0.8 })).toBe('back');
  });

  it('un coup sec trop court ne suffit pas', () => {
    expect(edgeRelease({ dx: 30, width: 393, velocity: 1.5 })).toBe('stay');
  });
});

describe('vitesse au lâcher : sur les 100 dernières ms', () => {
  it('garde au moins deux points et oublie ceux de plus de 100 ms', () => {
    const trail = [
      { x: 0, t: 0 },
      { x: 10, t: 50 },
      { x: 40, t: 160 },
      { x: 90, t: 200 },
    ];
    expect(trimTrail(trail, 200)).toEqual([
      { x: 40, t: 160 },
      { x: 90, t: 200 },
    ]);
  });

  it('px/ms entre le plus vieux point gardé et le lâcher ; nulle sans durée', () => {
    expect(releaseVelocity([{ x: 40, t: 160 }], { x: 90, t: 200 })).toBeCloseTo(1.25);
    expect(releaseVelocity([{ x: 40, t: 200 }], { x: 90, t: 200 })).toBe(0);
  });
});
