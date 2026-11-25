// Kit E · le jeu d'icônes FONCTIONNELLES, seule source de pictogrammes de l'app
// (chevron de navigation compris).
//
// RÈGLES
//   - Une icône remplace un mot seulement quand elle est universellement lue
//     (retour, ajouter, plus d'options, éditer, supprimer, note, réordonner,
//     masquer/afficher, déplier). Ailleurs, le mot reste (« Remplacer »,
//     « Passer », « Remettre », « Personnaliser »).
//   - Trait de 1,75 sur une grille de 24, extrémités rondes, `currentColor` :
//     elle prend la teinte du texte autour, jamais le signal, jamais un aplat.
//   - Jamais décorative : pas d'icône à côté d'un titre, pas de rond coloré
//     derrière. Une icône seule est un `IconButton` : `label` obligatoire (lu
//     par les lecteurs d'écran, reprend le mot qu'elle remplace) et cible de
//     44 × 44 px.
//   - `dot` : indice discret (petit carré blanc cassé, 6 px) quand le contenu
//     existe déjà (une note est écrite). Jamais le signal.
//
// MARQUES D'ÉTAT D'UN EXO (seule exception à « une icône remplace un mot ») :
// trois cercles de même encombrement, lus comme une suite. Elles accompagnent
// TOUJOURS le mot (`StateMark`), sauf là où la place manque et où le mot est
// porté par l'aria-label de l'élément.
//   fait      cercle + coche          l'exo a son minimum de séries
//   en cours  cercle à moitié plein   entamé, pas fini : seule marque pleine,
//                                     celle qui appelle encore un geste
//   passé     cercle barré            écarté par le geste « Passer », rien d'autre
//   à faire   aucune marque           l'absence se lit, une 4ᵉ forme serait du bruit
// Teintes : blanc cassé (fait, en cours) et gris (passé), toutes deux à 8:1 au
// moins sur le fond (registre U35), jamais le filet. Pas d'animation : la marque
// change à chaque série loggée.
//
// PASTILLE D'ÉTAT (`StatePill` : Sommaire, index de la Salle, fin de séance ;
// demande du 25/11). Signe + mot + couleur, la triade :
//   fait      pastille pleine vert sauge (`status-done`), coche, texte noir chaud
//   en cours  pastille pleine bleu ardoise (`status-current`), cercle à moitié
//             plein, texte noir chaud
//   à faire   gris, sans pastille
//   passé     gris barré, sans pastille
// Ces deux couleurs n'ont qu'un sens chacune, comme le signal (« mieux que »).
// Noir chaud dessus : 8,8:1 et 7,6:1 (`npm run contrast`).
import type { ReactNode } from 'react';

export type IconName =
  | 'plus'
  | 'more'
  | 'edit'
  | 'note'
  | 'eye'
  | 'eye-off'
  | 'chevron-down'
  | 'chevron-up'
  | 'state-done'
  | 'state-partial'
  | 'state-skipped';

const PATHS: Record<IconName, ReactNode> = {
  plus: <path d="M12 5v14M5 12h14" />,
  // ⋯ plus d'options : trois points pleins
  more: (
    <g fill="currentColor" stroke="none">
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </g>
  ),
  edit: (
    <>
      <path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3z" />
      <path d="M14.5 7.5l3 3" />
    </>
  ),
  // page cornée à deux lignes : une note écrite
  note: (
    <>
      <path d="M6 3.5h8.5L19 8v12.5H6z" />
      <path d="M14 3.5V8.5h5M9 13h7M9 16.5h5" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.75" />
    </>
  ),
  'eye-off': (
    <>
      <path d="M9.9 6A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.6 3.4M14 17.7a8.6 8.6 0 0 1-2 .8C6 18.5 2.5 12 2.5 12a16.7 16.7 0 0 1 3.7-4.4" />
      <path d="M4 4l16 16" />
    </>
  ),
  'chevron-down': <path d="M6 9.5l6 6 6-6" />,
  'chevron-up': <path d="M6 14.5l6-6 6 6" />,
  // Marques d'état : même cercle (r 8,25), donc même encombrement en colonne.
  'state-done': (
    <>
      <circle cx="12" cy="12" r="8.25" />
      <path d="M8.4 12.3l2.5 2.5 4.8-5.2" />
    </>
  ),
  'state-partial': (
    <>
      <circle cx="12" cy="12" r="8.25" />
      <path d="M12 6.5a5.5 5.5 0 0 1 0 11z" fill="currentColor" stroke="none" />
    </>
  ),
  'state-skipped': (
    <>
      <circle cx="12" cy="12" r="8.25" />
      <path d="M6.3 17.7 17.7 6.3" />
    </>
  ),
};

/** État d'un exo dans la séance en cours. `todo` ne porte aucune marque. */
export type ExoState = 'todo' | 'partial' | 'done' | 'skipped';

const STATE_ICON: Record<Exclude<ExoState, 'todo'>, IconName> = {
  done: 'state-done',
  partial: 'state-partial',
  skipped: 'state-skipped',
};

/** Pictogramme seul, inerte (aria-hidden) : à poser dans un bouton qui porte le mot. */
export function Icon({ name, size = 22, className = '' }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`flex-none ${className}`}
    >
      {PATHS[name]}
    </svg>
  );
}

/** Marque d'état seule (sans mot), là où le mot est porté par l'aria-label. `todo` : rien. */
export function StateIcon({ state, size = 14, className = '' }: { state: ExoState; size?: number; className?: string }) {
  if (state === 'todo') return null;
  return <Icon name={STATE_ICON[state]} size={size} className={`${state === 'skipped' ? 'text-muted' : ''} ${className}`} />;
}

/** Marque d'état + son mot (« ◐ en cours · 1 série sur 3 ») : le statut ne se lit
 *  jamais à la seule icône. La teinte suit le texte autour, sauf « passé » (gris). */
export function StateMark({
  state,
  children,
  size = 15,
  className = '',
}: {
  state: ExoState;
  children: ReactNode;
  size?: number;
  className?: string;
}) {
  return (
    <span data-state={state} className={`inline-flex min-w-0 items-center gap-1.5 ${className}`}>
      <StateIcon state={state} size={size} />
      <span className="min-w-0">{children}</span>
    </span>
  );
}

/** Pastille d'état d'un exo (voir l'en-tête) : la marque et son mot dans une
 *  pastille arrondie (`rounded-cell`), vert sauge pour « fait », bleu ardoise
 *  pour « en cours » ; « à faire » et « passé » restent du texte gris. */
export function StatePill({
  state,
  children,
  size = 14,
  compact = false,
}: {
  state: ExoState;
  children: ReactNode;
  size?: number;
  /** Interligne de 20 px au lieu de 24 (index de l'instrument, ligne de 20 px). */
  compact?: boolean;
}) {
  const look =
    state === 'done'
      ? 'rounded-cell bg-status-done px-2 font-semibold text-bg'
      : state === 'partial'
        ? 'rounded-cell bg-status-current px-2 font-semibold text-bg'
        : state === 'skipped'
          ? 'text-muted line-through decoration-1'
          : 'text-muted';
  return (
    <span data-state={state} className={`inline-flex min-w-0 items-center gap-1.5 ${compact ? 'leading-5' : 'leading-6'} ${look}`}>
      <StateIcon state={state} size={size} className={state === 'skipped' ? '' : 'flex-none'} />
      <span className="min-w-0">{children}</span>
    </span>
  );
}

/** Chevron de navigation : il dit « ça s'ouvre » (ligne) ou « retour » (en-tête). */
export function Chevron({ dir = 'right' }: { dir?: 'right' | 'left' }) {
  return (
    <svg width="8" height="14" viewBox="0 0 8 14" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.6" className="flex-none">
      <path d={dir === 'right' ? 'M1.5 1.5 6.5 7l-5 5.5' : 'M6.5 1.5 1.5 7l5 5.5'} />
    </svg>
  );
}

/** Bouton icône seule, 44 × 44 px. `framed` : contour net (action d'en-tête, même
 *  famille que le bouton secondaire) ; sans cadre dans une ligne de liste, où il
 *  se range comme le chevron. */
export function IconButton({
  icon,
  label,
  onClick,
  framed = false,
  tone = 'ink',
  dot = false,
  className = '',
}: {
  icon: IconName;
  /** Nom lu par les lecteurs d'écran : le mot que l'icône remplace. */
  label: string;
  onClick?: () => void;
  framed?: boolean;
  tone?: 'ink' | 'muted';
  /** Indice « il y a déjà quelque chose » (note écrite). */
  dot?: boolean;
  className?: string;
}) {
  const look = framed
    ? 'border-[1.5px] border-ink bg-raise text-ink active:bg-line'
    : `${tone === 'ink' ? 'text-ink' : 'text-muted'} active:bg-line active:text-ink`;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`ui-press relative inline-flex h-11 w-11 flex-none items-center justify-center rounded-block ${look} ${className}`}
    >
      <Icon name={icon} />
      {dot && <span aria-hidden className="absolute right-[8px] top-[8px] h-[6px] w-[6px] bg-ink" />}
    </button>
  );
}
