// Kit E · feuille basse modale, montée dans l'emplacement du shell.
import { useContext, useEffect, useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { TextLink } from './buttons';
import { FOCUSABLE, trapTarget } from './focus-trap';
import { prefersReducedMotion } from './motion';
import { SheetSlotContext } from './sheet-slot';

/** Sortie d'une feuille : 150 ms, ease-out, plus courte que l'entrée (240 ms).
 *  Elle se joue sur un FANTÔME : une copie inerte du voile et du panneau, posée
 *  dans l'emplacement au moment où la vraie feuille est démontée. Le démontage
 *  React reste immédiat et identique, quelle que soit la façon de fermer (open
 *  à false, `key` qui change, montage conditionnel autour de la feuille) : le
 *  focus, les écouteurs et le DOM réel ne changent pas. Le fantôme n'a ni rôle,
 *  ni id, ni focus (aria-hidden + inert) et se retire par minuteur. Réduire les
 *  animations (système) : fondu seul, sans déplacement. */
function playSheetExit(slot: HTMLElement, veil: HTMLElement, panel: HTMLElement, scrollTop: number) {
  const reduce = prefersReducedMotion();
  const ghosts = [veil, panel].map((node) => {
    const g = node.cloneNode(true) as HTMLElement;
    // Sans ces classes : pas d'entrée @starting-style ni de transition sur la copie.
    g.classList.remove('ui-veil', 'ui-sheet');
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
  gVeil.animate?.([{ opacity: 1 }, { opacity: 0 }], timing);
  gPanel.animate?.(reduce ? [{ opacity: 1 }, { opacity: 0 }] : [{ transform: 'translateY(0)' }, { transform: 'translateY(100%)' }], timing);
  window.setTimeout(() => {
    gVeil.remove();
    gPanel.remove();
  }, 170);
}

/** Feuille basse : voile noir plein (pas de flou) + panneau levé collé en bas, qui
 *  défile s'il est long. Fermeture : « Fermer », toucher le voile, Échap.
 *  Focus : au titre à l'ouverture, piégé dans la feuille (Tab boucle), rendu à
 *  l'élément d'origine à la fermeture (registre U16). Entrée en 240 ms (CSS),
 *  sortie en 150 ms (`playSheetExit`). */
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
    if (!shown) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    heading.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      const panel = panelRef.current;
      if (e.key !== 'Tab' || !panel) return;
      const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const at = items.indexOf(document.activeElement as HTMLElement);
      const target = trapTarget(at, items.length, e.shiftKey);
      if (target === null && panel.contains(document.activeElement)) return;
      e.preventDefault();
      items[target ?? 0]?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      // Rendre le focus à ce qui a ouvert la feuille, s'il est encore là.
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [shown, onClose]);

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
      <div ref={veilRef} aria-hidden onClick={onClose} className="ui-veil absolute inset-x-0 bottom-0 h-[100dvh] bg-black/65" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        className="ui-sheet absolute inset-x-0 bottom-0 flex max-h-[min(80dvh,720px)] flex-col rounded-t-sheet border-t border-line bg-raise"
      >
        {/* Le titre passe à la ligne plutôt que d'être coupé (un nom d'exo long
            avec le côté, à 360 px) ; sa première ligne reste au niveau de
            « Fermer » (ligne de 22 px centrée sur la cible de 44 px). */}
        <div className="flex flex-none items-start justify-between gap-3 py-2 pl-5 pr-3">
          <h2 ref={heading} id={id} tabIndex={-1} className="min-w-0 break-words py-[11px] text-[17px] font-semibold leading-[22px] text-ink outline-none">
            {title}
          </h2>
          <TextLink tone="muted" onClick={onClose} className="flex-none px-2">
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
        {footer ? (
          <div className="flex flex-none flex-col gap-2 px-5 pb-[calc(0.75rem+var(--safe-bottom))] pt-3">{footer}</div>
        ) : (
          <div className="h-[calc(0.75rem+var(--safe-bottom))] flex-none" />
        )}
      </div>
    </>,
    slot,
  );
}
