// Tests des noms uniques (grilling du 2026-09-13, CONTEXT.md « Séance » /
// « Routine ») : un nom de séance est unique dans sa routine, un nom de routine
// dans le compte, casse et espaces en trop ignorés.
import { describe, expect, it } from 'vitest';
import { nameKey, nextFreeName } from './unique-name';

describe('nameKey', () => {
  it('ignore la casse', () => {
    expect(nameKey('Push')).toBe(nameKey('PUSH'));
  });

  it('ignore les espaces autour et en double', () => {
    expect(nameKey('  Upper   A ')).toBe(nameKey('Upper A'));
  });

  it('garde les accents : « Épaules » et « Epaules » sont deux noms', () => {
    expect(nameKey('Épaules')).not.toBe(nameKey('Epaules'));
  });
});

describe('nextFreeName', () => {
  it('rend le nom tel quel s’il est libre', () => {
    expect(nextFreeName('Push', ['Pull', 'Legs'])).toBe('Push');
  });

  it('propose « Push 2 » quand « Push » est pris', () => {
    expect(nextFreeName('Push', ['Push', 'Pull'])).toBe('Push 2');
  });

  it('saute les numéros déjà pris', () => {
    expect(nextFreeName('Push', ['Push', 'push 2', 'Push 3'])).toBe('Push 4');
  });

  it('repart du numéro existant plutôt que d’empiler « Push 2 2 »', () => {
    expect(nextFreeName('Push 2', ['Push', 'Push 2'])).toBe('Push 3');
  });

  it('compare en ignorant casse et espaces', () => {
    expect(nextFreeName('upper a', ['  Upper   A'])).toBe('upper a 2');
  });

  it('nettoie les espaces en trop du nom proposé', () => {
    expect(nextFreeName('  Push  ', [])).toBe('Push');
  });
});
