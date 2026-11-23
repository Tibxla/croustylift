// PROTOTYPE JETABLE · socle E « Signal » : tokens et primitives de toute l'app.
//
// RÈGLES DU STYLE (à relire avant d'ajouter quoi que ce soit)
// ---------------------------------------------------------------------------
// Fond noir chaud, texte blanc cassé, gris chauds. UNE seule couleur, le
// signal `--sig` (jaune par défaut, réglable dans Réglages). Il est réservé à
// deux sens et à rien d'autre :
//   1. l'aiguille de la règle (« c'est ici que tu es ») ;
//   2. le ▲ « mieux que la dernière fois » (série battue, record, pente en hausse).
// Le signal n'est jamais un fond, jamais un bouton, jamais un lien, jamais un
// interrupteur activé, jamais une sélection. Il ne touche jamais le blanc
// cassé (1,3:1). Égalé reste blanc cassé (▬), en deçà reste gris (▼) : un
// statut = couleur + signe + mot, jamais la couleur seule.
//
// Hiérarchie : taille et graisse d'Inter, chiffres tabulaires. L'action
// principale d'un écran est UN bloc blanc cassé plein en bas (zone du pouce).
// Le reste : bouton secondaire à contour, liens soulignés, lignes et filets.
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

/** Règles globales du socle, posées une fois par le shell. `data-motion="reduite"`
 *  coupe toute transition (réglage « Réduire les animations »). */
export const BASE_CSS = `
@keyframes e-sheet-in { from { transform: translateY(24px); opacity: 0 } to { transform: none; opacity: 1 } }
@keyframes e-fade-in { from { opacity: 0 } to { opacity: 1 } }
[data-e-root][data-motion="reduite"] *, [data-e-root][data-motion="reduite"] *::before {
  transition: none !important; animation: none !important;
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
  className = '',
}: {
  children: ReactNode;
  /** Petite ligne au-dessus du libellé (« Exo suivant » au-dessus du nom). */
  over?: ReactNode;
  meta?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={`flex h-14 min-w-0 flex-auto items-center justify-between gap-3 rounded-(--r) bg-(--ink) px-4 text-left text-(--bg) active:bg-(--muted) disabled:bg-(--line) disabled:text-(--muted) ${className}`}
    >
      <span className="flex min-w-0 flex-col">
        {over && <span className="truncate text-[13px] font-medium leading-tight text-(--on-ink)">{over}</span>}
        <span className={`truncate font-semibold tracking-[-0.01em] ${over ? 'text-[17px] leading-tight' : 'text-[18px]'}`}>{children}</span>
      </span>
      {meta && <span className="flex-none text-[15px] font-medium text-(--on-ink)">{meta}</span>}
    </button>
  );
}

/** Bouton secondaire : contour gris, texte blanc cassé, 48 px. */
export function SecondaryButton({
  children,
  meta,
  onClick,
  disabled,
  className = '',
}: {
  children: ReactNode;
  meta?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex h-12 min-w-0 items-center justify-between gap-3 rounded-(--r) border border-(--muted) px-4 text-(--ink) active:bg-(--line) disabled:border-(--line) disabled:text-(--faint) ${className}`}
    >
      <span className="truncate text-[16px] font-medium">{children}</span>
      {meta && <span className="flex-none text-[14px] text-(--muted)">{meta}</span>}
    </button>
  );
}

/** Lien souligné (action tertiaire ou navigation en ligne), cible 44 px. */
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

/** Chevron de navigation, seule « icône » admise : il dit « ça s'ouvre ». */
export function Chevron({ dir = 'right' }: { dir?: 'right' | 'left' }) {
  return (
    <svg width="8" height="14" viewBox="0 0 8 14" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.6" className="flex-none">
      <path d={dir === 'right' ? 'M1.5 1.5 6.5 7l-5 5.5' : 'M6.5 1.5 1.5 7l5 5.5'} />
    </svg>
  );
}

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

/** Feuille basse : voile plein (pas de flou) + panneau collé en bas, qui défile
 *  s'il est long. Fermeture : « Fermer », toucher le voile, Échap. */
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
  useEffect(() => {
    if (!open) return;
    heading.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open || !slot) return null;
  return createPortal(
    <>
      <div
        aria-hidden
        onClick={onClose}
        className="absolute inset-x-0 bottom-0 h-[100dvh] bg-black/65"
        style={{ animation: 'e-fade-in 160ms ease-out' }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        className="absolute inset-x-0 bottom-0 flex max-h-[min(80dvh,720px)] flex-col rounded-t-(--r-sheet) border-t border-(--line) bg-(--raise)"
        style={{ animation: 'e-sheet-in 200ms var(--ease-out-quart)' }}
      >
        <div className="flex flex-none items-center justify-between gap-3 py-2 pl-5 pr-3">
          <h2 ref={heading} id={id} tabIndex={-1} className="min-w-0 truncate text-[17px] font-semibold text-(--ink) outline-none">
            {title}
          </h2>
          <TextLink tone="muted" onClick={onClose} className="px-2">
            Fermer
          </TextLink>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
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
          className={`absolute top-[3px] h-5 w-5 rounded-[3px] transition-[left] duration-150 ${
            checked ? 'left-[23px] bg-(--bg)' : 'left-[3px] bg-(--muted)'
          }`}
        />
      </span>
    </button>
  );
}

/** Stepper pour les formulaires hors salle (prescription, réglages) : − valeur +,
 *  carrés de 48 px, aucune saisie clavier. */
export function Stepper({
  label,
  value,
  onChange,
  min = 0,
  max = 999,
  step = 1,
  format = String,
  meta,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  format?: (v: number) => string;
  meta?: ReactNode;
}) {
  const set = (v: number) => onChange(Math.min(max, Math.max(min, Math.round(v * 1000) / 1000)));
  const btn =
    'flex h-12 w-12 flex-none items-center justify-center rounded-(--r) border border-(--muted) text-[22px] text-(--ink) active:bg-(--line) disabled:border-(--line) disabled:text-(--dim)';
  return (
    <div className="flex min-h-16 items-center gap-3 border-b border-(--line) px-5 py-2">
      <span className="min-w-0 flex-1">
        <span className="block text-[17px] font-medium text-(--ink)">{label}</span>
        {meta && <span className="mt-0.5 block text-[14px] text-(--muted)">{meta}</span>}
      </span>
      <button type="button" className={btn} aria-label={`${label} moins`} disabled={value <= min} onClick={() => set(value - step)}>
        −
      </button>
      <output aria-live="polite" className="w-14 text-center text-[20px] font-medium text-(--ink)">
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
 *  Toucher sans glisser saute au cran touché ; ← → au clavier. La valeur est
 *  un index de cran entier (`steps`), à l'appelant de le convertir.
 *  Poids : `<Ruler steps={kg / 1.25} max={400} label="Poids" format={(s) => fmtKg(s * 1.25) + ' kg'} />`. */
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
}) {
  const box = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ x: number; start: number; moved: boolean; last: number } | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [half, setHalf] = useState(14);
  const value = drag ?? steps;
  const clamp = (v: number) => Math.min(max, Math.max(0, v));
  useLayoutEffect(() => {
    // Assez de graduations pour couvrir la largeur, sans en dessiner hors champ.
    const w = box.current?.clientWidth ?? 390;
    setHalf(Math.ceil(w / 2 / pxPerStep) - 1);
  }, [pxPerStep]);

  const base = Math.round(value);
  const ticks: number[] = [];
  for (let k = -half; k <= half; k++) if (base + k >= 0 && base + k <= max) ticks.push(base + k);

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
          onChange(clamp(steps + (e.key === 'ArrowRight' ? 1 : -1)));
        }
      }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        gesture.current = { x: e.clientX, start: steps, moved: false, last: steps };
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
          onChange(clamp(Math.round(steps + (e.clientX - (r.left + r.width / 2)) / pxPerStep)));
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
      {ticks.map((v) => {
        const major = isMajor(v);
        const mid = isMid(v);
        const off = (v - value) * pxPerStep;
        const color = tickColor?.(v);
        return (
          <div
            key={v}
            className="absolute top-0 flex flex-col items-center"
            style={{
              left: `calc(50% + ${off}px)`,
              transform: 'translateX(-50%)',
              transition: drag === null ? 'left 180ms var(--ease-out-quart)' : 'none',
            }}
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

/** Rangée de numéros touchables : la fourchette du plan est soulignée d'un
 *  filet, la valeur choisie d'un trait épais, la Référence d'un petit carré. */
export function NumberRow({
  label,
  values,
  value,
  presc,
  refValue,
  onPick,
  scrollTo,
  perView,
}: {
  label: string;
  values: number[];
  value: number;
  presc: [number, number];
  refValue: number | null;
  onPick: (n: number) => void;
  /** Première valeur visible à l'ouverture (rangée défilante). */
  scrollTo?: number;
  perView: number;
}) {
  const row = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = row.current;
    if (!el || scrollTo === undefined) return;
    const i = values.indexOf(scrollTo);
    el.scrollLeft = (Math.max(0, i) * el.clientWidth) / perView;
  }, [scrollTo, values, perView]);

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
        className="mx-5 mt-0.5 flex overflow-x-auto"
        style={{ scrollbarWidth: 'none', scrollSnapType: 'x mandatory' }}
        role="radiogroup"
        aria-label={label}
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
              onClick={() => onPick(n)}
              className="relative h-12 flex-none"
              style={{ flexBasis: `${100 / perView}%`, scrollSnapAlign: 'start' }}
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
