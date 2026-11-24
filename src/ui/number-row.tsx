// Kit E · rangée de numéros touchables (reps, RIR en salle) : un tap, une valeur.
import { useLayoutEffect, useRef } from 'react';

/** Rangée de numéros touchables, de `min` à `max` (l'appelant borne la plage : reps
 *  1 à 50, RIR 0 à 10 en salle, élargie si la valeur courante en sort). Un tap = une valeur ; la fourchette du plan est
 *  soulignée d'un filet, la valeur choisie d'un trait épais, la Référence d'un
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
        <span className="text-[15px] font-semibold text-ink">{label}</span>
        <span className="text-[14px] text-muted">
          plan {presc[0] === presc[1] ? presc[0] : `${presc[0]}-${presc[1]}`}
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
                  sel ? 'font-bold text-ink' : inPlan ? 'text-ink' : 'text-faint'
                }`}
              >
                {n}
              </span>
              {inPlan && <span className="absolute inset-x-0 bottom-0 h-px bg-dim" />}
              {sel && <span className="absolute inset-x-2 bottom-0 h-[4px] bg-ink" />}
              {refValue === n && <span className="absolute left-1/2 top-1 h-[5px] w-[5px] -translate-x-1/2 bg-muted" />}
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
