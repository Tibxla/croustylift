// Kit E · mise en page d'un écran : en-tête, sections, filets, lignes de liste,
// état vide, barre d'action collée en bas.
import type { ReactNode } from 'react';
import { Chevron } from './icons';

/** Écran : contenu qui défile + barre d'action collée en bas (`bottom`). Il
 *  remplit la surface (le shell la pose en colonne flexible de hauteur
 *  `min-h-surface`) : la barre reste au bas de l'écran même quand le contenu est
 *  court, et le document ne défile pas pour rien. */
export function Screen({ children, bottom }: { children: ReactNode; bottom?: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex-1">{children}</div>
      {bottom && <BottomBar>{bottom}</BottomBar>}
    </div>
  );
}

/** Barre d'action collée en bas : `sticky`, fond plein (jamais de flou), et elle
 *  porte elle-même l'encoche basse de l'iPhone. Jamais `position: fixed` : une
 *  barre fixe se décroche quand WebKit se trompe de fenêtre (DESIGN.md, Layout). */
export function BottomBar({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-0 z-10 mt-3 flex flex-col gap-2 bg-bg px-5 pb-[calc(0.75rem+var(--safe-bottom))] pt-2">{children}</div>
  );
}

/** En-tête d'écran. `back` : retour vers la page parente, nommée (« ‹ Séance »).
 *  `action` : un lien ou un bouton à droite. `meta` : une ligne sous le titre. */
export function ScreenHeader({
  title,
  meta,
  back,
  action,
}: {
  title: ReactNode;
  meta?: ReactNode;
  back?: { label: string; onClick: () => void };
  action?: ReactNode;
}) {
  return (
    <header className="px-5 pb-4 pt-1">
      {(back || action) && (
        <div className="-ml-1 flex min-h-11 items-center justify-between">
          {back ? (
            <button
              type="button"
              onClick={back.onClick}
              className="inline-flex h-11 items-center gap-2 pl-1 pr-3 text-[16px] text-muted active:text-ink"
            >
              <Chevron dir="left" />
              {back.label}
            </button>
          ) : (
            <span />
          )}
          {action}
        </div>
      )}
      <h1 className="text-[28px] font-[650] leading-[1.15] tracking-[-0.025em] text-ink">{title}</h1>
      {meta && <p className="mt-1 text-[15px] text-muted">{meta}</p>}
    </header>
  );
}

/** Titre de section : phrase en casse normale, jamais de surtitre en majuscules. */
export function SectionTitle({ children, aside, id }: { children: ReactNode; aside?: ReactNode; id?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-5 pb-2 pt-6">
      <h2 id={id} className="text-[17px] font-semibold text-ink">
        {children}
      </h2>
      {aside && <span className="text-[14px] text-muted">{aside}</span>}
    </div>
  );
}

/** Filet horizontal. `inset` : aligné sur la marge d'écran. `strong` : trait de
 *  2 px qui sépare deux familles de contenu. */
export function Rule({ inset = true, strong = false }: { inset?: boolean; strong?: boolean }) {
  return <hr className={`border-0 ${strong ? 'h-[2px] bg-muted' : 'h-px bg-line'} ${inset ? 'mx-5' : ''}`} />;
}

/** Ligne de liste : titre, méta dessous, valeur à droite, chevron si `onClick`.
 *  Le titre passe à la ligne plutôt que d'être coupé : deux noms d'exo proches
 *  doivent rester distincts (registre U3). `trailing` : une action à part (lien
 *  « Remplacer »), hors de la zone touchable de la ligne (jamais de bouton dans
 *  un bouton). `lead` : colonne de gauche étroite (rang, numéro). */
export function Row({
  title,
  meta,
  value,
  valueMeta,
  lead,
  onClick,
  trailing,
  current,
  muted,
  ariaLabel,
}: {
  title: ReactNode;
  meta?: ReactNode;
  value?: ReactNode;
  valueMeta?: ReactNode;
  lead?: ReactNode;
  onClick?: () => void;
  trailing?: ReactNode;
  /** Ligne courante : trait blanc cassé à gauche. */
  current?: boolean;
  /** Ligne éteinte (passée, archivée) : titre en gris. */
  muted?: boolean;
  ariaLabel?: string;
}) {
  const body = (
    <>
      {lead !== undefined && <span className="tnum w-6 flex-none pt-px text-[15px] text-faint">{lead}</span>}
      <span className="min-w-0 flex-1">
        <span className={`block break-words text-[17px] leading-[1.3] ${muted ? 'text-muted' : 'text-ink'} ${current ? 'font-semibold' : 'font-medium'}`}>
          {title}
        </span>
        {meta && <span className="mt-0.5 block text-[14px] text-muted">{meta}</span>}
      </span>
      {(value !== undefined || valueMeta !== undefined) && (
        <span className="tnum flex-none text-right">
          {value !== undefined && <span className="block text-[17px] font-medium text-ink">{value}</span>}
          {valueMeta && <span className="mt-0.5 block text-[14px] text-muted">{valueMeta}</span>}
        </span>
      )}
      {onClick && (
        <span className="flex-none self-center text-faint">
          <Chevron />
        </span>
      )}
    </>
  );
  const cls = 'flex min-h-14 min-w-0 flex-1 items-start gap-3 py-3 text-left';
  return (
    <li className="relative flex items-center gap-3 border-b border-line px-5">
      {current && <span aria-hidden className="absolute bottom-3 left-0 top-3 w-[3px] bg-ink" />}
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          aria-label={ariaLabel}
          aria-current={current ? 'true' : undefined}
          className={`${cls} active:opacity-70`}
        >
          {body}
        </button>
      ) : (
        <div className={cls}>{body}</div>
      )}
      {trailing}
    </li>
  );
}

/** Liste de `Row`, filet en tête. */
export function List({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <ul aria-label={label} className="border-t border-line">
      {children}
    </ul>
  );
}

/** État vide : une phrase qui dit ce qui manque et, si possible, l'action. */
export function EmptyState({ title, body, action }: { title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="px-5 py-10">
      <p className="text-[17px] font-medium text-ink">{title}</p>
      {body && <p className="mt-1.5 max-w-[34ch] text-[15px] leading-[1.45] text-muted">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
