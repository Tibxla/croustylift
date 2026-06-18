import { describe, it, expect } from 'vitest';
import { exportFilename } from './data';

describe('exportFilename', () => {
  it('horodate le nom du backup à la date locale (AAAA-MM-JJ)', () => {
    const name = exportFilename(new Date('2026-06-18T10:00:00.000Z'));
    expect(name).toMatch(/^croustylift-backup-\d{4}-\d{2}-\d{2}\.json$/);
  });

  it('pad les mois et jours à un chiffre', () => {
    // 5 janvier : mois 01, jour 05 (test ancré sur une date locale stable).
    const name = exportFilename(new Date(2026, 0, 5, 12, 0, 0));
    expect(name).toBe('croustylift-backup-2026-01-05.json');
  });
});
