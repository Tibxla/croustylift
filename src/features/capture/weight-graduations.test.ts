// Les graduations de la règle des poids, pour chaque pas : les grandes
// graduations (étiquetées) tombent sur des poids ronds, jamais sur 4,5 ou 13,5 kg.
import { describe, expect, it } from 'vitest';
import { STEP_INC, STEP_MAX, STEP_MIN } from '../../settings/reglages';
import { weightGraduations } from './weight-graduations';

/** Les poids des premières grandes graduations, en kg. */
function majors(stepKg: number, count = 3): number[] {
  const { majorEvery } = weightGraduations(stepKg);
  return Array.from({ length: count }, (_, i) => Math.round((i + 1) * majorEvery * stepKg * 100) / 100);
}

describe('weightGraduations', () => {
  it('un pas qui divise 5 kg : une grande graduation tous les 5 kg, comme avant', () => {
    expect(majors(0.25)).toEqual([5, 10, 15]);
    expect(majors(0.5)).toEqual([5, 10, 15]);
    expect(majors(1)).toEqual([5, 10, 15]);
    expect(majors(1.25)).toEqual([5, 10, 15]);
    expect(majors(2.5)).toEqual([5, 10, 15]);
    expect(majors(5)).toEqual([5, 10, 15]);
    // La moyenne à mi-chemin : 2,5 kg.
    expect(weightGraduations(1.25)).toEqual({ majorEvery: 4, midEvery: 2 });
    expect(weightGraduations(0.25)).toEqual({ majorEvery: 20, midEvery: 10 });
  });

  it('un pas qui ne divise pas 5 kg : le premier multiple de 5 kg qu’il atteint', () => {
    expect(majors(1.5)).toEqual([15, 30, 45]);
    expect(majors(0.75)).toEqual([15, 30, 45]);
    expect(majors(2)).toEqual([10, 20, 30]);
    expect(majors(3)).toEqual([15, 30, 45]);
    expect(majors(7.5)).toEqual([15, 30, 45]);
    // 7,5 kg à mi-chemin pour un pas de 1,5 ou de 0,75.
    expect(weightGraduations(1.5)).toEqual({ majorEvery: 10, midEvery: 5 });
    expect(weightGraduations(0.75)).toEqual({ majorEvery: 20, midEvery: 10 });
  });

  it('multiple de 5 kg trop lointain : le premier multiple de 2,5 kg, puis du kilo', () => {
    // 1,75 : 35 kg serait à 20 crans ; 17,5 kg aussi trop loin ; 7 kg.
    expect(majors(1.75)).toEqual([7, 14, 21]);
    expect(majors(2.25)).toEqual([9, 18, 27]);
    expect(majors(3.5)).toEqual([7, 14, 21]);
  });

  it('rien de rond à portée : chaque cran est une grande graduation', () => {
    expect(weightGraduations(4)).toEqual({ majorEvery: 1, midEvery: 0 });
    expect(weightGraduations(4.25)).toEqual({ majorEvery: 1, midEvery: 0 });
  });

  it('tous les pas de Réglages : un nombre entier de crans, au plus 15 kg entre deux étiquettes', () => {
    for (let q = Math.round(STEP_MIN / STEP_INC); q <= Math.round(STEP_MAX / STEP_INC); q += 1) {
      const stepKg = q * STEP_INC;
      const { majorEvery, midEvery } = weightGraduations(stepKg);
      expect(Number.isInteger(majorEvery) && majorEvery >= 1).toBe(true);
      const majorKg = majorEvery * stepKg;
      expect(majorKg <= 15 || majorEvery === 1).toBe(true);
      // Écart à l'écran (même densité que la règle : 8 px par cran au moins, 11,2 px par kg).
      expect(majorEvery * Math.max(8, 11.2 * stepKg)).toBeLessThanOrEqual(170);
      if (midEvery > 0) expect(majorEvery % midEvery).toBe(0);
    }
  });

  it('pas libres hors de la grille de Réglages : toujours au moins un cran', () => {
    expect(weightGraduations(0.1).majorEvery).toBeGreaterThanOrEqual(1);
    expect(majors(1.3)).toEqual([13, 26, 39]);
    expect(weightGraduations(0).majorEvery).toBe(1);
  });
});
