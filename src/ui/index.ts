// Kit E « Signal » : les primitives de toute l'app (DESIGN.md). Les écrans s'y
// servent ; aucun ne redessine un bouton, une ligne ou une feuille.
//
// RÈGLES DU STYLE (à relire avant d'ajouter quoi que ce soit)
// ---------------------------------------------------------------------------
// Fond noir chaud, texte blanc cassé, gris chauds. UNE seule couleur, le signal
// (`text-sig`, `var(--sig)`, réglable dans Réglages, jaune par défaut). Il est
// réservé à deux sens et à rien d'autre :
//   1. l'aiguille de la règle (« c'est ici que tu es ») ;
//   2. le ▲ « mieux que la Référence » (série battue, record, pente en hausse).
// Le signal n'est jamais un fond, jamais un bouton, jamais un lien, jamais un
// interrupteur activé, jamais une sélection. Il ne touche jamais le blanc cassé
// (1,3:1). Égalé reste blanc cassé (▬), en deçà reste gris (▼) : un statut =
// couleur + signe + mot, jamais la couleur seule (`Status`).
//
// Hiérarchie : taille et graisse d'Inter. Chiffres tabulaires (`tnum`) pour les
// nombres seuls, jamais pour une fourchette à trait d'union (« 8-12 ») ni du
// texte : Inter tabulaire donne au trait d'union une chasse de chiffre. Les
// emplacements déjà tabulaires du kit (`Row value`, `PrimaryButton meta`, `lead`)
// ne reçoivent donc qu'un nombre ou un « poids × reps ».
// L'action principale d'un écran est UN bloc blanc cassé plein en bas, dans la
// barre collée (`Screen bottom`). Le reste : bouton secondaire à
// contour, liens soulignés, lignes et filets. Icônes : seulement les icônes
// fonctionnelles de `icons.tsx`, là où elles sont lues sans hésiter ; une icône
// seule a un nom (aria-label) et 44 px. Plus les trois marques d'état d'un exo
// (fait, en cours, passé), toujours à côté de leur mot, jamais en signal.
//
// INTERDIT : dégradés (texte ou fond), flou, verre, halos, lueurs, ombres
// floues, cartes arrondies avec icône dans un rond, emojis, icônes décoratives,
// surtitres en majuscules ou en mono, pilules de badge, rounded-2xl, microcopie
// motivante, tiret long dans le texte affiché (« · » ou virgule), `position:
// fixed` (barres collées en `sticky`, feuilles montées dans `SheetSlotContext`).
// Cibles tactiles de 44 px au moins. Contraste AA (4,5:1 pour du texte), gardé
// par `npm run contrast` et son test.
//
// TOKENS (src/index.css, ratios sur le fond #100e0c)
//   bg #100e0c fond · raise #1a1815 feuilles, bouton secondaire · ink #f4f0e7
//   16,9:1 texte, bouton principal · muted #b5b0a9 8,9:1 secondaire, ▼ ·
//   faint #8f8c85 5,7:1 méta (13 px au moins) · dim #6b6761 3,4:1 repères non
//   textuels · line #3a3733 filets, aplat de pression · on-ink #4a463f texte
//   secondaire sur le bouton principal · sig réglable.
//   Rayons : `rounded-block` 6 px, `rounded-t-sheet` 10 px. Marge d'écran 20 px
//   (px-5). Échelle : 72 (poids) · 32 · 28 (titre d'écran) · 22 · 18 (bouton) ·
//   17 (section, ligne) · 16 (corps) · 15 · 14 (méta) · 13 (le plus petit).
//
// MOUVEMENT (rares, courts, interruptibles : des transitions, jamais de keyframes)
//   - `ui-press` : un bouton s'enfonce, scale(0.97) en 140 ms. Jamais sur un geste
//     répété des centaines de fois en salle (`press={false}`) : le fond change seul.
//   - Feuille : monte en 240 ms (courbe de tiroir iOS), descend en 150 ms.
//   - Règle : saut sec au toucher, élan de 320 ms sur un coup sec.
//   - Réduire les animations (Réglages, défaut = système ; `data-motion` sur <html>) :
//     plus de déplacement ni d'échelle, seuls les fondus restent.
export { PrimaryButton, SecondaryButton, TextLink } from './buttons';
export { ActionNote, ActionRow, Confirm, Disclosure } from './confirm';
export { Choice, Stepper, Switch } from './controls';
export { CheckBox, FieldError, ImplicitSubmit, Notice, PasswordField, RadioMark, TextArea, TextField } from './fields';
export { Icon, IconButton, StateIcon, StateMark, type ExoState } from './icons';
export { BottomBar, EmptyState, List, Row, Screen, ScreenHeader, SectionTitle } from './layout';
export { NumberRow } from './number-row';
export { Ruler } from './ruler';
export { Sheet } from './sheet';
export { SheetSlotContext } from './sheet-slot';
export { Alert, LoadError, Loading } from './states';
export { Sign, Status } from './status';
export { SyncBanner } from './sync-banner';
export { TONE, type Verdict } from './status-tone';
export { useCompact, useCompactTight } from './use-compact';
