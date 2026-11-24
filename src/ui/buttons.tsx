// Kit E · bouton principal, bouton secondaire, lien souligné.
import type { ReactNode } from 'react';

/** Bouton principal : bloc blanc cassé plein, 56 px. Un seul par écran, en bas.
 *  `meta` s'affiche à droite en gris foncé (ex. « 82,5 × 8 »), `over` au-dessus
 *  du libellé (« Exo suivant » au-dessus du nom). */
export function PrimaryButton({
  children,
  over,
  meta,
  onClick,
  disabled,
  ariaLabel,
  press = true,
  type = 'button',
  className = '',
}: {
  children: ReactNode;
  over?: ReactNode;
  meta?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  ariaLabel?: string;
  /** false : pas d'enfoncement (geste répété en salle, ex. logger) ; le fond change seul. */
  press?: boolean;
  type?: 'button' | 'submit';
  className?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={`flex h-14 min-w-0 flex-auto items-center justify-between gap-3 rounded-block bg-ink px-4 text-left text-bg active:bg-muted disabled:bg-line disabled:text-muted ${press ? 'ui-press' : ''} ${className}`}
    >
      <span className="flex min-w-0 flex-col">
        {over && <span className="truncate text-[13px] font-medium leading-tight text-on-ink">{over}</span>}
        <span className={`truncate font-semibold tracking-[-0.01em] ${over ? 'text-[17px] leading-tight' : 'text-[18px]'}`}>{children}</span>
      </span>
      {meta && <span className="tnum flex-none text-[15px] font-medium text-on-ink">{meta}</span>}
    </button>
  );
}

/** Bouton secondaire : contour blanc cassé franc (1,5 px) sur fond levé, libellé
 *  centré en demi-gras. Il ne doit jamais se lire comme un champ de saisie
 *  (contour gris fin, texte à gauche). `size="sm"` : 44 px, pour une action
 *  d'en-tête ou posée dans une ligne. Avec `meta`, libellé à gauche. */
export function SecondaryButton({
  children,
  meta,
  onClick,
  disabled,
  press = true,
  ariaLabel,
  size = 'md',
  className = '',
}: {
  children: ReactNode;
  meta?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  /** false : pas d'enfoncement (geste répété en salle). */
  press?: boolean;
  ariaLabel?: string;
  size?: 'md' | 'sm';
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={`flex min-w-0 items-center gap-3 rounded-block border-[1.5px] border-ink bg-raise text-ink active:bg-line disabled:border-line disabled:bg-transparent disabled:text-faint ${
        size === 'sm' ? 'h-11 px-3.5' : 'h-12 px-4'
      } ${meta ? 'justify-between' : 'justify-center'} ${press ? 'ui-press' : ''} ${className}`}
    >
      <span className={`truncate font-semibold ${size === 'sm' ? 'text-[15px]' : 'text-[16px]'}`}>{children}</span>
      {meta && <span className="flex-none text-[14px] text-muted">{meta}</span>}
    </button>
  );
}

/** Lien souligné, cible 44 px. Réservé à la navigation (« Voir dans l'Analyse »),
 *  aux actions mineures en ligne (« Annuler la série 3 », « Remettre ») et à
 *  l'option DESTRUCTIVE d'une confirmation qui fait perdre des données
 *  (« Supprimer définitivement ») : dans une confirmation, l'option sûre est
 *  toujours le bouton (« Garder »), la perte un lien discret. Une vraie action
 *  est un bouton. */
export function TextLink({
  children,
  onClick,
  tone = 'ink',
  className = '',
  ariaLabel,
}: {
  children: ReactNode;
  onClick?: () => void;
  tone?: 'ink' | 'muted';
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={`inline-flex min-h-11 items-center text-left text-[16px] underline decoration-1 underline-offset-4 ${
        tone === 'ink' ? 'text-ink' : 'text-muted active:text-ink'
      } ${className}`}
    >
      {children}
    </button>
  );
}
