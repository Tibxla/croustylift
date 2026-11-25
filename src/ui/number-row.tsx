// Kit E · rangée de numéros touchables (reps, RIR en salle) : un tap, une valeur.
import { useLayoutEffect, useRef } from 'react';

/** « ligne » : une case fait 44 px au moins (cible tactile). */
const CELL_MIN = 44;
/** « ligne » : place gardée à droite pour l'aperçu de la case suivante. */
const PEEK_MIN = 20;
/** « ligne » : largeur du fondu de bord, prise dans l'aperçu (20 px au moins), jamais sur une case entière. */
const FADE = 10;
/** Masque du fondu de bord : une transparence, pas un dégradé de couleur. Les
 *  largeurs viennent de `--fade-l` et `--fade-r`, posées au défilement. */
const EDGE_MASK = 'linear-gradient(to right, transparent 0, #000 var(--fade-l, 0px), #000 calc(100% - var(--fade-r, 0px)), transparent 100%)';

/** Rangée de numéros touchables, de `min` à `max` (l'appelant borne la plage : reps
 *  1 à 50, RIR 0 à 10 en salle, élargie si la valeur courante en sort). Un tap = une valeur ; la fourchette du plan est
 *  soulignée d'un filet, la valeur choisie dans une pastille arrondie (`rounded-cell`,
 *  aplat de filet, sous le carré de la Référence qui reste visible), la Référence d'un
 *  petit carré (« réf. » à l'écran).
 *
 *  DÉFILEMENT. La rangée court d'un bord de l'écran à l'autre et défile au pouce
 *  (défilement natif, accroché au chiffre centré). Une case vaut 1/8 de la
 *  largeur : 7 chiffres entiers au centre et un demi-chiffre coupé net à chaque
 *  bord tant qu'il reste des valeurs de ce côté (l'indice « ça continue », sans
 *  dégradé ni chevron). Au bout de la plage, la marge d'écran revient : plus de
 *  coupe, plus rien à chercher. À la souris (ordinateur), on la glisse comme la
 *  règle ; un glissé ne choisit rien.
 *
 *  RECADRAGE, toujours instantané (aucune animation : geste répété des centaines
 *  de fois). Au montage, la rangée se cale sur la fourchette du plan et la valeur
 *  courante si elles tiennent ensemble, sinon sur la valeur. Ensuite elle ne
 *  bouge plus d'elle-même, sauf si la valeur choisie change d'ailleurs (log,
 *  annulation, clavier) et sort du champ. Un tap ne déplace jamais les chiffres
 *  sous le doigt, sauf sur la demi-case d'aperçu de « ligne », qui entre dans
 *  le champ. L'appelant remonte la rangée (`key`) à chaque exo ou série
 *  pour qu'elle reparte calée.
 *
 *  Clavier : un seul arrêt de tabulation (la valeur choisie), ← → Début Fin.
 *
 *  DISPOSITION « ligne » (instrument de la Salle, variante A4 du 25/11) : le mot à
 *  gauche, les chiffres à droite sur la même ligne, sans fourchette écrite (le
 *  plan se lit au filet sous les chiffres, la Référence au petit carré). La
 *  rangée court jusqu'au bord de la plaque : autant de cases ENTIÈRES de 44 px
 *  au moins que la place en tient (six de 375 à 414 px d'écran, cinq à 320 et
 *  360), plus une demi-case d'APERÇU à droite, coupée par le bord et estompée
 *  par un fondu (masque de transparence sur les 10 derniers px, jamais sur une
 *  case entière). Retour de l'utilisateur du 25/11 : avec six cases nettes, « on
 *  ne dirait pas qu'on peut » faire glisser. L'aperçu dit « il y en a d'autres
 *  par là » ; au bout de la plage il disparaît, et c'est à gauche que la case
 *  coupée s'estompe. La rangée se cale sur le début d'une case. Au montage, le
 *  plan est centré dans les cases entières, la valeur dedans. Un indice de
 *  glissé joue une fois par appareil (`slideHintOnce`, couche `data-glisse`). */
export function NumberRow({
  label,
  min,
  max,
  value,
  presc,
  refValue,
  onPick,
  compact = false,
  rangeWord = 'plan',
  onLabel,
  labelHint,
  layout = 'bande',
}: {
  label: string;
  min: number;
  max: number;
  value: number;
  presc: [number, number];
  refValue: number | null;
  onPick: (n: number) => void;
  /** Écran bas : cases de 44 px au lieu de 48. */
  compact?: boolean;
  /** Le mot devant la fourchette soulignée : « plan » en salle, « loggé » quand
   *  on corrige une série passée (la fourchette est alors la valeur d'origine). */
  rangeWord?: string;
  /** Le libellé se touche (ex. « RIR » ouvre sa définition) : souligné d'un filet
   *  gris, cible élargie en largeur seulement, pour ne voler aucun toucher aux
   *  cases du dessus ni du dessous. */
  onLabel?: () => void;
  /** Nom lu du libellé touchable (« RIR, ce que ça veut dire »). */
  labelHint?: string;
  /** « bande » (défaut) : libellé et fourchette au-dessus, chiffres bord à bord ;
   *  « ligne » : le mot à gauche, six cases entières à droite (cf. en-tête). */
  layout?: 'bande' | 'ligne';
}) {
  const row = useRef<HTMLDivElement>(null);
  const values = range0(min, max);
  const ligne = layout === 'ligne';
  /** La dernière valeur vient d'un tap dans cette rangée : ne rien recadrer. */
  const pickedHere = useRef(false);
  const focusSel = useRef(false);
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  const swallowClick = useRef(false);
  /** « ligne » : cases entières visibles et largeur d'une case (px), d'après la place. */
  const per = useRef(6);
  const cellW = useRef(0);

  const cellOf = (n: number) => row.current?.querySelector<HTMLElement>(`[data-n="${n}"]`) ?? null;
  const centerOn = (n: number) => {
    const el = row.current;
    const c = cellOf(n);
    if (!el || !c) return;
    el.scrollLeft = c.offsetLeft + c.offsetWidth / 2 - el.clientWidth / 2;
  };
  // « ligne » : autant de cases entières de 44 px au moins que la place en tient
  // une fois l'aperçu gardé, puis la largeur qui laisse une demi-case d'aperçu.
  const fit = () => {
    const el = row.current;
    const w = el?.clientWidth ?? 0;
    if (!el || w <= 0) return;
    per.current = Math.max(1, Math.floor((w - PEEK_MIN) / CELL_MIN));
    cellW.current = Math.max(CELL_MIN, w / (per.current + 0.5));
    el.style.setProperty('--cell', `${cellW.current}px`);
  };
  /** Le fondu suit le défilement : à droite tant qu'il reste des valeurs (il
   *  s'efface sur les 10 derniers px de course) ; à gauche seulement au bout de
   *  la plage, où la case coupée passe de ce côté. Aux positions de repos, il ne
   *  touche que l'aperçu : la pastille du choisi reste nette. */
  const edges = () => {
    const el = row.current;
    if (!el || !ligne) return;
    const max = el.scrollWidth - el.clientWidth;
    const right = max > 0 ? Math.min(FADE, Math.max(0, max - el.scrollLeft)) : 0;
    const left = max > FADE ? Math.min(FADE, Math.max(0, el.scrollLeft - (max - FADE))) : 0;
    el.style.setProperty('--fade-r', `${right}px`);
    el.style.setProperty('--fade-l', `${left}px`);
  };
  const perView = () => per.current;
  const firstVisible = () => {
    const el = row.current;
    const w = cellW.current || cellOf(min)?.offsetWidth || 0;
    return el && w > 0 ? min + Math.round(el.scrollLeft / w) : min;
  };
  const showFrom = (first: number) => {
    const el = row.current;
    const c = cellOf(Math.max(min, Math.min(first, max)));
    if (el && c) el.scrollLeft = c.offsetLeft;
  };
  const fullyVisible = (n: number) => {
    const el = row.current;
    const c = cellOf(n);
    if (!el || !c) return true;
    return c.offsetLeft >= el.scrollLeft - 1 && c.offsetLeft + c.offsetWidth <= el.scrollLeft + el.clientWidth + 1;
  };
  /** Ramène `n` dans le champ, sans animation. */
  const bringIntoView = (n: number) => {
    if (!ligne) {
      centerOn(n);
      return;
    }
    const per = perView();
    const first = firstVisible();
    showFrom(n < first ? n : n - per + 1);
  };

  useLayoutEffect(() => {
    if (ligne) {
      // Calage d'ouverture : le plan centré dans les cases entières, la valeur dedans.
      fit();
      const n = perView();
      const planLen = presc[1] - presc[0] + 1;
      let first = presc[0] - Math.floor(Math.max(0, n - planLen) / 2);
      if (value < first) first = value;
      if (value > first + n - 1) first = value - n + 1;
      showFrom(Math.max(min, Math.min(first, max - n + 1)));
      edges();
      return;
    }
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
    if (!fullyVisible(value)) bringIntoView(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // « ligne » : la place change (rotation, fenêtre) : les cases se recalculent,
  // la rangée garde sa première case.
  useLayoutEffect(() => {
    const el = row.current;
    if (!ligne || !el || typeof ResizeObserver === 'undefined') return;
    let w = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === w) return;
      w = el.clientWidth;
      const first = firstVisible();
      fit();
      showFrom(first);
      edges();
    });
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ligne]);

  const pickKey = (n: number) => {
    const v = Math.min(max, Math.max(min, n));
    if (v === value) return;
    focusSel.current = true;
    onPick(v);
  };

  const labelNode = onLabel ? (
    <button
      type="button"
      onClick={onLabel}
      aria-label={labelHint}
      className={`-mx-2.5 min-w-11 px-2.5 text-left font-semibold text-ink underline decoration-dim decoration-1 underline-offset-[4px] active:opacity-70 ${
        ligne ? 'h-11 text-[16px]' : 'text-[15px]'
      }`}
    >
      {label}
    </button>
  ) : (
    <span className={`font-semibold text-ink ${ligne ? 'text-[16px]' : 'text-[15px]'}`}>{label}</span>
  );

  const scroller = (
    <div
      ref={row}
      data-number-row={label}
      data-glisse={ligne ? 'enfants' : undefined}
      className={ligne ? 'relative flex min-w-0 flex-1 overflow-x-auto' : 'relative mt-0.5 flex overflow-x-auto px-5'}
      style={{
        scrollbarWidth: 'none',
        scrollSnapType: 'x mandatory',
        scrollBehavior: 'auto',
        overscrollBehaviorX: 'contain',
        ...(ligne && { maskImage: EDGE_MASK, WebkitMaskImage: EDGE_MASK }),
      }}
      role="radiogroup"
      aria-label={label}
      onScroll={ligne ? edges : undefined}
      onKeyDown={(e) => {
        const k = e.key;
        if (k !== 'ArrowLeft' && k !== 'ArrowRight' && k !== 'Home' && k !== 'End') return;
        e.preventDefault();
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
        const el = e.currentTarget;
        if (ligne) {
          // Accroche au début de case le plus proche, sans glisser.
          showFrom(firstVisible());
        } else {
          // Accroche au chiffre le plus proche du centre, sans glisser.
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
        }
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
              // « ligne » : la demi-case d'aperçu touchée entre dans le champ
              // (le recadrage de `value` la ramène), sinon le choisi resterait
              // coupé et estompé. Une case entière ne bouge pas sous le doigt.
              pickedHere.current = !ligne || fullyVisible(n);
              onPick(n);
            }}
            className={`relative flex-none select-none ${compact ? 'h-11' : 'h-12'}`}
            // « bande » : 1/8 de la largeur de la rangée (le pourcentage se lit sur
            // la boîte de contenu, marges d'écran de 20 px déduites). « ligne » :
            // la largeur calculée (`fit`), calée au début ; avant la mesure, six
            // cases et demie dans la place laissée par le mot.
            style={
              ligne
                ? { flexBasis: 'var(--cell, calc(100% / 6.5))', minWidth: CELL_MIN, scrollSnapAlign: 'start' }
                : { flexBasis: 'calc((100% + 40px) / 8)', minWidth: 44, scrollSnapAlign: 'center' }
            }
          >
            <span
              className={`tnum flex items-center justify-center text-[22px] tracking-[-0.01em] ${
                sel ? 'mx-1 mb-1 mt-2.5 h-[calc(100%-14px)] rounded-cell bg-line font-bold text-ink' : `h-full ${inPlan ? 'text-ink' : 'text-faint'}`
              }`}
            >
              {n}
            </span>
            {/* Filet du plan en gris discret : sur le fond de groupe des plaques, le
                gris repère tombait à 2,85:1. */}
            {inPlan && <span className="absolute inset-x-0 bottom-0 h-px bg-faint" />}
            {refValue === n && <span className="absolute left-1/2 top-1 h-[5px] w-[5px] -translate-x-1/2 bg-muted" />}
          </button>
        );
      })}
    </div>
  );

  if (ligne) {
    return (
      // Jusqu'au bord droit de la plaque (sans marge) : l'aperçu y est coupé net.
      // Colonne du mot à 44 px (« Reps » en fait 38) : six cases entières dès 375 px.
      <div className="flex items-center pl-5">
        <span className="w-11 flex-none">{labelNode}</span>
        {scroller}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-baseline justify-between px-5">
        {labelNode}
        <span className="text-[14px] text-muted">
          {rangeWord} {presc[0] === presc[1] ? presc[0] : `${presc[0]}-${presc[1]}`}
          {refValue !== null && <span> · réf. {refValue}</span>}
        </span>
      </div>
      {scroller}
    </div>
  );
}

function range0(a: number, b: number): number[] {
  return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}
