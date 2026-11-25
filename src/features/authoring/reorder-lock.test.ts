// Réordonner les séances d'une routine depuis une copie périmée écrasait un
// ordre plus récent (la RPC réécrit toutes les positions qu'on lui envoie) :
// tant que l'ordre affiché n'a pas été revalidé, Monter et Descendre attendent.
import { describe, expect, it } from 'vitest';
import { reorderLock } from './reorder-lock';

describe('reorderLock', () => {
  it('ordre lu dans une copie non revalidée, en ligne : boutons inactifs, l’écran le dit', () => {
    expect(reorderLock({ moving: false, verified: false, online: true, late: false })).toEqual({
      disabled: true,
      note: 'Ordre en cours de vérification.',
      retry: false,
    });
  });

  it('hors ligne, la copie ne se revalide pas : boutons inactifs, la vérification attend le réseau', () => {
    expect(reorderLock({ moving: false, verified: false, online: false, late: false })).toEqual({
      disabled: true,
      note: 'Ordre à vérifier avec le réseau.',
      retry: false,
    });
  });

  it('ordre revalidé : les boutons répondent, sauf pendant un déplacement en vol', () => {
    expect(reorderLock({ moving: false, verified: true, online: true, late: false })).toEqual({ disabled: false, note: null, retry: false });
    expect(reorderLock({ moving: true, verified: true, online: true, late: false })).toEqual({ disabled: true, note: null, retry: false });
  });

  it('en ligne, la vérification n’arrive pas (relecture en échec ou trop lente) : « Réessayer » à côté du message', () => {
    expect(reorderLock({ moving: false, verified: false, online: true, late: true })).toEqual({
      disabled: true,
      note: 'Ordre en cours de vérification.',
      retry: true,
    });
    // Hors ligne, réessayer ne servirait à rien.
    expect(reorderLock({ moving: false, verified: false, online: false, late: true }).retry).toBe(false);
  });
});
