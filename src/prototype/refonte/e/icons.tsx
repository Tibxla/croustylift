// PROTOTYPE JETABLE · socle E « Signal » : le jeu d'icônes FONCTIONNELLES, seule
// source de pictogrammes de l'app (chevron de navigation compris, réexporté par kit.tsx).
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
import type { ReactNode } from 'react';

export type IconName =
  | 'plus'
  | 'more'
  | 'edit'
  | 'trash'
  | 'note'
  | 'reorder'
  | 'eye'
  | 'eye-off'
  | 'chevron-down'
  | 'chevron-up';

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
  trash: (
    <>
      <path d="M4 7h16M9.5 7V4.5h5V7" />
      <path d="M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5" />
    </>
  ),
  // page cornée à deux lignes : une note écrite
  note: (
    <>
      <path d="M6 3.5h8.5L19 8v12.5H6z" />
      <path d="M14 3.5V8.5h5M9 13h7M9 16.5h5" />
    </>
  ),
  // ⇅ réordonner
  reorder: (
    <>
      <path d="M8 19V5M4.5 8.5 8 5l3.5 3.5" />
      <path d="M16 5v14M12.5 15.5 16 19l3.5-3.5" />
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
};

/** Chevron de navigation : il dit « ça s'ouvre » (ligne) ou « retour » (en-tête). */
export function Chevron({ dir = 'right' }: { dir?: 'right' | 'left' }) {
  return (
    <svg width="8" height="14" viewBox="0 0 8 14" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.6" className="flex-none">
      <path d={dir === 'right' ? 'M1.5 1.5 6.5 7l-5 5.5' : 'M6.5 1.5 1.5 7l5 5.5'} />
    </svg>
  );
}

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

/** Bouton icône seule, 44 × 44 px. `framed` : contour net (action d'en-tête, même
 *  famille que le bouton secondaire) ; sans cadre dans une ligne de liste, où il
 *  se range comme le chevron. `pressed` : bascule (aria-pressed). */
export function IconButton({
  icon,
  label,
  onClick,
  framed = false,
  tone = 'ink',
  dot = false,
  pressed,
  disabled,
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
  pressed?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      className={`e-press relative inline-flex h-11 w-11 flex-none items-center justify-center rounded-(--r) disabled:text-(--dim) ${
        framed ? 'border-[1.5px] border-(--ink) bg-(--raise) text-(--ink) active:bg-(--line)' : `${tone === 'ink' ? 'text-(--ink)' : 'text-(--muted)'} active:bg-(--line) active:text-(--ink)`
      } ${className}`}
    >
      <Icon name={icon} />
      {dot && <span aria-hidden className="absolute right-[8px] top-[8px] h-[6px] w-[6px] bg-(--ink)" />}
    </button>
  );
}
