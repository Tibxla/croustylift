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
