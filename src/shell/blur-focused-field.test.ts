// Un champ au clavier perd le focus avant que son écran ne se cache ou ne se
// démonte : onglet changé, retour au Sommaire de la Salle (bouton « ‹ Sommaire »
// ou glissé depuis le bord). Sinon, sur iPhone, le clavier descend sur un champ
// disparu et peut laisser la fenêtre d'affichage faussée (registre R4).
import { describe, expect, it, vi } from 'vitest';
import { blurFocusedField } from './blur-focused-field';

const focusedOn = (tagName: string) => {
  const blur = vi.fn();
  return { doc: { activeElement: { tagName, blur } as unknown as Element }, blur };
};

describe('blurFocusedField', () => {
  it('un champ de saisie (poids, reps, note, liste) perd le focus', () => {
    for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) {
      const { doc, blur } = focusedOn(tag);
      blurFocusedField(doc);
      expect(blur).toHaveBeenCalledOnce();
    }
  });

  it('un bouton ou rien de focalisé : rien ne bouge', () => {
    const { doc, blur } = focusedOn('BUTTON');
    blurFocusedField(doc);
    expect(blur).not.toHaveBeenCalled();
    expect(() => blurFocusedField({ activeElement: null })).not.toThrow();
  });
});
