import { describe, expect, it } from 'vitest';
import { syncLine } from './sync-line';

const base = { pending: 0, refused: 0, offline: false, unsaved: false };

describe('syncLine', () => {
  it('rien quand tout est envoyé', () => {
    expect(syncLine(base)).toBeNull();
  });

  it('hors ligne : ce n’est pas une erreur, les saisies restent sur l’appareil', () => {
    expect(syncLine({ ...base, offline: true })).toEqual({ title: 'Hors ligne', detail: 'les saisies restent sur cet appareil' });
    expect(syncLine({ ...base, offline: true, pending: 2 })?.detail).toBe('2 saisies sur l’appareil, envoi au retour');
  });

  it('en ligne avec une file : envoi en cours', () => {
    expect(syncLine({ ...base, pending: 1 })).toEqual({ title: 'Envoi en cours', detail: '1 saisie en attente' });
  });

  it('des saisies refusées se disent, seules ou avec la file', () => {
    expect(syncLine({ ...base, refused: 2 })).toEqual({ title: '2 saisies refusées', detail: '' });
    expect(syncLine({ ...base, refused: 1 })).toEqual({ title: '1 saisie refusée', detail: '' });
    expect(syncLine({ ...base, pending: 3, refused: 1 })?.detail).toBe('3 saisies en attente · 1 saisie refusée');
  });

  it('le stockage plein prime sur tout', () => {
    expect(syncLine({ pending: 3, refused: 1, offline: true, unsaved: true })?.title).toBe('Stockage plein');
  });

  // Reportés de l'ancienne bannière (`syncBannerLabel`).
  it('des saisies refusées ne se cachent jamais, en ligne ou non, file vide ou non', () => {
    for (const pending of [0, 1, 5]) {
      for (const offline of [true, false]) {
        const line = syncLine({ ...base, pending, offline, refused: 2 });
        expect(line).not.toBeNull();
        expect(`${line!.title} ${line!.detail}`).toMatch(/[Rr]efusé/);
      }
    }
    expect(syncLine({ ...base, offline: true, refused: 1 })?.detail).toBe('les saisies restent sur cet appareil · 1 saisie refusée');
  });

  it('stockage plein, en ligne, file vide ou non : l’avertissement prime (les saisies ne tiennent qu’en mémoire)', () => {
    const full = { title: 'Stockage plein', detail: 'tes saisies ne sont pas gardées ici, laisse l’app ouverte' };
    expect(syncLine({ ...base, unsaved: true })).toEqual(full);
    expect(syncLine({ ...base, unsaved: true, pending: 2 })).toEqual(full);
  });
});
