// Tests pour la logique de parse/clamp du pavé numérique du Stepper.
// Toutes les fonctions sont pures — testables sans DOM (environment: 'node').

import { describe, expect, it } from 'vitest';
import { parseAndClamp, roundToStep } from './stepper-utils';

describe('roundToStep', () => {
  it('arrondit au pas entier (step=1)', () => {
    expect(roundToStep(5.6, 1)).toBe(6);
    expect(roundToStep(5.4, 1)).toBe(5);
  });

  it('arrondit au multiple de 2.5', () => {
    expect(roundToStep(82.3, 2.5)).toBe(82.5);
    expect(roundToStep(81.2, 2.5)).toBe(80);
  });

  it('arrondit au multiple de 0.5', () => {
    expect(roundToStep(82.3, 0.5)).toBe(82.5);
    expect(roundToStep(82.2, 0.5)).toBe(82);
  });

  it('arrondit au multiple de 1.25', () => {
    expect(roundToStep(82.5, 1.25)).toBe(82.5);
    expect(roundToStep(82.1, 1.25)).toBe(82.5);
  });

  it('evite les erreurs de virgule flottante JS', () => {
    // 0.1 + 0.2 = 0.30000000000000004 en JS
    expect(roundToStep(0.3, 0.1)).toBe(0.3);
  });
});

describe('parseAndClamp', () => {
  const fallback = 80;

  it('parse un entier valide', () => {
    expect(parseAndClamp('10', 1, 0, 30, fallback)).toBe(10);
  });

  it('parse un decimal avec point', () => {
    expect(parseAndClamp('82.5', 0.5, 0, 200, fallback)).toBe(82.5);
  });

  it('parse un decimal avec virgule FR', () => {
    expect(parseAndClamp('82,5', 0.5, 0, 200, fallback)).toBe(82.5);
  });

  it('clamp vers le min si valeur trop petite', () => {
    expect(parseAndClamp('0', 1, 5, 30, fallback)).toBe(5);
  });

  it('clamp vers le max si valeur trop grande', () => {
    expect(parseAndClamp('99', 1, 0, 30, fallback)).toBe(30);
  });

  it('retourne le fallback pour une saisie non-numerique', () => {
    expect(parseAndClamp('abc', 1, 0, 30, fallback)).toBe(fallback);
  });

  it('retourne le fallback pour une chaine vide', () => {
    expect(parseAndClamp('', 1, 0, 30, fallback)).toBe(fallback);
  });

  it('retourne le fallback pour NaN', () => {
    expect(parseAndClamp('NaN', 1, 0, 30, fallback)).toBe(fallback);
  });

  it('arrondit au pas apres parse (step=0.5)', () => {
    // 82.3 arrondi au pas 0.5 => 82.5
    expect(parseAndClamp('82.3', 0.5, 0, 200, fallback)).toBe(82.5);
  });

  it('arrondit au pas apres parse (step=2.5)', () => {
    // 83 arrondi au pas 2.5 => 82.5
    expect(parseAndClamp('83', 2.5, 0, 200, fallback)).toBe(82.5);
  });

  it('gere les espaces superflus', () => {
    expect(parseAndClamp('  12  ', 1, 0, 30, fallback)).toBe(12);
  });

  it('clamp correct avec min=0 et saisie negative', () => {
    expect(parseAndClamp('-5', 1, 0, 30, fallback)).toBe(0);
  });
});
