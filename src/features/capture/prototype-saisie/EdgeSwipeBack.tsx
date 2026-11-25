// PROTOTYPE JETABLE · glissé depuis le bord gauche, de gauche à droite, qui
// ramène au Sommaire. Commun à toutes les variantes.
//
// CONFLIT AVEC LA RÈGLE (qui court d'un bord à l'autre) et les rangées Reps/RIR
// qui défilent : tranché par la GÉOGRAPHIE, pas par la direction. Une bande
// transparente de 20 px, posée au-dessus de l'écran le long du bord gauche, en
// `touch-action: none`, prend le pointeur de tout doigt qui s'y pose : la règle
// ne voit jamais ces départs. Un départ hors de la bande (x > 20 px) n'est jamais
// regardé : il reste à la règle ou à la rangée, même s'il glisse vers la droite.
// Prix payé : les 20 premiers pixels de la règle ne se touchent plus (le cran
// sous le bord gauche, à 20 crans de l'aiguille, jamais visé en pratique).
// Un toucher sans mouvement dans la bande est rendu à l'élément dessous (clic).
// Un départ qui part à la verticale est abandonné.
//
// Retour visuel : l'écran suit le doigt en `transform` seul (posé par ref, sans
// rendu React), sur un fond levé où se lit « ‹ Sommaire ». Lâché au-delà de 30 %
// de la largeur, ou d'un coup sec (> 0,5 px/ms sur 40 px au moins) : l'écran
// file à droite (200 ms, ease-out fort) puis le Sommaire s'ouvre. Sinon il
// revient en ressort court (280 ms, léger dépassement). Réduire les animations :
// pas de déplacement animé, le retour est sec.
import { useRef, type ReactNode } from 'react';
import { prefersReducedMotion } from '../../../ui/motion';

const EDGE = 20;

export function EdgeSwipeBack({ onBack, children }: { onBack: () => void; children: ReactNode }) {
  const pane = useRef<HTMLDivElement>(null);
  const under = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const g = useRef<{ x0: number; y0: number; dx: number; locked: boolean | null; trail: { x: number; t: number }[] } | null>(null);

  const paint = (dx: number, transition: string) => {
    const p = pane.current;
    const u = under.current;
    if (!p || !u) return;
    p.style.transition = transition;
    p.style.transform = dx > 0 ? `translate3d(${dx}px, 0, 0)` : '';
    u.style.visibility = dx > 0 || transition !== 'none' ? 'visible' : 'hidden';
    u.style.opacity = String(Math.min(1, dx / (0.3 * p.clientWidth)));
  };

  const settle = (commit: boolean) => {
    const p = pane.current;
    if (!p) return;
    const reduced = prefersReducedMotion();
    if (commit) {
      if (reduced) {
        paint(0, 'none');
        onBack();
        return;
      }
      paint(p.clientWidth, 'transform 200ms cubic-bezier(0.23, 1, 0.32, 1)');
      window.setTimeout(() => {
        // L'écran est démonté par le Sommaire : rien à remettre en place.
        onBack();
      }, 200);
    } else {
      paint(0, reduced ? 'none' : 'transform 280ms cubic-bezier(0.34, 1.35, 0.64, 1)');
      window.setTimeout(() => {
        if (under.current) under.current.style.visibility = 'hidden';
      }, 300);
    }
  };

  return (
    <div className="relative flex flex-1 flex-col">
      {/* Ce qui apparaît derrière l'écran qui glisse : le mot du retour. */}
      <div ref={under} aria-hidden className="pointer-events-none absolute inset-0 flex items-center bg-raise pl-5" style={{ visibility: 'hidden', opacity: 0 }}>
        <span className="text-[17px] font-semibold text-ink">‹ Sommaire</span>
      </div>
      <div ref={pane} className="relative flex flex-1 flex-col bg-bg">
        {children}
      </div>
      <div
        ref={strip}
        aria-hidden
        className="absolute bottom-0 left-0 top-0 z-30"
        style={{ width: EDGE, touchAction: 'none' }}
        onPointerDown={(e) => {
          if (g.current) return; // un second doigt ne reprend pas le geste
          e.currentTarget.setPointerCapture(e.pointerId);
          g.current = { x0: e.clientX, y0: e.clientY, dx: 0, locked: null, trail: [{ x: e.clientX, t: e.timeStamp }] };
        }}
        onPointerMove={(e) => {
          const s = g.current;
          if (!s) return;
          const dx = e.clientX - s.x0;
          const dy = e.clientY - s.y0;
          s.trail.push({ x: e.clientX, t: e.timeStamp });
          while (s.trail.length > 2 && e.timeStamp - s.trail[0]!.t > 100) s.trail.shift();
          if (s.locked === null) {
            if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
            s.locked = dx > 0 && Math.abs(dx) > Math.abs(dy);
          }
          if (!s.locked) return;
          s.dx = Math.max(0, dx);
          paint(s.dx, 'none');
        }}
        onPointerUp={(e) => {
          const s = g.current;
          g.current = null;
          if (!s) return;
          if (s.locked === null) {
            // Un toucher sur place : rendu à ce qui est sous la bande.
            const el = strip.current;
            if (el) el.style.pointerEvents = 'none';
            const hit = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
            if (el) el.style.pointerEvents = '';
            hit?.click();
            return;
          }
          if (!s.locked) return;
          const a = s.trail[0]!;
          const dt = e.timeStamp - a.t;
          const vel = dt > 0 ? (e.clientX - a.x) / dt : 0;
          const w = pane.current?.clientWidth ?? window.innerWidth;
          settle(s.dx > 0.3 * w || (vel > 0.5 && s.dx > 40));
        }}
        onPointerCancel={() => {
          const s = g.current;
          g.current = null;
          if (s?.locked) settle(false);
        }}
      />
    </div>
  );
}
