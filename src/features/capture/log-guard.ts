// Garde contre le double toucher de « Logger » (audit UX du 24/11, n° 3).
//
// Un rebond de doigt ou un toucher appuyé, sur le geste répété des centaines de
// fois, devenait une seconde série : `handleLog` part exprès de l'état projeté
// pour que deux taps rapprochés voient la 1ʳᵉ série posée (bug M6), donc le
// second tap était rangé comme une vraie série.
//
// La règle (décision du 24/11), sur le MÊME exo :
//   - même côté (ou bilatéral) : un second Logger à moins de 600 ms est ignoré,
//     quelles que soient ses valeurs. Comparer les valeurs ne suffit pas :
//     l'écran se réamorce en une ou deux images après le premier Logger (RIR
//     repris de la Référence du rang suivant) ;
//   - côté basculé (unilatéral : gauche loggée, la droite est proposée) : à
//     moins de 250 ms seulement. Un rebond reste sous 150 ms, alors que logger
//     gauche puis droite coup sur coup, après avoir fait les deux côtés, est un
//     vrai usage.
// Plus espacés, deux Logger restent deux séries. Aucune animation : le bouton ne
// réagit simplement pas au rebond. Pur, horloge injectée.
import type { Side } from '../../domain/types';

export const DOUBLE_TAP_MS = 600;
export const SIDE_SWITCH_TAP_MS = 250;

/** Un Logger : l'exo, le côté (absent en bilatéral) et l'instant (ms, horloge monotone). */
export interface LogStamp {
  exerciseId: string;
  side: Side | undefined;
  at: number;
}

/** `next` est-il un rebond du dernier Logger pris en compte (`prev`) ? */
export function isDoubleTap(prev: LogStamp | null, next: LogStamp): boolean {
  if (prev === null || prev.exerciseId !== next.exerciseId) return false;
  const elapsed = next.at - prev.at;
  const window = prev.side === next.side ? DOUBLE_TAP_MS : SIDE_SWITCH_TAP_MS;
  return elapsed >= 0 && elapsed < window;
}
