// Tests du formatage relatif des dates (repère « Dernière fois tu notais »,
// décision 2026-07-29). Les readouts chiffrés (formatWeight & co) restent
// couverts par leurs consommateurs ; ici on fige la sémantique calendaire.
import { describe, expect, it } from 'vitest';
import { daysBetween, formatRelativeDay } from './format';

describe('daysBetween', () => {
  it('compte les jours calendaires (b - a)', () => {
    expect(daysBetween('2026-07-26', '2026-07-29')).toBe(3);
  });

  it('traverse les mois et les années', () => {
    expect(daysBetween('2025-12-31', '2026-01-01')).toBe(1);
    expect(daysBetween('2026-06-29', '2026-07-29')).toBe(30);
  });

  it('même jour -> 0 ; date future -> négatif', () => {
    expect(daysBetween('2026-07-29', '2026-07-29')).toBe(0);
    expect(daysBetween('2026-07-30', '2026-07-29')).toBe(-1);
  });
});

describe('formatRelativeDay', () => {
  const today = '2026-07-29';

  it('« hier » pour la veille', () => {
    expect(formatRelativeDay('2026-07-28', today)).toBe('hier');
  });

  it('« il y a N jours » sous la semaine', () => {
    expect(formatRelativeDay('2026-07-26', today)).toBe('il y a 3 jours');
    expect(formatRelativeDay('2026-07-23', today)).toBe('il y a 6 jours');
  });

  it('bascule en semaines à partir de 7 jours (arrondi à la plus proche)', () => {
    expect(formatRelativeDay('2026-07-22', today)).toBe('il y a 1 semaine');
    expect(formatRelativeDay('2026-07-15', today)).toBe('il y a 2 semaines');
    expect(formatRelativeDay('2026-07-01', today)).toBe('il y a 4 semaines');
  });

  it('reste en semaines jusqu’à ~2 mois réels (39 j = 6 semaines, pas « 2 mois »)', () => {
    expect(formatRelativeDay('2026-06-20', today)).toBe('il y a 6 semaines');
  });

  it('bascule en mois quand l’arrondi en donne au moins 2 (jamais « il y a 1 mois »)', () => {
    expect(formatRelativeDay('2026-05-29', today)).toBe('il y a 2 mois');
    expect(formatRelativeDay('2026-04-29', today)).toBe('il y a 3 mois');
  });

  it('même jour ou futur (défensif) -> « aujourd’hui »', () => {
    expect(formatRelativeDay('2026-07-29', today)).toBe('aujourd’hui');
    expect(formatRelativeDay('2026-07-30', today)).toBe('aujourd’hui');
  });
});
