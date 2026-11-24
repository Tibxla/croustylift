// Kit E · la triade de statut, sans React (importable par les modules purs).
//
// Seul « mieux » prend le signal. Égalé reste blanc cassé, en deçà gris. Un statut
// s'écrit toujours couleur + signe + mot (`Status`), jamais la couleur seule.

/** Verdict d'une comparaison à la Référence : mieux, égal, en deçà. */
export type Verdict = 'up' | 'eq' | 'down';

/** Classe de teinte de chaque verdict. */
export const TONE: Record<Verdict, string> = {
  up: 'text-sig',
  eq: 'text-ink',
  down: 'text-muted',
};
