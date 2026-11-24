// Réordonner les séances d'une routine depuis une copie périmée écrasait un
// ordre plus récent (la RPC réécrit toutes les positions qu'on lui envoie) :
// tant que l'ordre affiché n'a pas été revalidé, Monter et Descendre attendent.
import { describe, expect, it } from 'vitest';
import { reorderLock } from './reorder-lock';

describe('reorderLock', () => {
  it('ordre lu dans une copie non revalidée, en ligne : boutons inactifs, l’écran le dit', () => {
    expect(reorderLock({ moving: false, verified: false, online: true })).toEqual({
      disabled: true,
      note: 'Ordre en cours de vérification.',
    });
  });

  it('hors ligne, la copie ne se revalide pas : boutons inactifs, la vérification attend le réseau', () => {
    expect(reorderLock({ moving: false, verified: false, online: false })).toEqual({
      disabled: true,
      note: 'Ordre à vérifier avec le réseau.',
    });
  });

  it('ordre revalidé : les boutons répondent, sauf pendant un déplacement en vol', () => {
    expect(reorderLock({ moving: false, verified: true, online: true })).toEqual({ disabled: false, note: null });
    expect(reorderLock({ moving: true, verified: true, online: true })).toEqual({ disabled: true, note: null });
  });
});
