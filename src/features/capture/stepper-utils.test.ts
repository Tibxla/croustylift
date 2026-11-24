// Tests pour la logique de parse/clamp de la saisie au pavé numérique du Stepper.
// Toutes les fonctions sont pures — testables sans DOM (environment: 'node').

import { describe, expect, it } from 'vitest';
import {
  boundSetValues,
  parseTypedValue,
  REPS_MAX,
  RIR_MAX,
  roundWeightKg,
  WEIGHT_MAX_KG,
} from './stepper-utils';

describe('parseTypedValue — saisie à précision libre (poids, allowDecimals=true)', () => {
  const fallback = 80;

  it('préserve la précision tapée (13,25 ne se fait PAS snapper au pas du +/−)', () => {
    // Régression #58 : avec un pas de bouton de 2,5 kg, taper 13,25 retombait à
    // 12,5. La saisie tapée ne doit plus snapper au pas — on garde 13,25.
    expect(parseTypedValue('13,25', 0, 500, fallback, true)).toBe(13.25);
  });

  it('accepte la virgule décimale FR', () => {
    expect(parseTypedValue('82,5', 0, 500, fallback, true)).toBe(82.5);
  });

  it('accepte le point décimal', () => {
    expect(parseTypedValue('82.5', 0, 500, fallback, true)).toBe(82.5);
  });

  it('préserve une décimale fine .25', () => {
    expect(parseTypedValue('41,25', 0, 500, fallback, true)).toBe(41.25);
  });

  it('préserve un entier tapé', () => {
    expect(parseTypedValue('60', 0, 500, fallback, true)).toBe(60);
  });

  it('clamp vers le min', () => {
    expect(parseTypedValue('-5', 0, 500, fallback, true)).toBe(0);
  });

  it('clamp vers le max', () => {
    expect(parseTypedValue('999', 0, 500, fallback, true)).toBe(500);
  });

  it('clamp une valeur décimale au max sans perdre la précision en deçà', () => {
    expect(parseTypedValue('200,75', 0, 200, fallback, true)).toBe(200);
    expect(parseTypedValue('199,75', 0, 200, fallback, true)).toBe(199.75);
  });

  it('retombe sur le fallback pour une saisie non numérique', () => {
    expect(parseTypedValue('abc', 0, 500, fallback, true)).toBe(fallback);
  });

  it('retombe sur le fallback pour une chaîne vide', () => {
    expect(parseTypedValue('', 0, 500, fallback, true)).toBe(fallback);
  });

  it('retombe sur le fallback pour NaN', () => {
    expect(parseTypedValue('NaN', 0, 500, fallback, true)).toBe(fallback);
  });

  it('ignore les espaces de bord', () => {
    expect(parseTypedValue('  13,25  ', 0, 500, fallback, true)).toBe(13.25);
  });

  it('nettoie les artefacts de virgule flottante (0,1 + 0,2 niveau de bruit)', () => {
    // Une valeur déjà propre reste propre, sans bruit flottant introduit.
    expect(parseTypedValue('0,3', 0, 500, fallback, true)).toBe(0.3);
  });
});

describe('parseTypedValue — saisie entière (reps / RIR, allowDecimals=false)', () => {
  const fallback = 10;

  it('arrondit une saisie décimale à l’entier le plus proche', () => {
    expect(parseTypedValue('10,4', 1, 50, fallback, false)).toBe(10);
    expect(parseTypedValue('10,6', 1, 50, fallback, false)).toBe(11);
  });

  it('préserve un entier tapé', () => {
    expect(parseTypedValue('12', 1, 50, fallback, false)).toBe(12);
  });

  it('clamp dans [min, max] après arrondi', () => {
    expect(parseTypedValue('0', 1, 50, fallback, false)).toBe(1);
    expect(parseTypedValue('99', 1, 50, fallback, false)).toBe(50);
  });

  it('retombe sur le fallback pour une saisie invalide', () => {
    expect(parseTypedValue('abc', 1, 50, fallback, false)).toBe(fallback);
  });
});

describe('plafonds de saisie alignés sur la base', () => {
  it('un poids tapé au-delà de numeric(6,2) est ramené au plafond', () => {
    expect(parseTypedValue('10000', 0, WEIGHT_MAX_KG, 80, true)).toBe(9999.99);
  });

  it('boundSetValues ramène poids, reps et RIR dans les bornes de la base', () => {
    expect(boundSetValues({ weightKg: 10000, reps: 100000, rir: 500, side: 'left' })).toEqual({
      weightKg: WEIGHT_MAX_KG,
      reps: REPS_MAX,
      rir: RIR_MAX,
      side: 'left',
    });
    expect(boundSetValues({ weightKg: -5, reps: 0, rir: -1 })).toEqual({
      weightKg: 0,
      reps: 1,
      rir: 0,
    });
  });

  it('boundSetValues laisse intacte une série dans les bornes', () => {
    expect(boundSetValues({ weightKg: 82.5, reps: 8, rir: 1 })).toEqual({
      weightKg: 82.5,
      reps: 8,
      rir: 1,
    });
  });
});

describe('poids au centième de kg (précision de la base)', () => {
  it('un poids tapé à trois décimales est arrondi au centième', () => {
    expect(parseTypedValue('85,004', 0, WEIGHT_MAX_KG, 80, true)).toBe(85);
    expect(parseTypedValue('85.006', 0, WEIGHT_MAX_KG, 80, true)).toBe(85.01);
  });

  it('les paliers usuels restent intacts', () => {
    expect(parseTypedValue('41,25', 0, WEIGHT_MAX_KG, 80, true)).toBe(41.25);
    expect(roundWeightKg(82.5)).toBe(82.5);
    expect(roundWeightKg(101.25)).toBe(101.25);
  });

  it('la série enfilée porte le poids que la base stockera', () => {
    expect(boundSetValues({ weightKg: 85.004, reps: 8, rir: 1 }).weightKg).toBe(85);
  });

  it('nettoie le bruit flottant d’une addition de paliers', () => {
    expect(roundWeightKg(0.1 + 0.2)).toBe(0.3);
  });
});
