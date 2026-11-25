// Ce que montre l'Analyse selon la page de sa pile et l'état de la lecture de
// son aperçu (courbes, mesures, plan). Pur, testé.
//
// La correction d'une séance passée (`edit`) lit sa propre exécution
// (`PastSessionEditor`) : elle ne dépend pas de l'aperçu. Une coupure réseau
// repasse l'aperçu à `offline` quand l'appareil n'en a pas de copie (évincée,
// ou jamais écrite faute de place) ; si l'écran d'attente remplaçait alors la
// correction, il la démontait et le brouillon en mémoire disparaissait sans
// confirmation.
import type { DatedState } from '../../lib/dated-read';

/** Les pages de la pile de l'Analyse. */
export type AnalysisPage = 'index' | 'exo' | 'compare' | 'seance' | 'edit';

/** 'page' : la page de la pile ; sinon l'écran d'attente de l'aperçu. */
export type AnalysisFrame = 'page' | 'loading' | 'offline' | 'error';

export function analysisFrame(page: AnalysisPage, overview: DatedState<unknown>['phase']): AnalysisFrame {
  if (page === 'edit' || overview === 'ready') return 'page';
  return overview;
}

/**
 * Ce que dit la page d'une séance du journal, d'après ce qu'en sait la vue :
 *   - absente d'une COPIE, en ligne : elle est sans doute plus récente que la
 *     copie, la relecture l'apporte (`waiting`) ; passé `late` (aucune relecture
 *     arrivée en COPY_LATE_MS), l'attente cesse et l'écran propose de réessayer
 *     (`late`) au lieu de rester sur « Chargement… » sans limite ;
 *   - absente d'une copie, hors ligne : plus récente qu'elle (`newer-offline`) ;
 *   - absente d'une lecture réseau : supprimée (`missing`).
 */
export type SeanceLookup = 'entry' | 'waiting' | 'late' | 'newer-offline' | 'missing';

export function seanceLookup({ found, copy, online, late }: { found: boolean; copy: boolean; online: boolean; late: boolean }): SeanceLookup {
  if (found) return 'entry';
  if (copy && online) return late ? 'late' : 'waiting';
  if (copy) return 'newer-offline';
  return 'missing';
}
