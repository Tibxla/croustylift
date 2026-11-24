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

  it('un pas qui ne divise pas 5 kg : le premier multiple de 5 kg qu’il atteint, à 10 kg au plus', () => {
    expect(majors(2)).toEqual([10, 20, 30]);
    expect(weightGraduations(2)).toEqual({ majorEvery: 5, midEvery: 0 });
  });

  it('multiple de 5 kg trop lointain : le premier multiple de 2,5 kg, puis du kilo', () => {
    // 1,5 et 0,75 : 15 kg serait trop loin (deux étiquettes à l'écran) ; 7,5 kg.
    expect(majors(1.5)).toEqual([7.5, 15, 22.5]);
    expect(majors(0.75)).toEqual([7.5, 15, 22.5]);
    expect(weightGraduations(1.5)).toEqual({ majorEvery: 5, midEvery: 0 });
    expect(weightGraduations(0.75)).toEqual({ majorEvery: 10, midEvery: 5 });
    // 1,75 : 35 puis 17,5 kg trop loin ; 7 kg.
    expect(majors(1.75)).toEqual([7, 14, 21]);
    expect(majors(2.25)).toEqual([9, 18, 27]);
    expect(majors(3.5)).toEqual([7, 14, 21]);
  });

  it('rien de rond à portée, pas sous 5 kg : une étiquette tous les deux crans, jamais à chaque cran', () => {
    expect(majors(3)).toEqual([6, 12, 18]);
    expect(majors(4)).toEqual([8, 16, 24]);
    expect(majors(4.25)).toEqual([8.5, 17, 25.5]);
    expect(majors(3.25)).toEqual([6.5, 13, 19.5]);
    expect(weightGraduations(3)).toEqual({ majorEvery: 2, midEvery: 1 });
  });

  it('rien de rond à portée, pas de 5 kg ou plus : chaque cran est une grande graduation', () => {
    expect(weightGraduations(7.5)).toEqual({ majorEvery: 1, midEvery: 0 });
    expect(weightGraduations(6)).toEqual({ majorEvery: 1, midEvery: 0 });
    expect(weightGraduations(10)).toEqual({ majorEvery: 1, midEvery: 0 });
  });

  it('tous les pas de Réglages : un nombre entier de crans, au plus 10 kg entre deux étiquettes', () => {
    for (let q = Math.round(STEP_MIN / STEP_INC); q <= Math.round(STEP_MAX / STEP_INC); q += 1) {
      const stepKg = q * STEP_INC;
      const { majorEvery, midEvery } = weightGraduations(stepKg);
      expect(Number.isInteger(majorEvery) && majorEvery >= 1).toBe(true);
      const majorKg = majorEvery * stepKg;
      expect(majorKg <= 10 || majorEvery === 1).toBe(true);
      // Sous 5 kg de pas, jamais une étiquette à chaque cran.
      if (stepKg < 5) expect(majorEvery).toBeGreaterThanOrEqual(2);
      // Écart à l'écran (même densité que la règle : 8 px par cran au moins, 11,2 px par kg).
      expect(majorEvery * Math.max(8, 11.2 * stepKg)).toBeLessThanOrEqual(170);
      if (midEvery > 0) expect(majorEvery % midEvery).toBe(0);
    }
  });

  it('pas libres hors de la grille de Réglages : toujours au moins un cran', () => {
    expect(weightGraduations(0.1).majorEvery).toBeGreaterThanOrEqual(1);
    // 1,3 : aucun multiple rond sous 10 kg (13 kg est le premier) ; deux crans.
    expect(weightGraduations(1.3)).toEqual({ majorEvery: 2, midEvery: 1 });
    expect(weightGraduations(0).majorEvery).toBe(1);
  });
});
