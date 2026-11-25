// Glissé depuis le bord gauche, de gauche à droite, qui ramène au Sommaire
// (variante A4 de la Salle, 25/11). La décision est pure (edge-swipe.ts) ; ici,
// le geste et son retour visuel.
//
// GÉOGRAPHIE. Une bande transparente de 20 px, posée le long du bord gauche de
// l'instrument (pied compris), en `touch-action: none`, prend le pointeur de tout
// doigt qui s'y pose : la règle, la bande des séries et les rangées ne voient
// jamais ces départs. Un départ au-delà n'est jamais regardé. Un toucher sur
// place dans la bande est rendu à l'élément dessous (`click`) : « ‹ Sommaire »,
// « Gauche », le premier numéro de l'index restent touchables à travers elle.
// Prix payé : le cran de la règle sous le bord gauche ne se touche plus (il ne
// se vise pas en pratique, la règle glisse).
//
// FEUILLE OUVERTE. La bande passe sous l'emplacement des feuilles (z 20 contre
// 40) : leur voile la couvre. Par sûreté, un départ alors qu'une feuille est
// ouverte (un `role="dialog"` dans l'emplacement) est ignoré.
//
// UN DOIGT À LA FOIS. Le geste retient le pointeur qui l'a ouvert ; les autres
// doigts sont ignorés. Pendant le retour vers le Sommaire (200 ms engagées),
// aucun départ n'est pris (automate pur : `edgeDown`, `edgeMove`, `edgeUp`).
//
// RETOUR VISUEL, en `transform` seul, posé par ref sans rendu React : l'écran
// suit le doigt, sans transition, sur un fond levé où se lit « ‹ Sommaire ».
// Lâché au-delà du seuil ou d'un coup sec, l'écran file à droite (200 ms,
// ease-out fort) puis le Sommaire s'ouvre ; sinon il revient (200 ms, même
// courbe, sans rebond). Réduire les animations : pas de déplacement animé, le
// retour est sec. Les minuteurs sont annulés au démontage.
import { useContext, useEffect, useRef, type ReactNode } from 'react';
import { SheetSlotContext } from '../../ui';
import { prefersReducedMotion } from '../../ui/motion';
import { blurFocusedField } from '../../shell/blur-focused-field';
import { EDGE_PX, edgeDown, edgeMove, edgeUp, type EdgeGesture } from './edge-swipe';

const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';
const SETTLE_MS = 200;

export function EdgeSwipeBack({ onBack, children }: { onBack: () => void; children: ReactNode }) {
  const slot = useContext(SheetSlotContext);
  const pane = useRef<HTMLDivElement>(null);
  const under = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);
  const g = useRef<EdgeGesture | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const paint = (dx: number, transition: string) => {
    const p = pane.current;
    const u = under.current;
    if (!p || !u) return;
    p.style.transition = transition;
    p.style.transform = dx > 0 ? `translate3d(${dx}px, 0, 0)` : '';
    u.style.visibility = dx > 0 ? 'visible' : 'hidden';
  };

  const later = (fn: () => void) => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      fn();
    }, SETTLE_MS);
  };

  const settle = (back: boolean) => {
    const p = pane.current;
    if (!p) return;
    const reduced = prefersReducedMotion();
    if (back) {
      // Le retour est engagé : un champ au clavier (poids) perd le focus tout
      // de suite, avant les 200 ms où l'écran file (shell/blur-focused-field.ts).
      blurFocusedField();
      if (reduced) {
        paint(0, 'none');
        onBack();
        return;
      }
      paint(p.clientWidth, `transform ${SETTLE_MS}ms ${EASE_OUT}`);
      // L'instrument est démonté par le Sommaire : rien à remettre en place.
      later(onBack);
      return;
    }
    if (reduced) {
      paint(0, 'none');
      return;
    }
    // L'écran revient ; le fond reste visible jusqu'au bout, puis se cache.
    p.style.transition = `transform ${SETTLE_MS}ms ${EASE_OUT}`;
    p.style.transform = '';
    later(() => paint(0, 'none'));
  };

  const sheetOpen = () => !!slot?.querySelector('[role="dialog"]');

  return (
    <div className="relative flex flex-1 flex-col">
      {/* Ce qui apparaît derrière l'écran qui glisse : le mot du retour. */}
      <div ref={under} aria-hidden className="pointer-events-none absolute inset-0 flex items-center bg-raise pl-5" style={{ visibility: 'hidden' }}>
        <span className="text-[17px] font-semibold text-ink">‹ Sommaire</span>
      </div>
      <div ref={pane} className="relative flex flex-1 flex-col bg-bg">
        {children}
      </div>
      <div
        ref={strip}
        aria-hidden
        data-edge-swipe
        className="absolute bottom-0 left-0 top-0 z-20"
        style={{ width: EDGE_PX, touchAction: 'none' }}
        onPointerDown={(e) => {
          // Un seul doigt à la fois, aucun départ pendant un retour engagé (edge-swipe.ts).
          const next = edgeDown(g.current, {
            pointerId: e.pointerId,
            x: e.clientX,
            y: e.clientY,
            t: e.timeStamp,
            left: e.currentTarget.getBoundingClientRect().left,
            sheetOpen: sheetOpen(),
            returning: timer.current !== null,
          });
          if (next === g.current) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          g.current = next;
        }}
        onPointerMove={(e) => {
          const m = edgeMove(g.current, { pointerId: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp });
          g.current = m.g;
          if (m.dx !== null) paint(m.dx, 'none');
        }}
        onPointerUp={(e) => {
          const width = pane.current?.clientWidth ?? window.innerWidth;
          const { g: next, outcome } = edgeUp(g.current, { pointerId: e.pointerId, x: e.clientX, t: e.timeStamp }, width);
          g.current = next;
          if (outcome === 'tap') {
            // Un toucher sur place : rendu à la cible touchable sous la bande
            // (une icône SVG renvoie à son bouton).
            const el = strip.current;
            if (el) el.style.pointerEvents = 'none';
            const hit = document.elementFromPoint(e.clientX, e.clientY);
            if (el) el.style.pointerEvents = '';
            const target = hit?.closest('button, a, [role="radio"], [role="button"]');
            if (target instanceof HTMLElement) target.click();
          } else if (outcome === 'back' || outcome === 'stay') {
            settle(outcome === 'back');
          }
        }}
        onPointerCancel={(e) => {
          const { g: next, outcome } = edgeUp(g.current, { pointerId: e.pointerId, x: e.clientX, t: e.timeStamp }, 0, true);
          g.current = next;
          if (outcome === 'stay') settle(false);
        }}
      />
    </div>
  );
}
