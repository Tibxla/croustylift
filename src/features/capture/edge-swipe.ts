// Glissé depuis le bord gauche, de gauche à droite, qui ramène au Sommaire :
// la décision, pure (le geste et son retour visuel : EdgeSwipeBack.tsx).
//
// CONFLIT AVEC LA RÈGLE, la bande des séries et les rangées Reps et RIR, qui
// glissent aussi à l'horizontale : tranché par la GÉOGRAPHIE, pas par le sens.
// Seul un départ dans la bande de 20 px du bord gauche est regardé ; un départ
// au-delà reste à ce qui est dessous, même s'il glisse vers la droite.
//   - Le sens se décide après 6 px : vers la droite et plus horizontal que
//     vertical, le glissé est pris ; sinon il est abandonné. Sous 6 px dans les
//     deux sens, c'est un toucher sur place, rendu à ce qui est dessous.
//   - Au lâcher : retour au Sommaire au-delà de 30 % de la largeur, ou sur un
//     coup sec (plus de 0,5 px/ms sur les 100 dernières ms, 40 px au moins).
//   - Une feuille ouverte coupe le geste.
export const EDGE_PX = 20;
const SLOP_PX = 6;
const COMMIT_RATIO = 0.3;
const FLICK_PX_PER_MS = 0.5;
const FLICK_MIN_PX = 40;
const VELOCITY_WINDOW_MS = 100;

/** Le doigt posé en `x` (depuis le bord gauche de l'écran) ouvre-t-il le geste ? */
export function edgeStarts({ x, sheetOpen }: { x: number; sheetOpen: boolean }): boolean {
  return !sheetOpen && x <= EDGE_PX;
}

/** Le sens, d'après le déplacement depuis le départ. */
export function edgeLock(dx: number, dy: number): 'pending' | 'swipe' | 'abandon' {
  if (Math.abs(dx) < SLOP_PX && Math.abs(dy) < SLOP_PX) return 'pending';
  return dx > 0 && Math.abs(dx) > Math.abs(dy) ? 'swipe' : 'abandon';
}

/** Au lâcher : `dx` le déplacement gardé, `width` la largeur de l'écran, `velocity` en px/ms. */
export function edgeRelease({ dx, width, velocity }: { dx: number; width: number; velocity: number }): 'back' | 'stay' {
  return dx > COMMIT_RATIO * width || (velocity > FLICK_PX_PER_MS && dx >= FLICK_MIN_PX) ? 'back' : 'stay';
}

export interface TrailPoint {
  x: number;
  t: number;
}

/** Les points des 100 dernières ms avant `now`, deux au moins. */
export function trimTrail(trail: readonly TrailPoint[], now: number): TrailPoint[] {
  const kept = [...trail];
  while (kept.length > 2 && now - kept[0]!.t > VELOCITY_WINDOW_MS) kept.shift();
  return kept;
}

/** Vitesse horizontale au lâcher, du plus vieux point gardé jusqu'à `end`. */
export function releaseVelocity(trail: readonly TrailPoint[], end: TrailPoint): number {
  const a = trail[0];
  if (!a) return 0;
  const dt = end.t - a.t;
  return dt > 0 ? (end.x - a.x) / dt : 0;
}
