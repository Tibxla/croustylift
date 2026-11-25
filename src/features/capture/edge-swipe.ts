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

// --- Le geste, doigt par doigt ---------------------------------------------
// Un petit automate : l'écran (EdgeSwipeBack.tsx) lui passe chaque événement du
// pointeur et peint ce qu'il rend. Un seul doigt à la fois : le geste retient le
// `pointerId` qui l'a ouvert, et les autres doigts sont ignorés au départ, au
// déplacement et au lâcher. Pendant le retour vers le Sommaire (200 ms engagées),
// aucun départ n'est pris : un second geste relâché sous le seuil annulait le
// retour et laissait l'instrument démonté sous le doigt (relecture du 25/11).

export interface EdgeGesture {
  pointerId: number;
  x0: number;
  y0: number;
  dx: number;
  lock: 'pending' | 'swipe' | 'abandon';
  trail: TrailPoint[];
}

interface PointerAt {
  pointerId: number;
  x: number;
  y: number;
  t: number;
}

/** Un doigt se pose. `left` : bord gauche de la bande, `returning` : un retour
 *  vers le Sommaire est engagé. Rend le geste ouvert, ou `g` inchangé. */
export function edgeDown(
  g: EdgeGesture | null,
  p: PointerAt & { left?: number; sheetOpen: boolean; returning: boolean },
): EdgeGesture | null {
  if (g !== null || p.returning) return g;
  if (!edgeStarts({ x: p.x - (p.left ?? 0), sheetOpen: p.sheetOpen })) return g;
  return { pointerId: p.pointerId, x0: p.x, y0: p.y, dx: 0, lock: 'pending', trail: [{ x: p.x, t: p.t }] };
}

/** Le doigt bouge. `dx` : le déplacement à peindre, `null` s'il n'y a rien à peindre. */
export function edgeMove(g: EdgeGesture | null, p: PointerAt): { g: EdgeGesture | null; dx: number | null } {
  if (!g || p.pointerId !== g.pointerId) return { g, dx: null };
  const trail = trimTrail([...g.trail, { x: p.x, t: p.t }], p.t);
  const lock = g.lock === 'pending' ? edgeLock(p.x - g.x0, p.y - g.y0) : g.lock;
  if (lock !== 'swipe') return { g: { ...g, trail, lock }, dx: null };
  const dx = Math.max(0, p.x - g.x0);
  return { g: { ...g, trail, lock, dx }, dx };
}

/** Le doigt se lève (ou le geste est annulé : `cancel`). `outcome` : `tap` (toucher
 *  sur place, à rendre à ce qui est dessous), `back`, `stay`, ou `none`. */
export function edgeUp(
  g: EdgeGesture | null,
  p: { pointerId: number; x: number; t: number },
  width: number,
  cancel = false,
): { g: EdgeGesture | null; outcome: 'none' | 'tap' | 'back' | 'stay' } {
  if (!g || p.pointerId !== g.pointerId) return { g, outcome: 'none' };
  if (g.lock === 'pending') return { g: null, outcome: cancel ? 'none' : 'tap' };
  if (g.lock !== 'swipe') return { g: null, outcome: 'none' };
  if (cancel) return { g: null, outcome: 'stay' };
  const velocity = releaseVelocity(trimTrail(g.trail, p.t), { x: p.x, t: p.t });
  return { g: null, outcome: edgeRelease({ dx: g.dx, width, velocity }) };
}
