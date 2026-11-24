import { describe, it, expect } from 'vitest';
import { datedNoteId, uuidV5 } from './dated-note-id';

describe('datedNoteId', () => {
  it('vecteur de référence (comparé à uuid.uuid5 de Python)', () => {
    expect(
      datedNoteId('a0000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-0000000000e1'),
    ).toBe('e84ca1f6-d82b-5f32-b708-71fea799ace2');
  });

  it('deux appareils calculent le même id pour le même couple, quelle que soit la casse', () => {
    const lower = datedNoteId('a0000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-0000000000e1');
    const upper = datedNoteId('A0000000-0000-0000-0000-000000000011', 'A0000000-0000-0000-0000-0000000000E1');
    expect(upper).toBe(lower);
  });

  it('un autre exo, ou une autre exécution, donne un autre id', () => {
    const base = datedNoteId('a0000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-0000000000e1');
    expect(datedNoteId('a0000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-0000000000e2')).not.toBe(base);
    expect(datedNoteId('a0000000-0000-0000-0000-000000000012', 'a0000000-0000-0000-0000-0000000000e1')).not.toBe(base);
  });

  it('uuidV5 : vecteur de la RFC (espace DNS, « www.example.com »)', () => {
    expect(uuidV5('www.example.com', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe(
      '2ed6657d-e927-568b-95e1-2665a8aea6a2',
    );
  });
});
