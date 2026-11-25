// Le sous-titre du bouton Sommaire de l'instrument : la progression de la séance,
// toujours, hors ligne comme sur réseau faible. Seules les alarmes (stockage
// plein, saisies refusées) prennent sa place.
import { describe, expect, it } from 'vitest';
import { sommaireDetail } from './sommaire-detail';

const ok = { pending: 0, refused: 0, offline: false, unsaved: false };

describe('sommaireDetail', () => {
  it('tout envoyé : « x sur y faits »', () => {
    expect(sommaireDetail(ok, 2, 6)).toEqual({ text: '2 sur 6 faits', alarm: false });
  });

  it('hors ligne, avec ou sans file : la progression reste', () => {
    expect(sommaireDetail({ ...ok, offline: true }, 2, 6)).toEqual({ text: '2 sur 6 faits', alarm: false });
    expect(sommaireDetail({ ...ok, offline: true, pending: 12 }, 3, 6)).toEqual({ text: '3 sur 6 faits', alarm: false });
  });

  it('envoi en attente sur réseau faible : la progression reste, le texte ne bascule plus', () => {
    expect(sommaireDetail({ ...ok, pending: 1 }, 2, 6)).toEqual({ text: '2 sur 6 faits', alarm: false });
  });

  it('stockage plein : l’alarme prend la place', () => {
    expect(sommaireDetail({ ...ok, unsaved: true, offline: true, pending: 3 }, 2, 6)).toEqual({ text: 'stockage plein', alarm: true });
  });

  it('saisies refusées : l’alarme prend la place', () => {
    expect(sommaireDetail({ ...ok, refused: 1 }, 2, 6)).toEqual({ text: '1 refusée', alarm: true });
    expect(sommaireDetail({ ...ok, refused: 2, offline: true }, 2, 6)).toEqual({ text: '2 refusées', alarm: true });
  });

  it('stockage plein, envoi arrêté (ADR 0025), et version dépassée : l’alarme prend la place', () => {
    expect(sommaireDetail({ ...ok, full: true, pending: 3 }, 2, 6)).toEqual({ text: 'stockage plein', alarm: true });
    expect(sommaireDetail({ ...ok, outdated: true, refused: 1 }, 2, 6)).toEqual({ text: 'mise à jour', alarm: true });
  });
});
