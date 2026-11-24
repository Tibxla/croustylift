import { describe, expect, it } from 'vitest';
import { GLOSSARY_TEXT, glossaryLine } from './glossary-text';

describe('glossary-text', () => {
  it('pose le mot devant sa définition, en minuscule après les deux-points', () => {
    expect(glossaryLine('rir')).toBe(
      'RIR : les reps que tu aurais encore pu faire à la fin de la série. 0 : tu ne pouvais pas en faire une de plus.',
    );
  });

  it('chaque définition est courte, sans tiret long ni emoji', () => {
    for (const { definition } of Object.values(GLOSSARY_TEXT)) {
      expect(definition.length).toBeLessThanOrEqual(160);
      expect(definition).not.toMatch(/[—–]/);
      expect(definition).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });
});
