import { describe, it, expect } from 'vitest';
import { foldAccents } from './text';

describe('foldAccents', () => {
  it('met en minuscules', () => {
    expect(foldAccents('SQUAT')).toBe('squat');
  });

  it('supprime les diacritiques (accents)', () => {
    expect(foldAccents('Développé')).toBe('developpe');
  });

  it('gère plusieurs accents et la cédille', () => {
    expect(foldAccents('Élévation à la poulie, en façade')).toBe(
      'elevation a la poulie, en facade',
    );
  });

  it('laisse intact un texte sans accent', () => {
    expect(foldAccents('curl marteau')).toBe('curl marteau');
  });

  it('chaîne vide -> chaîne vide', () => {
    expect(foldAccents('')).toBe('');
  });

  it('permet de matcher sans accent ce qui en porte', () => {
    // Une recherche « developpe » doit retrouver « Développé ».
    expect(foldAccents('Développé couché').includes(foldAccents('developpe'))).toBe(true);
  });
});
