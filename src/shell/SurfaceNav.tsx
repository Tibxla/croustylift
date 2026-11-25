// Navigation de E : une ligne de cinq mots en haut de chaque écran authentifié.
//
// Pourquoi en haut : en salle on ne change presque jamais de surface, et le bas
// de l'écran (la zone du pouce) appartient en entier à l'action du moment
// (logger, exo suivant, enregistrer). Pourquoi des mots : cinq surfaces tiennent
// en une ligne lisible sans icône à deviner, et rien ne se cache derrière un
// menu. Le mot actif est en demi-gras souligné, les autres en gris. Dans un
// onglet de navigateur, la ligne est dans le flux (elle défile avec la page).
// Dans l'app installée, elle est COLLÉE en haut (`sticky`, jamais `fixed`), voir
// HAUT DE L'ÉCRAN.
//
// Aucune animation au changement de surface : le geste revient des dizaines de
// fois par jour, le retour est instantané.
//
// LARGEUR : les cinq mots font 344 px avec leurs marges. Sous 350 px (iPhone SE
// de 1ʳᵉ génération, zoom d'affichage des mini), mots à 14 px et marges de 6 px,
// sinon « Réglages » sortait de l'écran et toute l'app glissait de côté ; chaque
// mot garde 44 px de large au moins (« Exos »). À partir de 380 px, la ligne
// prend 11 px de marge : le premier mot commence à 20 px, comme les titres.
//
// HAUT DE L'ÉCRAN (iPhone, iOS 26) : en app installée, iOS floute le haut de la
// webview sur une quarantaine de points (effet de bord de défilement de Liquid
// Glass, pas notre bande `.safe-top-scrim`). Il s'en abstient quand une boîte
// collée, opaque et pleine largeur tient le bord haut, et que la barre d'état
// n'est pas translucide (index.html). Cette boîte, c'est la ligne : le conteneur
// `.surface-nav-bar` (index.css) porte le fond plein sur toute la largeur, la
// ligne de mots reste à `max-w-md` dedans. Elle se pose ainsi juste sous la
// barre d'état, sans marge. Les écrans sans cette ligne ont leur propre boîte,
// la bande du bord (`.top-edge-band`, main.tsx).
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
    <div className="surface-nav-bar">
      <nav
        aria-label="Surfaces"
        className="mx-auto flex h-12 w-full max-w-md flex-none select-none items-center justify-between px-2 pt-safe-nav min-[380px]:px-[11px]"
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
              className={`h-11 min-w-11 px-[9px] text-[15px] max-[349px]:px-1.5 max-[349px]:text-[14px] ${
                active ? 'font-semibold text-ink underline decoration-2 underline-offset-[7px]' : 'text-muted active:text-ink'
              }`}
            >
              {s.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
