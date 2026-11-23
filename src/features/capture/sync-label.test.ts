// Libellés de l'état de synchro : la quarantaine ne se cache jamais derrière
// « Synchronisé », et une Déconnexion refusée à cause d'elle dit pourquoi.
import { describe, it, expect } from 'vitest';
import { signOutRefusalLabel, syncBannerLabel, unsavedWritesLabel } from './sync-label';

describe('syncBannerLabel', () => {
  it('rien en file, rien en quarantaine : synchronisé, en vert', () => {
    expect(syncBannerLabel({ pending: 0, quarantined: 0, online: true })).toEqual({
      tone: 'good',
      label: 'Synchronisé. Tout est en base.',
    });
  });

  it('file vide mais quarantaine non vide : jamais « Synchronisé », en ambre', () => {
    expect(syncBannerLabel({ pending: 0, quarantined: 1, online: true })).toEqual({
      tone: 'warn',
      label: '1 saisie refusée par le serveur, non envoyée.',
    });
    expect(syncBannerLabel({ pending: 0, quarantined: 3, online: false })).toEqual({
      tone: 'warn',
      label: '3 saisies refusées par le serveur, non envoyées.',
    });
  });

  it('file en attente sans quarantaine : libellés d’avant', () => {
    expect(syncBannerLabel({ pending: 2, quarantined: 0, online: true })).toEqual({
      tone: 'info',
      label: 'Synchronisation… 2 en attente.',
    });
    expect(syncBannerLabel({ pending: 2, quarantined: 0, online: false })).toEqual({
      tone: 'warn',
      label: 'Hors ligne. 2 en attente, gardé sur l’appareil.',
    });
  });

  it('file en attente ET quarantaine : les deux sont dits, en ambre', () => {
    expect(syncBannerLabel({ pending: 2, quarantined: 1, online: true })).toEqual({
      tone: 'warn',
      label: 'Synchronisation… 2 en attente. 1 saisie refusée par le serveur, non envoyée.',
    });
  });

  it('aucun cas avec quarantaine ne contient « Synchronisé »', () => {
    for (const pending of [0, 1, 5]) {
      for (const online of [true, false]) {
        const { label, tone } = syncBannerLabel({ pending, quarantined: 2, online });
        expect(label).not.toContain('Synchronisé');
        expect(tone).toBe('warn');
      }
    }
  });
});

describe('signOutRefusalLabel', () => {
  it('seulement des saisies en attente : revenir en ligne suffit', () => {
    expect(signOutRefusalLabel({ held: 1, refused: 0 })).toBe(
      '1 saisie pas encore synchronisée. Reviens en ligne pour te déconnecter sans rien perdre.',
    );
    expect(signOutRefusalLabel({ held: 3, refused: 0 })).toBe(
      '3 saisies pas encore synchronisées. Reviens en ligne pour te déconnecter sans rien perdre.',
    );
  });

  it('seulement la quarantaine : la vraie raison, sans « Reviens en ligne »', () => {
    expect(signOutRefusalLabel({ held: 1, refused: 1 })).toBe(
      '1 saisie refusée par le serveur n’a pas pu être enregistrée.',
    );
    expect(signOutRefusalLabel({ held: 2, refused: 2 })).toBe(
      '2 saisies refusées par le serveur n’ont pas pu être enregistrées.',
    );
  });

  it('les deux : chaque part est dite', () => {
    expect(signOutRefusalLabel({ held: 3, refused: 1 })).toBe(
      '2 saisies pas encore synchronisées. Reviens en ligne pour te déconnecter sans rien perdre. ' +
        '1 saisie refusée par le serveur n’a pas pu être enregistrée.',
    );
  });
});

describe('unsavedWritesLabel', () => {
  it('écritures en attente : c’est le réseau, elles partiront', () => {
    expect(unsavedWritesLabel({ pending: 2, refused: 0 })).toBe(
      'Pas de réseau pour le moment. Gardé sur l’appareil, envoyé au retour du réseau.',
    );
  });

  it('écriture refusée par la base : ne parle pas de réseau', () => {
    const label = unsavedWritesLabel({ pending: 0, refused: 1 });
    expect(label).toBe('1 saisie refusée par le serveur : elle n’est pas enregistrée.');
    expect(label).not.toContain('réseau');
  });

  it('plusieurs refus : accord au pluriel', () => {
    expect(unsavedWritesLabel({ pending: 0, refused: 3 })).toBe(
      '3 saisies refusées par le serveur : elles ne sont pas enregistrées.',
    );
  });

  it('les deux à la fois : les deux raisons sont dites', () => {
    expect(unsavedWritesLabel({ pending: 1, refused: 1 })).toBe(
      'Pas de réseau pour le moment. Gardé sur l’appareil, envoyé au retour du réseau. ' +
        '1 saisie refusée par le serveur : elle n’est pas enregistrée.',
    );
  });
});
