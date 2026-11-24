// Garde contre le double toucher de « Logger » (audit UX du 24/11, n° 3).
//
// Un rebond de doigt ou un toucher appuyé, sur le geste répété des centaines de
// fois, devenait une seconde série : `handleLog` part exprès de l'état projeté
// pour que deux taps rapprochés voient la 1ʳᵉ série posée (bug M6), donc le
// second tap était rangé comme une vraie série.
//
// La règle : un second Logger sur le MÊME exo arrivé moins de 600 ms après le
// précédent est ignoré, quelles que soient ses valeurs et son côté. Comparer les
// valeurs ne suffit pas : l'écran se réamorce en une ou deux images après le
// premier Logger (RIR repris de la Référence du rang suivant, côté qui bascule
// en unilatéral), et le rebond logge alors un brouillon DIFFÉRENT. Deux Logger
// volontaires ne tiennent pas en 600 ms (régler une valeur prend plus) ; plus
// espacés, ils restent deux séries. Aucune animation : le bouton ne réagit
// simplement pas au rebond. Pur, horloge injectée.

export const DOUBLE_TAP_MS = 600;

/** Le dernier Logger pris en compte : l'exo et l'instant (ms, horloge monotone). */
export interface LogStamp {
  exerciseId: string;
  at: number;
}

export function isDoubleTap(prev: LogStamp | null, exerciseId: string, now: number): boolean {
  if (prev === null || prev.exerciseId !== exerciseId) return false;
  const elapsed = now - prev.at;
  return elapsed >= 0 && elapsed < DOUBLE_TAP_MS;
}
