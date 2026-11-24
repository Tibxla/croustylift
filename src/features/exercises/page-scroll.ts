// Défilement entre les pages de la surface Exos (liste, fiche, formulaire),
// sur le modèle de l'Analyse : une page plus profonde s'ouvre en haut, un
// retour retrouve la position quittée. Exception : un retour qui porte un
// message (« créé », « supprimé », « enregistré ») s'ouvre en haut, là où la
// phrase s'affiche.
//
// Pur : la pile des positions entre, la nouvelle pile et la position cible
// sortent. `stack[d]` est la position quittée à la profondeur d.

export interface ScrollStep {
  stack: number[];
  target: number;
}

export function scrollStep(
  stack: readonly number[],
  from: number,
  to: number,
  currentY: number,
  withMessage: boolean,
): ScrollStep {
  if (to > from) {
    const next = stack.slice(0, from);
    next[from] = currentY;
    return { stack: next, target: 0 };
  }
  if (to < from) {
    const kept = stack[to] ?? 0;
    return { stack: stack.slice(0, to), target: withMessage ? 0 : kept };
  }
  return { stack: [...stack], target: 0 };
}
