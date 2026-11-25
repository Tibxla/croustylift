// Avant de cacher ou de démonter l'écran qui le porte, un champ en cours de
// saisie perd le focus : changement d'onglet (App.tsx), retour au Sommaire de la
// Salle (bouton « ‹ Sommaire » du pied et glissé depuis le bord, CaptureScreen
// et EdgeSwipeBack). Sinon le champ disparaît pendant que le clavier descend, ce
// qui sur iPhone peut laisser la fenêtre d'affichage faussée et les barres du
// bas décrochées (registre R4).
//
// Lu par le nom de balise, pas par `instanceof` : testable sans DOM.

const FIELDS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

export function blurFocusedField(
  doc: { activeElement: Element | null } | undefined = typeof document === 'undefined' ? undefined : document,
): void {
  const focused = doc?.activeElement as (Element & { blur?: () => void }) | null | undefined;
  if (focused && FIELDS.has(focused.tagName) && typeof focused.blur === 'function') focused.blur();
}
