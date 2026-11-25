// Kit E · mise en page d'un écran : en-tête, sections, groupes arrondis et leurs
// lignes, état vide, barre d'action collée en bas.
//
// GROUPES ARRONDIS (direction du 25/11, DESIGN.md « Shapes ») : une liste est UN
// bloc levé (`bg-surface`), retiré de 16 px des bords, de rayon 18 px ; ses
// lignes se séparent par un filet intérieur qui ne touche aucun bord. Jamais de
// bloc dans un bloc, jamais d'ombre. Les écrans qui écrivent leurs propres
// lignes (réglages, fiche, fin de séance) prennent `GROUP` pour le conteneur et
// `GROUP_ROW` pour chaque ligne, plutôt que de redessiner un filet.
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
 *  `action` : un lien ou un bouton à droite (plusieurs se rangent côte à côte).
 *  `meta` : une ligne sous le titre. Un retour au nom long (routine) se coupe
 *  en fin de ligne plutôt que de pousser les actions hors de l'écran à 360 px :
 *  les actions gardent leur taille, le nom entier reste lu. */
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
        <div className="-ml-1 flex min-h-11 items-center justify-between gap-3">
          {back ? (
            <button
              type="button"
              onClick={back.onClick}
              className="inline-flex h-11 min-w-0 items-center gap-2 pl-1 pr-3 text-[16px] text-muted active:text-ink"
            >
              <span className="flex-none">
                <Chevron dir="left" />
              </span>
              <span className="truncate">{back.label}</span>
            </button>
          ) : (
            <span />
          )}
          {action && <div className="flex flex-none items-center gap-2">{action}</div>}
        </div>
      )}
      <h1 className="break-words text-[28px] font-[650] leading-[1.15] tracking-[-0.025em] text-ink">{title}</h1>
      {meta && <p className="mt-1 text-[15px] text-muted">{meta}</p>}
    </header>
  );
}

/** Conteneur d'un groupe arrondi (bloc levé retiré de 16 px des bords). */
export const GROUP = 'mx-4 rounded-group bg-surface';

/** Ligne d'un groupe (`.group-row`, index.css) : filet intérieur au-dessus de
 *  chaque ligne sauf la première, retiré de 16 px des deux côtés ; coins de la
 *  première et de la dernière arrondis comme le groupe. Pressée par sa zone
 *  touchable (enfant direct marqué `data-row-hit`), la ligne entière prend
 *  l'aplat de pression. Une classe plutôt que sept utilitaires à variantes :
 *  elle sert sur chaque ligne de l'app et tient le budget CSS. */
export const GROUP_ROW = 'group-row';

/** Filet intérieur au-dessus d'un bloc posé DANS une ligne de groupe (la partie
 *  dépliée d'un exo de l'éditeur), retiré de 16 px des deux côtés. */
export const GROUP_RULE = 'group-rule';

/** Titre de section : phrase en casse normale, jamais de surtitre en majuscules. */
export function SectionTitle({ children, aside, id }: { children: ReactNode; aside?: ReactNode; id?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-5 pb-2 pt-7">
      <h2 id={id} className="text-[17px] font-semibold text-ink">
        {children}
      </h2>
      {aside && <span className="text-[14px] text-muted">{aside}</span>}
    </div>
  );
}

/** Ligne d'un groupe : titre, méta dessous, valeur à droite, chevron si `onClick`
 *  (« ouvrir »). `chevron={false}` : le toucher ne mène nulle part (il ajoute,
 *  par exemple) ; `mark` pose alors à sa place une icône décorative qui dit le
 *  geste, DANS la zone touchable.
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
  chevron = true,
  mark,
}: {
  title: ReactNode;
  meta?: ReactNode;
  value?: ReactNode;
  valueMeta?: ReactNode;
  lead?: ReactNode;
  onClick?: () => void;
  trailing?: ReactNode;
  /** Ligne courante : titre en demi-gras et `aria-current` ; le mot qui le dit
   *  (« courante », « actuelle ») revient à l'appelant, en méta ou en `valueMeta`. */
  current?: boolean;
  /** Ligne éteinte (passée, archivée) : titre en gris. */
  muted?: boolean;
  ariaLabel?: string;
  /** false : pas de chevron « ouvrir ». */
  chevron?: boolean;
  /** Icône décorative à la place du chevron (`chevron={false}`). */
  mark?: ReactNode;
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
      {onClick && (chevron || mark) && (
        <span aria-hidden className="flex-none self-center text-faint">
          {chevron ? <Chevron /> : mark}
        </span>
      )}
    </>
  );
  // Un titre seul (ni méta ni valeur) se centre sur la ligne, à la hauteur du
  // chevron ; sinon tout part du haut, pour les titres sur deux lignes.
  const bare = !meta && value === undefined && valueMeta === undefined;
  const cls = `flex min-h-14 min-w-0 flex-1 ${bare ? 'items-center' : 'items-start'} gap-3 py-3 text-left`;
  // Pressée, toute la ligne prend l'aplat de pression (pas l'action à part,
  // `trailing`, qui a son propre retour).
  return (
    <li className={`${GROUP_ROW} flex items-center gap-3 px-4`}>
      {onClick ? (
        <button
          type="button"
          data-row-hit
          onClick={onClick}
          aria-label={ariaLabel}
          aria-current={current ? 'true' : undefined}
          className={cls}
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

/** Liste de `Row` : un groupe arrondi. */
export function List({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <ul aria-label={label} className={GROUP}>
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
