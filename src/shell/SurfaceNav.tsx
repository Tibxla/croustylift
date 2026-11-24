// Navigation de E : une ligne de cinq mots en haut de chaque écran authentifié.
//
// Pourquoi en haut : en salle on ne change presque jamais de surface, et le bas
// de l'écran (la zone du pouce) appartient en entier à l'action du moment
// (logger, exo suivant, enregistrer). Pourquoi des mots : cinq surfaces tiennent
// en une ligne lisible sans icône à deviner, et rien ne se cache derrière un
// menu. Le mot actif est en demi-gras souligné, les autres en gris. La ligne est
// dans le flux (elle défile avec la page) : ni `fixed` ni `sticky`, rien qui
// dépende de la mesure de la fenêtre par WebKit.
//
// Aucune animation au changement de surface : le geste revient des dizaines de
// fois par jour, le retour est instantané.
//
// DIAGNOSTIC : un appui long de 1,5 s sur la ligne ouvre le relevé d'affichage
// (registre R4, src/viewport/). C'est le seul geste disponible sur tous les
// écrans de l'app installée, qui n'a pas de barre d'adresse pour `?diag=1`. Le
// clic qui suit le relâcher est avalé, pour ne pas changer de surface en
// ouvrant le relevé.
import { useRef } from 'react';
import type { SurfaceName } from '../pwa/update';
import { openDiag } from '../viewport/watch';
import { SURFACE_NAV } from './surfaces';

/** Durée de l'appui long sur la navigation qui ouvre le relevé de diagnostic. */
const DIAG_LONG_PRESS_MS = 1500;

export function SurfaceNav({ current, onSelect }: { current: SurfaceName; onSelect: (s: SurfaceName) => void }) {
  const pressTimer = useRef<number | undefined>(undefined);
  const longPressed = useRef(false);
  const cancelPress = () => window.clearTimeout(pressTimer.current);

  return (
    <nav
      aria-label="Surfaces"
      className="mx-auto flex h-12 w-full max-w-md flex-none select-none items-center justify-between px-2"
      style={{ WebkitTouchCallout: 'none' }}
      onPointerDown={() => {
        longPressed.current = false;
        cancelPress();
        pressTimer.current = window.setTimeout(() => {
          longPressed.current = true;
          openDiag();
        }, DIAG_LONG_PRESS_MS);
      }}
      onPointerUp={cancelPress}
      onPointerCancel={cancelPress}
      onPointerLeave={cancelPress}
      onContextMenu={(event) => event.preventDefault()}
      onClickCapture={(event) => {
        if (!longPressed.current) return;
        longPressed.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {SURFACE_NAV.map((s) => {
        const active = s.id === current;
        return (
          <button
            key={s.id}
            type="button"
            aria-current={active ? 'page' : undefined}
            onClick={() => onSelect(s.id)}
            className={`h-11 px-[9px] text-[15px] ${
              active ? 'font-semibold text-ink underline decoration-2 underline-offset-[7px]' : 'text-muted active:text-ink'
            }`}
          >
            {s.label}
          </button>
        );
      })}
    </nav>
  );
}
