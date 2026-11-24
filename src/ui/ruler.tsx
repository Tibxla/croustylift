// Kit E · règle graduée au pouce (générique).
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from './motion';

/** Règle graduée au pouce : c'est la règle qui glisse sous une aiguille fixe.
 *  Toucher sans glisser va au cran touché ; ← → au clavier. La valeur est un
 *  index de cran entier (`steps`), à l'appelant de le convertir.
 *  Poids : `<Ruler steps={kg / pas} max={400} label="Poids" format={(s) => `${s * pas} kg`} />`.
 *
 *  Les graduations vivent sur une PISTE translatée en `transform` (la graduation
 *  v est à v × pxPerStep du centre de la piste). Le glissé suit le doigt sans
 *  transition. Au toucher, la piste saute au cran ; avec `animateTap`, elle y
 *  glisse en 190 ms (ease-out fort), et un nouveau toucher ou un glissé repart
 *  de la position affichée (interruptible). Ni le clavier ni un changement venu
 *  de l'extérieur n'animent. Réduire les animations : aucun glissé.
 *
 *  ÉLAN (grosse marche, ex. +40 kg) : un glissé lâché vite continue sur sa
 *  lancée, proportionnelle à la vitesse du doigt sur ses 100 dernières ms
 *  (au-delà de 0,9 px/ms seulement : un glissé posé ou un petit ajustement vif
 *  s'arrête là où on lâche ; lancée bornée à 560 px). La piste y glisse en
 *  320 ms ease-out fort, interruptible par un nouveau toucher ; avec Réduire les
 *  animations, elle y saute. */
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
  compact = false,
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
  /** Écran bas : graduations et aiguille plus courtes, étiquettes rapprochées. */
  compact?: boolean;
}) {
  const tick = compact ? { major: 22, mid: 13, minor: 8, needle: 27, gap: 'mt-1' } : { major: 30, mid: 18, minor: 11, needle: 36, gap: 'mt-2' };
  const box = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ x: number; start: number; moved: boolean; last: number; trail: { x: number; t: number }[] } | null>(null);
  const animTimer = useRef(0);
  const [drag, setDrag] = useState<number | null>(null);
  /** Durée du glissé animé en cours (toucher ou élan), 0 sinon. */
  const [animMs, setAnimMs] = useState(0);
  const tapAnim = animMs > 0;
  /** Demi-largeur en crans : assez de graduations pour couvrir la règle, sans en dessiner hors champ. */
  const [half, setHalf] = useState(14);
  const value = drag ?? steps;
  const clamp = (v: number) => Math.min(max, Math.max(0, v));

  useLayoutEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry?.contentRect.width ?? 390;
      setHalf(Math.ceil(w / 2 / pxPerStep) - 1);
    });
    ro.observe(el);
    return () => ro.disconnect();
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
    setAnimMs(0);
  };
  const playAnim = (ms: number) => {
    if (prefersReducedMotion()) return;
    window.clearTimeout(animTimer.current);
    setAnimMs(ms);
    animTimer.current = window.setTimeout(() => setAnimMs(0), ms + 40);
  };

  // Fenêtre doublée : pendant le glissé animé (un toucher va jusqu'à une
  // demi-largeur), le départ et l'arrivée restent garnis. L'élan peut dépasser
  // une largeur : la fenêtre s'élargit le temps du glissé.
  const base = Math.round(value);
  const reach = 2 * half + 2 + (tapAnim ? 64 : 0);
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
      className="relative cursor-grab touch-none select-none overflow-hidden border-t border-line outline-offset-4 active:cursor-grabbing"
      style={{ height }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          stopAnim();
          // Hors cran (valeur tapée au clavier) : la flèche va au cran entier suivant.
          onChange(clamp(e.key === 'ArrowRight' ? Math.floor(steps) + 1 : Math.ceil(steps) - 1));
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
        gesture.current = { x: e.clientX, start: from, moved: false, last: from, trail: [{ x: e.clientX, t: e.timeStamp }] };
      }}
      onPointerMove={(e) => {
        const g = gesture.current;
        if (!g) return;
        const dx = e.clientX - g.x;
        g.trail.push({ x: e.clientX, t: e.timeStamp });
        while (g.trail.length > 2 && e.timeStamp - g.trail[0]!.t > 100) g.trail.shift();
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
          const r = e.currentTarget.getBoundingClientRect();
          const target = clamp(Math.round(g.start + (e.clientX - (r.left + r.width / 2)) / pxPerStep));
          if (animateTap && target !== g.start) playAnim(190);
          onChange(target);
        } else {
          // Élan : vitesse du doigt sur ses 100 dernières ms (px/ms).
          const a = g.trail[0]!;
          const dt = e.timeStamp - a.t;
          const vel = dt > 0 && e.timeStamp - (g.trail[g.trail.length - 1]?.t ?? 0) < 60 ? (e.clientX - a.x) / dt : 0;
          // Seuil haut (0,9 px/ms) : un petit ajustement vif (45 px en 80 ms) ne
          // part pas ; seul un vrai coup sec a de l'élan, compté au-delà de 0,5 px/ms.
          if (Math.abs(vel) > 0.9) {
            // Lancée bornée : un coup sec ne part jamais au bout de la règle.
            const throwPx = Math.sign(vel) * Math.min(560, (Math.abs(vel) - 0.5) * 300);
            const to = clamp(Math.round(g.last - throwPx / pxPerStep));
            playAnim(320);
            onChange(to);
          } else onChange(Math.round(g.last));
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
          // Sans glissé animé, aucune transition : la règle sert des centaines de
          // fois par séance, elle suit le doigt et saute au cran touché.
          transition: tapAnim ? `transform ${animMs}ms cubic-bezier(0.23, 1, 0.32, 1)` : 'none',
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
                className={color ? '' : major ? 'bg-muted' : 'bg-dim'}
                style={{
                  width: color ? Math.max(2, pxPerStep - 2) : major ? 2 : 1,
                  height: major ? tick.major : mid ? tick.mid : tick.minor,
                  background: color,
                }}
              />
              {major && majorLabel && <span className={`tnum ${tick.gap} whitespace-nowrap text-[13px] text-faint`}>{majorLabel(v)}</span>}
            </div>
          );
        })}
      </div>
      {/* L'aiguille, fixe au centre ; elle s'arrête au-dessus des étiquettes. */}
      <div className="pointer-events-none absolute left-1/2 top-0 w-[3px] -translate-x-1/2" style={{ background: needle, height: tick.needle }} />
    </div>
  );
}
