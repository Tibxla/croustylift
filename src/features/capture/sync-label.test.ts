// Libellés de l'état de synchro : la quarantaine ne se cache jamais derrière
// « Synchronisé », et une Déconnexion refusée à cause d'elle dit pourquoi.
import { describe, it, expect } from 'vitest';
import {
  arrivalGuardLabel,
  heldWritesNotice,
  signOutRefusalLabel,
  syncBannerLabel,
  unsavedWritesLabel,
} from './sync-label';

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

describe('heldWritesNotice (écran de connexion)', () => {
  it('rien de retenu : pas d’avis', () => {
    expect(heldWritesNotice({ own: 0, foreign: 0, email: 'a@exemple.com' })).toBeNull();
  });

  it('saisies du compte reconnu : il est nommé', () => {
    expect(heldWritesNotice({ own: 2, foreign: 0, email: 'a@exemple.com' })).toBe(
      '2 saisies attendent encore la synchronisation pour a@exemple.com. ' +
        'Connecte-toi avec le compte concerné pour les envoyer.',
    );
  });

  it('saisies d’un compte absent, personne de reconnu : dites à part', () => {
    expect(heldWritesNotice({ own: 0, foreign: 1, email: null })).toBe(
      '1 saisie attend encore la synchronisation pour un compte déjà passé sur cet appareil. ' +
        'Connecte-toi avec le compte concerné pour les envoyer.',
    );
  });

  it('les deux : chacun son décompte', () => {
    const notice = heldWritesNotice({ own: 1, foreign: 3, email: 'a@exemple.com' });
    expect(notice).toContain('1 saisie attend encore la synchronisation pour a@exemple.com.');
    expect(notice).toContain('3 saisies attendent encore la synchronisation pour un autre compte.');
  });
});

describe('arrivalGuardLabel', () => {
  it('nomme le compte dont les saisies attendent et celui qui arrive', () => {
    expect(
      arrivalGuardLabel({ held: 2, heldEmail: 'a@exemple.com', arrivingEmail: 'b@exemple.com' }),
    ).toBe(
      '2 saisies de a@exemple.com attendent encore la synchronisation sur cet appareil, ' +
        'et ce lien ouvre un autre compte (b@exemple.com). ' +
        'Reviens à la connexion et connecte-toi avec a@exemple.com pour les envoyer.',
    );
  });
});

describe('syncBannerLabel, stockage plein', () => {
  it('ne dit jamais « Synchronisé » quand les saisies ne tiennent qu’en mémoire', () => {
    const { tone, label } = syncBannerLabel({
      pending: 2,
      quarantined: 0,
      online: true,
      unsaved: true,
    });
    expect(tone).toBe('warn');
    expect(label).toBe(
      'Stockage de l’appareil plein : tes saisies ne sont pas sauvegardées ici. Garde l’app ouverte. 2 en attente d’envoi.',
    );
  });

  it('file vide mais séance en cours non sauvegardée : l’avertissement reste', () => {
    expect(
      syncBannerLabel({ pending: 0, quarantined: 0, online: true, unsaved: true }).label,
    ).toBe('Stockage de l’appareil plein : tes saisies ne sont pas sauvegardées ici. Garde l’app ouverte.');
  });
});
