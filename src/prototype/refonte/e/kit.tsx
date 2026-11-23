// PROTOTYPE JETABLE · socle E « Signal » : tokens et primitives de toute l'app.
//
// RÈGLES DU STYLE (à relire avant d'ajouter quoi que ce soit)
// ---------------------------------------------------------------------------
// Fond noir chaud, texte blanc cassé, gris chauds. UNE seule couleur, le
// signal `--sig` (jaune par défaut, réglable dans Réglages). Il est réservé à
// deux sens et à rien d'autre :
//   1. l'aiguille de la règle (« c'est ici que tu es ») ;
//   2. le ▲ « mieux que la Référence » (série battue, record, pente en hausse).
// Le signal n'est jamais un fond, jamais un bouton, jamais un lien, jamais un
// interrupteur activé, jamais une sélection. Il ne touche jamais le blanc
// cassé (1,3:1). Égalé reste blanc cassé (▬), en deçà reste gris (▼) : un
// statut = couleur + signe + mot, jamais la couleur seule.
//
// Hiérarchie : taille et graisse d'Inter, chiffres tabulaires. L'action
// principale d'un écran est UN bloc blanc cassé plein en bas (zone du pouce).
// Le reste : bouton secondaire à contour, liens soulignés, lignes et filets.
// Icônes : seulement les icônes FONCTIONNELLES de e/icons.tsx (remplacer,
// ajouter, options, éditer, supprimer, note, réordonner, masquer), là où elles
// sont lues sans hésiter ; une icône seule a un nom (aria-label) et 44 px.
//
// INTERDIT : dégradés (texte ou fond), flou, verre, halos, lueurs, ombres
// floues, cartes arrondies avec icône dans un rond, emojis, icônes décoratives,
// surtitres en majuscules mono, pilules de badge, rounded-2xl, microcopie
// motivante, tiret long dans le texte affiché (« · » ou virgule), `position:
// fixed` (barres collées en `sticky`, feuilles montées dans l'emplacement du
// shell). Cibles tactiles ≥ 44 px. Contraste AA (≥ 4,5:1 pour du texte).
//
// TOKENS (ratios WCAG sur le fond #100e0c)
//   --bg      #100e0c            fond
//   --raise   #1a1815            fond des feuilles basses (texte : ratios ≥ 5,2:1 sauf --dim)
//   --ink     #f4f0e7  16,9:1    texte principal, bouton principal plein
//   --muted   #b5b0a9   8,9:1    libellés secondaires, ▼ en deçà
//   --faint   #8f8c85   5,7:1    méta discrète (texte ≥ 13 px)
//   --dim     #6b6761   3,4:1    repères non textuels (graduations), texte ≥ 24 px seulement
//   --line    #3a3733   1,6:1    filets décoratifs, jamais porteurs de sens seuls
//   --on-ink  #4a463f   8,3:1    texte secondaire posé SUR le bouton blanc cassé
//   --sig     réglable  ≥ 9,3:1  signal (voir plus haut). Lire : `var(--sig)`,
//                                en Tailwind `text-(--sig)` / `bg-(--sig)`. Prédéfinies
//                                9,3 à 13,0:1 ; teinte libre ≥ 9,1:1 (≥ 8,4:1 sur --raise).
//   --r       6px                rayon des blocs (boutons, carrés de couleur)
//   --r-sheet 10px               rayon haut des feuilles basses
//   --gutter  20px               marge latérale d'écran (px-5)
//   --pad-bottom 64px            dégagement sous la barre d'action (indicateur
//                                d'accueil iOS + barre de bascule du prototype)
// Typo : Inter, chiffres tabulaires. Échelle : 80 (poids) · 32 (titre
// d'instrument) · 28 (titre d'écran) · 22 (chiffres clés) · 18 (bouton) ·
// 17 (titre de section) · 16 (corps) · 14 (méta) · 13 (plus petit autorisé).
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { range, type Verdict } from './format';
import { Chevron } from './icons';

/* ------------------------------------------------------------------------ */
/* Tokens                                                                     */
/* ------------------------------------------------------------------------ */

export const SIG_DEFAULT = '#f6d236';

export const TOKENS = {
  '--bg': '#100e0c',
  '--raise': '#1a1815',
  '--ink': '#f4f0e7',
  '--muted': '#b5b0a9',
  '--faint': '#8f8c85',
  '--dim': '#6b6761',
  '--line': '#3a3733',
  '--on-ink': '#4a463f',
  '--r': '6px',
  '--r-sheet': '10px',
  '--gutter': '20px',
  '--pad-bottom': '64px',
  // Le contour de focus global (index.css) lit --color-accent : blanc cassé ici.
  '--color-accent': '#f4f0e7',
} as const;

export const FONT = '"Inter Variable", system-ui, sans-serif';

/** Style de la racine : tokens + signal courant + police. */
export function rootStyle(sig: string): CSSProperties {
  return {
    ...(TOKENS as unknown as CSSProperties),
    ['--sig' as string]: sig,
    fontFamily: FONT,
    fontVariantNumeric: 'tabular-nums',
  } as CSSProperties;
}

/** Règles globales du socle, posées une fois par le shell.
 *
 *  MOUVEMENT (rares, courts, interruptibles : des transitions, jamais de keyframes)
 *  - `e-press` : un bouton s'enfonce sous le doigt, scale(0.97) en 140 ms ease-out.
 *    Jamais sur les gestes répétés des centaines de fois en salle (logger, règle,
 *    rangées de numéros) : là, le retour est instantané (changement de fond).
 *  - `e-sheet` / `e-veil` : la feuille monte du bas en 240 ms (courbe de tiroir
 *    iOS), le voile apparaît en fondu. Entrée par `@starting-style`. Sortie plus
 *    courte (150 ms, ease-out) : voir `playSheetExit`, sur un fantôme inerte.
 *  - Règle de poids : saut sec au toucher par défaut ; glissé de 190 ms si
 *    `animateTap` (commande du prototype « Règle animée au toucher »).
 *  - `data-motion="reduite"` (réglage « Réduire les animations », initialisé sur
 *    prefers-reduced-motion) : plus aucun déplacement ni changement d'échelle ;
 *    restent les fondus d'opacité et de couleur, qui aident à comprendre. */
export const BASE_CSS = `
.e-press { transition: transform 140ms cubic-bezier(0.23, 1, 0.32, 1); }
.e-press:active:not(:disabled) { transform: scale(0.97); }
.e-veil { opacity: 1; transition: opacity 200ms ease-out; }
.e-sheet { transform: translateY(0); transition: transform 240ms cubic-bezier(0.32, 0.72, 0, 1), opacity 240ms ease-out; }
@starting-style {
  .e-veil { opacity: 0; }
  .e-sheet { transform: translateY(100%); }
}
[data-e-root][data-motion="reduite"] *, [data-e-root][data-motion="reduite"] *::before {
  animation: none !important;
  transition-property: opacity, color, background-color, border-color !important;
}
[data-e-root][data-motion="reduite"] .e-press:active { transform: none; }
@starting-style {
  [data-e-root][data-motion="reduite"] .e-sheet { transform: none; opacity: 0; }
}
`;

/* ------------------------------------------------------------------------ */
/* Statut ▲ ▬ ▼                                                               */
/* ------------------------------------------------------------------------ */

/** Seul « mieux » prend le signal. Égal reste blanc cassé, en deçà gris. */
export const TONE: Record<Verdict, string> = {
  up: 'text-(--sig)',
  eq: 'text-(--ink)',
  down: 'text-(--muted)',
};

/** ▲ ▬ ▼ dessinés en SVG (les glyphes varient d'une police à l'autre). */
export function Sign({ v, size = 11 }: { v: Verdict; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden fill="currentColor" className="inline-block flex-none">
      {v === 'up' && <path d="M6 1.5 11 10.5H1z" />}
      {v === 'eq' && <rect x="0.5" y="3.5" width="11" height="5" />}
      {v === 'down' && <path d="M6 10.5 1 1.5h10z" />}
    </svg>
  );
}

/** Signe + mot, dans la bonne teinte : `<Status v="up" word="battue" />`. */
export function Status({ v, word, size = 11, className = '' }: { v: Verdict; word: string; size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 ${TONE[v]} ${className}`}>
      <Sign v={v} size={size} />
      {word}
    </span>
  );
}

/* ------------------------------------------------------------------------ */
/* Boutons et liens                                                           */
/* ------------------------------------------------------------------------ */

/** Bouton principal : bloc blanc cassé plein, 56 px. Un seul par écran, en bas.
 *  `meta` s'affiche à droite en gris foncé (ex. « 82,5 × 8 »). */
export function PrimaryButton({
  children,
  over,
  meta,
  onClick,
  disabled,
  ariaLabel,
  press = true,
  className = '',
}: {
  children: ReactNode;
  /** Petite ligne au-dessus du libellé (« Exo suivant » au-dessus du nom). */
  over?: ReactNode;
  meta?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  ariaLabel?: string;
  /** false : pas d'enfoncement (geste répété en salle, ex. logger). */
  press?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={`flex h-14 min-w-0 flex-auto items-center justify-between gap-3 rounded-(--r) bg-(--ink) px-4 text-left text-(--bg) active:bg-(--muted) disabled:bg-(--line) disabled:text-(--muted) ${press ? 'e-press' : ''} ${className}`}
    >
      <span className="flex min-w-0 flex-col">
        {over && <span className="truncate text-[13px] font-medium leading-tight text-(--on-ink)">{over}</span>}
        <span className={`truncate font-semibold tracking-[-0.01em] ${over ? 'text-[17px] leading-tight' : 'text-[18px]'}`}>{children}</span>
      </span>
      {meta && <span className="flex-none text-[15px] font-medium text-(--on-ink)">{meta}</span>}
    </button>
  );
}

/** Bouton secondaire : contour blanc cassé franc (1,5 px) sur un aplat à peine
 *  levé, libellé centré en demi-gras. Il ne doit jamais se lire comme un champ
 *  de saisie (contour gris fin, texte à gauche). `size="sm"` : 44 px, pour une
 *  action d'en-tête ou posée dans une ligne. Avec `meta`, libellé à gauche. */
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
      className={`flex min-w-0 items-center gap-3 rounded-(--r) border-[1.5px] border-(--ink) bg-(--raise) text-(--ink) active:bg-(--line) disabled:border-(--line) disabled:bg-transparent disabled:text-(--faint) ${
        size === 'sm' ? 'h-11 px-3.5' : 'h-12 px-4'
      } ${meta ? 'justify-between' : 'justify-center'} ${press ? 'e-press' : ''} ${className}`}
    >
      <span className={`truncate font-semibold ${size === 'sm' ? 'text-[15px]' : 'text-[16px]'}`}>{children}</span>
      {meta && <span className="flex-none text-[14px] text-(--muted)">{meta}</span>}
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
      className={`inline-flex min-h-11 items-center text-[16px] underline decoration-1 underline-offset-4 ${
        tone === 'ink' ? 'text-(--ink)' : 'text-(--muted) active:text-(--ink)'
      } ${className}`}
    >
      {children}
    </button>
  );
}

/** Chevron de navigation : vit dans e/icons.tsx (source unique), réexporté ici. */
export { Chevron };

/* ------------------------------------------------------------------------ */
/* Mise en page d'écran                                                       */
/* ------------------------------------------------------------------------ */

/** Écran : contenu qui défile + barre d'action collée en bas (`bottom`). */
export function Screen({ children, bottom }: { children: ReactNode; bottom?: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex-1">{children}</div>
      {bottom && <BottomBar>{bottom}</BottomBar>}
    </div>
  );
}

/** Barre d'action collée en bas, fond plein (jamais de flou). */
export function BottomBar({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-0 z-10 mt-3 flex flex-col gap-2 bg-(--bg) px-5 pb-(--pad-bottom) pt-2">{children}</div>
  );
}

/** En-tête d'écran. `back` : retour vers la page parente, nommée (« ‹ Séance »).
 *  `action` : un lien à droite. `meta` : une ligne sous le titre. */
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
              className="inline-flex h-11 items-center gap-2 pl-1 pr-3 text-[16px] text-(--muted) active:text-(--ink)"
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
      <h1 className="text-[28px] font-[650] leading-[1.15] tracking-[-0.025em] text-(--ink)">{title}</h1>
      {meta && <p className="mt-1 text-[15px] text-(--muted)">{meta}</p>}
    </header>
  );
}

/** Titre de section : phrase en casse normale, jamais de surtitre en majuscules. */
export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between px-5 pb-2 pt-6">
      <h2 className="text-[17px] font-semibold text-(--ink)">{children}</h2>
      {aside && <span className="text-[14px] text-(--muted)">{aside}</span>}
    </div>
  );
}

/** Filet horizontal. `inset` : aligné sur la marge d'écran. */
export function Rule({ inset = true, strong = false }: { inset?: boolean; strong?: boolean }) {
  return <hr className={`border-0 ${strong ? 'h-[2px] bg-(--muted)' : 'h-px bg-(--line)'} ${inset ? 'mx-5' : ''}`} />;
}

/** Ligne de liste : titre, méta dessous, valeur à droite, chevron si `onClick`.
 *  `trailing` : une action à part (lien « Remplacer »), hors de la zone touchable
 *  de la ligne (jamais de bouton dans un bouton). `lead` : colonne de gauche
 *  étroite (rang, numéro). */
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
      {lead !== undefined && <span className="w-6 flex-none pt-px text-[15px] text-(--faint)">{lead}</span>}
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-[17px] ${muted ? 'text-(--muted)' : 'text-(--ink)'} ${current ? 'font-semibold' : 'font-medium'}`}>
          {title}
        </span>
        {meta && <span className="mt-0.5 block text-[14px] text-(--muted)">{meta}</span>}
      </span>
      {(value !== undefined || valueMeta !== undefined) && (
        <span className="flex-none text-right">
          {value !== undefined && <span className="block text-[17px] font-medium text-(--ink)">{value}</span>}
          {valueMeta && <span className="mt-0.5 block text-[14px] text-(--muted)">{valueMeta}</span>}
        </span>
      )}
      {onClick && (
        <span className="flex-none self-center text-(--faint)">
          <Chevron />
        </span>
      )}
    </>
  );
  const cls = 'flex min-h-14 min-w-0 flex-1 items-start gap-3 py-3 text-left';
  return (
    <li className="relative flex items-center gap-3 border-b border-(--line) px-5">
      {current && <span aria-hidden className="absolute bottom-3 left-0 top-3 w-[3px] bg-(--ink)" />}
      {onClick ? (
        <button type="button" onClick={onClick} aria-label={ariaLabel} aria-current={current ? 'true' : undefined} className={`${cls} active:opacity-70`}>
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
    <ul aria-label={label} className="border-t border-(--line)">
      {children}
    </ul>
  );
}

/** État vide : une phrase qui dit ce qui manque et, si possible, l'action. */
export function EmptyState({ title, body, action }: { title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="px-5 py-10">
      <p className="text-[17px] font-medium text-(--ink)">{title}</p>
      {body && <p className="mt-1.5 max-w-[34ch] text-[15px] leading-[1.45] text-(--muted)">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Bandeau de synchro, une seule ligne (il ne doit pas pousser l'instrument).
 *  Rien quand tout est envoyé : on ne rassure pas pour rien. Hors ligne, les
 *  saisies restent sur l'appareil, ce n'est pas une erreur. */
export function SyncBanner({ pending, offline }: { pending: number; offline: boolean }) {
  if (pending === 0 && !offline) return null;
  const n = `${pending} saisie${pending > 1 ? 's' : ''}`;
  return (
    <div role="status" className="flex items-baseline gap-2 whitespace-nowrap border-y border-(--line) px-5 py-2 text-[14px]">
      <span className="flex-none font-semibold text-(--ink)">{offline ? 'Hors ligne' : 'Envoi en cours'}</span>
      <span className="min-w-0 truncate text-(--muted)">
        {pending === 0 ? 'les saisies restent sur cet appareil' : offline ? `${n} sur l'appareil, envoi au retour` : `${n} en attente`}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Feuille basse                                                              */
/* ------------------------------------------------------------------------ */

/** Emplacement des feuilles, fourni par le shell (enfant direct de la racine,
 *  `sticky bottom-0`) : les feuilles héritent des tokens et de `--sig`. */
export const SheetSlotContext = createContext<HTMLElement | null>(null);

/** Sortie d'une feuille : 150 ms, ease-out, plus courte que l'entrée (240 ms).
 *  Elle se joue sur un FANTÔME : une copie inerte du voile et du panneau, posée
 *  dans l'emplacement au moment où la vraie feuille est démontée. Le démontage
 *  React reste immédiat et identique, quelle que soit la façon de fermer (open
 *  à false, `key` qui change, montage conditionnel autour de la feuille) : le
 *  focus, les écouteurs et le DOM réel ne changent pas. Le fantôme n'a ni rôle,
 *  ni id, ni focus (aria-hidden + inert) et se retire par minuteur. Réduire les
 *  animations : fondu seul, sans déplacement. */
function playSheetExit(slot: HTMLElement, veil: HTMLElement, panel: HTMLElement, scrollTop: number) {
  const reduce = slot.closest('[data-e-root]')?.getAttribute('data-motion') === 'reduite';
  const ghosts = [veil, panel].map((node) => {
    const g = node.cloneNode(true) as HTMLElement;
    // Sans ces classes : pas d'entrée @starting-style ni de transition sur la copie.
    g.classList.remove('e-veil', 'e-sheet');
    for (const a of ['role', 'aria-modal', 'aria-labelledby']) g.removeAttribute(a);
    g.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
    g.setAttribute('aria-hidden', 'true');
    g.inert = true;
    g.style.pointerEvents = 'none';
    return g;
  });
  const [gVeil, gPanel] = ghosts as [HTMLElement, HTMLElement];
  // En tête de l'emplacement : une feuille qui s'ouvre aussitôt passe dessus.
  slot.prepend(gVeil, gPanel);
  const scroller = gPanel.querySelector<HTMLElement>('[data-sheet-scroll]');
  if (scroller) scroller.scrollTop = scrollTop;
  const timing: KeyframeAnimationOptions = { duration: 150, easing: 'cubic-bezier(0.23, 1, 0.32, 1)', fill: 'forwards' };
  gVeil.animate([{ opacity: 1 }, { opacity: 0 }], timing);
  gPanel.animate(reduce ? [{ opacity: 1 }, { opacity: 0 }] : [{ transform: 'translateY(0)' }, { transform: 'translateY(100%)' }], timing);
  window.setTimeout(() => {
    gVeil.remove();
    gPanel.remove();
  }, 170);
}

/** Feuille basse : voile plein (pas de flou) + panneau collé en bas, qui défile
 *  s'il est long. Fermeture : « Fermer », toucher le voile, Échap. Entrée en
 *  240 ms (CSS), sortie en 150 ms (`playSheetExit`). */
export function Sheet({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Barre d'action du bas de la feuille (bouton principal). */
  footer?: ReactNode;
}) {
  const slot = useContext(SheetSlotContext);
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const veilRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollTop = useRef(0);
  const shown = open && !!slot;
  useEffect(() => {
    if (!open) return;
    heading.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  useLayoutEffect(() => {
    const veil = veilRef.current;
    const panel = panelRef.current;
    if (!shown || !slot || !veil || !panel) return;
    scrollTop.current = 0;
    return () => {
      // Après le commit : si le panneau est encore dans le document, ce n'était
      // pas une fermeture (double montage du mode strict), rien à jouer.
      queueMicrotask(() => {
        if (!panel.isConnected) playSheetExit(slot, veil, panel, scrollTop.current);
      });
    };
  }, [shown, slot]);
  if (!shown) return null;
  return createPortal(
    <>
      <div
        ref={veilRef}
        aria-hidden
        onClick={onClose}
        className="e-veil absolute inset-x-0 bottom-0 h-[100dvh] bg-black/65"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        className="e-sheet absolute inset-x-0 bottom-0 flex max-h-[min(80dvh,720px)] flex-col rounded-t-(--r-sheet) border-t border-(--line) bg-(--raise)"
      >
        <div className="flex flex-none items-center justify-between gap-3 py-2 pl-5 pr-3">
          <h2 ref={heading} id={id} tabIndex={-1} className="min-w-0 truncate text-[17px] font-semibold text-(--ink) outline-none">
            {title}
          </h2>
          <TextLink tone="muted" onClick={onClose} className="px-2">
            Fermer
          </TextLink>
        </div>
        <div
          data-sheet-scroll
          onScroll={(e) => {
            scrollTop.current = e.currentTarget.scrollTop;
          }}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        >
          {children}
        </div>
        {footer && <div className="flex flex-none flex-col gap-2 px-5 pb-(--pad-bottom) pt-3">{footer}</div>}
        {!footer && <div className="h-(--pad-bottom) flex-none" />}
      </div>
    </>,
    slot,
  );
}

/* ------------------------------------------------------------------------ */
/* Contrôles sans clavier                                                     */
/* ------------------------------------------------------------------------ */

/** Interrupteur. Activé = blanc cassé plein + mot « Oui » (jamais le signal). */
export function Switch({
  label,
  meta,
  checked,
  onChange,
}: {
  label: string;
  meta?: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex min-h-14 w-full items-center gap-4 border-b border-(--line) px-5 py-3 text-left"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[17px] font-medium text-(--ink)">{label}</span>
        {meta && <span className="mt-0.5 block text-[14px] text-(--muted)">{meta}</span>}
      </span>
      <span aria-hidden className="w-8 text-right text-[14px] text-(--muted)">
        {checked ? 'Oui' : 'Non'}
      </span>
      <span
        aria-hidden
        className={`relative h-7 w-12 flex-none rounded-(--r) border ${checked ? 'border-(--ink) bg-(--ink)' : 'border-(--muted)'}`}
      >
        <span
          className={`absolute left-[3px] top-[3px] h-5 w-5 rounded-[3px] transition-transform duration-150 ease-out ${
            checked ? 'translate-x-5 bg-(--bg)' : 'bg-(--muted)'
          }`}
        />
      </span>
    </button>
  );
}

/** Stepper pour les formulaires hors salle (prescription, réglages) : − valeur +,
 *  carrés de 48 px, aucune saisie clavier. Sans `meta`, il tient sur une ligne :
 *  libellé à gauche, stepper à droite, valeur jamais coupée. */
export function Stepper({
  label,
  value,
  onChange,
  min = 0,
  max = 999,
  step = 1,
  format = String,
  meta,
  valueWidth,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  format?: (v: number) => string;
  meta?: ReactNode;
  /** Largeur fixe de la valeur (px) quand elle varie (« 1 kg », « 1,25 kg ») :
   *  les boutons ne bougent pas sous le pouce d'un tap à l'autre. */
  valueWidth?: number;
}) {
  const set = (v: number) => onChange(Math.min(max, Math.max(min, Math.round(v * 1000) / 1000)));
  const btn =
    'flex h-12 w-12 flex-none items-center justify-center rounded-(--r) border border-(--muted) text-[22px] text-(--ink) active:bg-(--line) disabled:border-(--line) disabled:text-(--dim)';
  return (
    <div className="flex min-h-16 items-center gap-3 border-b border-(--line) px-5 py-2">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[17px] font-medium text-(--ink)">{label}</span>
        {meta && <span className="mt-0.5 block text-[14px] text-(--muted)">{meta}</span>}
      </span>
      <button type="button" className={btn} aria-label={`${label} moins`} disabled={value <= min} onClick={() => set(value - step)}>
        −
      </button>
      <output aria-live="polite" className="min-w-14 whitespace-nowrap text-center text-[20px] font-medium text-(--ink)" style={valueWidth ? { width: valueWidth } : undefined}>
        {format(value)}
      </output>
      <button type="button" className={btn} aria-label={`${label} plus`} disabled={value >= max} onClick={() => set(value + step)}>
        +
      </button>
    </div>
  );
}

/** Choix exclusif en mots soulignés (pas de pilules) : « 1,25 kg · 2,5 kg ». */
export function Choice<T extends string | number>({
  label,
  options,
  value,
  onChange,
  wrap = true,
  className = '',
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  /** false : une seule ligne (à placer dans un conteneur qui défile). */
  wrap?: boolean;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={`flex gap-x-1 ${wrap ? 'flex-wrap' : 'flex-nowrap whitespace-nowrap'} ${className}`}>
      {options.map((o) => {
        const sel = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={sel}
            onClick={() => onChange(o.value)}
            className={`h-11 flex-none px-2.5 text-[16px] ${
              sel ? 'font-semibold text-(--ink) underline decoration-2 underline-offset-[7px]' : 'text-(--muted) active:text-(--ink)'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Règle graduée (générique)                                                  */
/* ------------------------------------------------------------------------ */

/** Règle graduée au pouce : c'est la règle qui glisse sous une aiguille fixe.
 *  Toucher sans glisser va au cran touché ; ← → au clavier. La valeur est un
 *  index de cran entier (`steps`), à l'appelant de le convertir.
 *  Poids : `<Ruler steps={kg / 1.25} max={400} label="Poids" format={(s) => fmtKg(s * 1.25) + ' kg'} />`.
 *
 *  Les graduations vivent sur une PISTE translatée en `transform` (la graduation
 *  v est à v × pxPerStep du centre de la piste). Le glissé suit le doigt sans
 *  transition. Au toucher, la piste saute au cran ; avec `animateTap`, elle y
 *  glisse en 190 ms (ease-out fort), et un nouveau toucher ou un glissé repart
 *  de la position affichée (interruptible). Ni le clavier ni un changement venu
 *  de l'extérieur (autre exo) n'animent. Réduire les animations : la règle
 *  globale de BASE_CSS retire `transform` des transitions. */
export function Ruler({
  steps,
  onChange,
  max,
  label,
  format,
  pxPerStep = 14,
  isMajor = (v) => v % 4 === 0,
  isMid = (v) => v % 2 === 0,
  majorLabel,
  tickColor,
  needle = 'var(--sig)',
  height = 62,
  animateTap = false,
}: {
  steps: number;
  onChange: (s: number) => void;
  max: number;
  label: string;
  /** Texte lu par les lecteurs d'écran pour un cran. */
  format: (s: number) => string;
  pxPerStep?: number;
  isMajor?: (s: number) => boolean;
  isMid?: (s: number) => boolean;
  /** Étiquette sous une graduation majeure (rien si absent). */
  majorLabel?: (s: number) => string;
  /** Couleur propre à chaque graduation (règle des teintes) : aplats, pas de dégradé. */
  tickColor?: (s: number) => string;
  /** Couleur de l'aiguille : le signal, sauf quand la règle porte elle-même des couleurs. */
  needle?: string;
  height?: number;
  /** Le toucher fait glisser la règle jusqu'au cran (190 ms) au lieu d'y sauter. */
  animateTap?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ x: number; start: number; moved: boolean; last: number } | null>(null);
  const animTimer = useRef(0);
  const [drag, setDrag] = useState<number | null>(null);
  const [tapAnim, setTapAnim] = useState(false);
  const [half, setHalf] = useState(14);
  const value = drag ?? steps;
  const clamp = (v: number) => Math.min(max, Math.max(0, v));
  useLayoutEffect(() => {
    // Assez de graduations pour couvrir la largeur, sans en dessiner hors champ.
    const w = box.current?.clientWidth ?? 390;
    setHalf(Math.ceil(w / 2 / pxPerStep) - 1);
  }, [pxPerStep]);
  useEffect(() => () => window.clearTimeout(animTimer.current), []);

  /** Valeur affichée sous l'aiguille, même en plein glissé animé. */
  const shownValue = () => {
    const el = track.current;
    if (!tapAnim || !el) return value;
    const t = getComputedStyle(el).transform;
    return t && t !== 'none' ? -new DOMMatrixReadOnly(t).m41 / pxPerStep : value;
  };
  const stopAnim = () => {
    window.clearTimeout(animTimer.current);
    setTapAnim(false);
  };

  // Fenêtre doublée : pendant le glissé animé (un toucher va jusqu'à une
  // demi-largeur), le départ et l'arrivée restent garnis.
  const base = Math.round(value);
  const reach = 2 * half + 2;
  const ticks: number[] = [];
  for (let k = -reach; k <= reach; k++) if (base + k >= 0 && base + k <= max) ticks.push(base + k);

  return (
    <div
      ref={box}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={steps}
      aria-valuetext={format(steps)}
      data-ruler={label}
      className="relative cursor-grab touch-none select-none overflow-hidden border-t border-(--line) outline-offset-4 active:cursor-grabbing"
      style={{ height }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          // La barre de bascule du prototype écoute ← → sur window.
          e.stopPropagation();
          stopAnim();
          onChange(clamp(steps + (e.key === 'ArrowRight' ? 1 : -1)));
        }
      }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        // Interrompre un glissé animé : on repart de ce qui est affiché.
        const from = shownValue();
        if (tapAnim) {
          stopAnim();
          setDrag(from);
        }
        gesture.current = { x: e.clientX, start: from, moved: false, last: from };
      }}
      onPointerMove={(e) => {
        const g = gesture.current;
        if (!g) return;
        const dx = e.clientX - g.x;
        if (!g.moved && Math.abs(dx) < 4) return;
        g.moved = true;
        const v = clamp(g.start - dx / pxPerStep);
        g.last = v;
        setDrag(v);
        const snapped = Math.round(v);
        if (snapped !== steps) onChange(snapped);
      }}
      onPointerUp={(e) => {
        const g = gesture.current;
        gesture.current = null;
        if (!g) return;
        if (!g.moved) {
          const r = box.current!.getBoundingClientRect();
          const target = clamp(Math.round(g.start + (e.clientX - (r.left + r.width / 2)) / pxPerStep));
          if (animateTap && target !== g.start) {
            window.clearTimeout(animTimer.current);
            setTapAnim(true);
            animTimer.current = window.setTimeout(() => setTapAnim(false), 230);
          }
          onChange(target);
        } else {
          onChange(Math.round(g.last));
        }
        setDrag(null);
      }}
      onPointerCancel={() => {
        gesture.current = null;
        setDrag(null);
      }}
    >
      <div
        ref={track}
        aria-hidden
        className="absolute inset-0"
        style={{
          transform: `translate3d(${-value * pxPerStep}px, 0, 0)`,
          // Sans `animateTap`, aucune transition : la règle sert des centaines de
          // fois par séance, elle suit le doigt et saute au cran touché.
          transition: tapAnim ? 'transform 190ms cubic-bezier(0.23, 1, 0.32, 1)' : 'none',
        }}
      >
        {ticks.map((v) => {
          const major = isMajor(v);
          const mid = isMid(v);
          const color = tickColor?.(v);
          return (
            <div
              key={v}
              className="absolute top-0 flex flex-col items-center"
              style={{ left: `calc(50% + ${v * pxPerStep}px)`, transform: 'translateX(-50%)' }}
            >
              <div
                className={color ? '' : major ? 'bg-(--muted)' : 'bg-(--dim)'}
                style={{
                  width: color ? Math.max(2, pxPerStep - 2) : major ? 2 : 1,
                  height: major ? 30 : mid ? 18 : 11,
                  background: color,
                }}
              />
              {major && majorLabel && <span className="mt-2 whitespace-nowrap text-[13px] text-(--faint)">{majorLabel(v)}</span>}
            </div>
          );
        })}
      </div>
      {/* L'aiguille, fixe au centre ; elle s'arrête au-dessus des étiquettes. */}
      <div
        className="pointer-events-none absolute left-1/2 top-0 h-[36px] w-[3px] -translate-x-1/2"
        style={{ background: needle }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Rangée de numéros (reps, RIR)                                              */
/* ------------------------------------------------------------------------ */


/** Rangée de numéros touchables, de `min` à `max` (reps 1-50, RIR 0-10 : voir
 *  REPS_MIN… dans format.ts). Un tap = une valeur ; la fourchette du plan est
 *  soulignée d'un filet, la valeur choisie d'un trait épais, la Référence d'un
 *  petit carré (« réf. » à l'écran).
 *
 *  DÉFILEMENT. La rangée court d'un bord de l'écran à l'autre et défile au pouce
 *  (défilement natif, accroché au chiffre centré). Une case vaut 1/8 de la
 *  largeur : 7 chiffres entiers au centre et un demi-chiffre coupé net à chaque
 *  bord tant qu'il reste des valeurs de ce côté (l'indice « ça continue », sans
 *  dégradé ni chevron). Au bout de la plage, la marge d'écran revient : plus de
 *  coupe, plus rien à chercher. À la souris (prototype sur ordinateur), on la
 *  glisse comme la règle ; un glissé ne choisit rien.
 *
 *  RECADRAGE, toujours instantané (aucune animation : geste répété des centaines
 *  de fois). Au montage, la rangée se cale sur la fourchette du plan et la valeur
 *  courante si elles tiennent ensemble, sinon sur la valeur. Ensuite elle ne
 *  bouge plus d'elle-même, sauf si la valeur choisie change d'ailleurs (log,
 *  annulation, clavier) et sort du champ. Un tap ne déplace jamais les chiffres
 *  sous le doigt. L'appelant remonte la rangée (`key`) à chaque exo ou série
 *  pour qu'elle reparte calée.
 *
 *  Clavier : un seul arrêt de tabulation (la valeur choisie), ← → Début Fin. */
export function NumberRow({
  label,
  min,
  max,
  value,
  presc,
  refValue,
  onPick,
}: {
  label: string;
  min: number;
  max: number;
  value: number;
  presc: [number, number];
  refValue: number | null;
  onPick: (n: number) => void;
}) {
  const row = useRef<HTMLDivElement>(null);
  const values = range0(min, max);
  /** La dernière valeur vient d'un tap dans cette rangée : ne rien recadrer. */
  const pickedHere = useRef(false);
  const focusSel = useRef(false);
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  const swallowClick = useRef(false);

  const cellOf = (n: number) => row.current?.querySelector<HTMLElement>(`[data-n="${n}"]`) ?? null;
  const centerOn = (n: number) => {
    const el = row.current;
    const c = cellOf(n);
    if (!el || !c) return;
    el.scrollLeft = c.offsetLeft + c.offsetWidth / 2 - el.clientWidth / 2;
  };
  const fullyVisible = (n: number) => {
    const el = row.current;
    const c = cellOf(n);
    if (!el || !c) return true;
    return c.offsetLeft >= el.scrollLeft - 1 && c.offsetLeft + c.offsetWidth <= el.scrollLeft + el.clientWidth + 1;
  };

  useLayoutEffect(() => {
    // Calage d'ouverture : plan + valeur s'ils tiennent dans les 7 cases entières.
    const a = Math.max(min, Math.min(presc[0], value));
    const b = Math.min(max, Math.max(presc[1], value));
    centerOn(b - a + 1 <= 7 ? Math.round((a + b) / 2) : value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    if (focusSel.current) {
      focusSel.current = false;
      cellOf(value)?.focus({ preventScroll: true });
    }
    if (pickedHere.current) {
      pickedHere.current = false;
      return;
    }
    if (!fullyVisible(value)) centerOn(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const pickKey = (n: number) => {
    const v = Math.min(max, Math.max(min, n));
    if (v === value) return;
    focusSel.current = true;
    onPick(v);
  };

  return (
    <div>
      <div className="flex items-baseline justify-between px-5">
        <span className="text-[15px] font-semibold text-(--ink)">{label}</span>
        <span className="text-[14px] text-(--muted)">
          plan {range(presc)}
          {refValue !== null && <span> · réf. {refValue}</span>}
        </span>
      </div>
      <div
        ref={row}
        data-number-row={label}
        className="relative mt-0.5 flex overflow-x-auto px-5"
        style={{ scrollbarWidth: 'none', scrollSnapType: 'x mandatory', scrollBehavior: 'auto', overscrollBehaviorX: 'contain' }}
        role="radiogroup"
        aria-label={label}
        onKeyDown={(e) => {
          const k = e.key;
          if (k !== 'ArrowLeft' && k !== 'ArrowRight' && k !== 'Home' && k !== 'End') return;
          e.preventDefault();
          // La barre de bascule du prototype écoute ← → sur window.
          e.stopPropagation();
          pickKey(k === 'Home' ? min : k === 'End' ? max : value + (k === 'ArrowRight' ? 1 : -1));
        }}
        onPointerDown={(e) => {
          if (e.pointerType !== 'mouse' || e.button !== 0) return;
          drag.current = { x: e.clientX, left: e.currentTarget.scrollLeft, moved: false };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.x;
          if (!d.moved) {
            if (Math.abs(dx) < 5) return;
            d.moved = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            e.currentTarget.style.scrollSnapType = 'none';
          }
          e.currentTarget.scrollLeft = d.left - dx;
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          if (!d?.moved) return;
          // Accroche au chiffre le plus proche du centre, sans glisser.
          const el = e.currentTarget;
          const mid = el.scrollLeft + el.clientWidth / 2;
          let best = values[0]!;
          let gap = Infinity;
          for (const n of values) {
            const c = cellOf(n);
            if (!c) continue;
            const g = Math.abs(c.offsetLeft + c.offsetWidth / 2 - mid);
            if (g < gap) {
              gap = g;
              best = n;
            }
          }
          centerOn(best);
          el.style.scrollSnapType = 'x mandatory';
          swallowClick.current = true;
          window.setTimeout(() => (swallowClick.current = false), 0);
        }}
        onPointerCancel={(e) => {
          drag.current = null;
          e.currentTarget.style.scrollSnapType = 'x mandatory';
        }}
        onClickCapture={(e) => {
          if (!swallowClick.current) return;
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        {values.map((n) => {
          const sel = n === value;
          const inPlan = n >= presc[0] && n <= presc[1];
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={sel}
              tabIndex={sel ? 0 : -1}
              data-n={n}
              onClick={() => {
                if (n === value) return;
                pickedHere.current = true;
                onPick(n);
              }}
              className="relative h-12 flex-none select-none"
              // 1/8 de la largeur de la rangée (le pourcentage se lit sur la boîte
              // de contenu, marges d'écran de 20 px déduites).
              style={{ flexBasis: 'calc((100% + 40px) / 8)', minWidth: 44, scrollSnapAlign: 'center' }}
            >
              <span
                className={`flex h-full items-center justify-center text-[23px] tracking-[-0.01em] ${
                  sel ? 'font-bold text-(--ink)' : inPlan ? 'text-(--ink)' : 'text-(--faint)'
                }`}
              >
                {n}
              </span>
              {inPlan && <span className="absolute inset-x-0 bottom-0 h-px bg-(--dim)" />}
              {sel && <span className="absolute inset-x-2 bottom-0 h-[4px] bg-(--ink)" />}
              {refValue === n && <span className="absolute left-1/2 top-1 h-[5px] w-[5px] -translate-x-1/2 bg-(--muted)" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function range0(a: number, b: number): number[] {
  return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}
