// Ce que les autres onglets ont écrit sous la Salle cachée, et ce qu'elle en
// fait à son retour.
//
// POURQUOI. La Salle reste montée, cachée, quand on change d'onglet
// (shell/surface-memory.ts). Avant, elle était démontée, et son retour relisait
// tout : la séance, ses séries, les définitions de ses exos. Gardée montée, elle
// tenait un tableau périmé quand le Journal corrigeait ou supprimait la séance en
// cours : séries effacées encore affichées, rang suivant calculé dessus, état
// supprimé réécrit par la persistance, série suivante envoyée vers une exécution
// supprimée sans que l'exécution soit réaffirmée (elle ne l'est qu'une fois par
// montage du tableau). De même pour un exo ou une séance modifiés dans Exos ou
// Séances pendant une séance ouverte.
//
// LE MÉCANISME. L'écrivain pose un marqueur ici, au moment où il enfile son
// écriture (avant l'envoi : une écriture en attente est déjà durable). La Salle
// le lit à son retour (`salleReturnAction`) et relance alors son chargement
// complet, comme un remontage : nouveau tableau, donc réalisé établi sur la base
// et les écritures locales, et exécution réaffirmée avant la série suivante.
// Le chargement efface les marqueurs qu'il rend caducs (`forgetPendingWrites`).
//
// Une exécution SUPPRIMÉE reste en plus retirée pour la vie de l'app : plus
// aucun état de capture ne s'écrit sous son id (`persist`, state.ts), même par
// le tableau caché qui la tenait encore.
//
// Module sans import : la Salle (chunk critique), le Journal et les écritures
// du plan (chunks paresseux) le partagent sans rien s'entraîner.

/** Ce qu'un autre onglet a fait d'une exécution. */
export type ExecutionWrite = 'corrected' | 'deleted';

/** Les exécutions écrites ailleurs depuis le dernier chargement de la Salle. */
const pendingExecutions = new Map<string, ExecutionWrite>();
/** Une définition d'exo ou de séance a été écrite depuis le dernier chargement. */
let definitionsPending = false;
/** Les exécutions supprimées ailleurs : plus jamais persistées. */
const retired = new Set<string>();

/** Le Journal enfile une correction de l'exécution `id` (séries, notes, métriques). */
export function markExecutionCorrected(id: string): void {
  if (pendingExecutions.get(id) === 'deleted') return;
  pendingExecutions.set(id, 'corrected');
}

/** Le Journal enfile la suppression de l'exécution `id`. */
export function markExecutionDeleted(id: string): void {
  retired.add(id);
  pendingExecutions.set(id, 'deleted');
}

/** Un exo (nom, unilatéral, note) ou le plan (séance, version, routine) vient d'être écrit. */
export function markDefinitionsWritten(): void {
  definitionsPending = true;
}

/** L'exécution `id` a été supprimée ailleurs : son état ne doit plus s'écrire. */
export function isExecutionRetired(id: string): boolean {
  return retired.has(id);
}

/** Le chargement de la Salle commence : il relit tout, les marqueurs en cours sont caducs. */
export function forgetPendingWrites(): void {
  pendingExecutions.clear();
  definitionsPending = false;
}

/** Ce que la Salle voit à son retour. */
export interface SalleAtReturn {
  phase: 'loading' | 'choosing' | 'error' | 'empty' | 'ready';
  /** Séance ouverte déjà clôturée (récap transitoire, ADR 0009). */
  closed: boolean;
  /** L'exécution du tableau monté (phase « ready »), sinon `null`. */
  executionId: string | null;
}

/**
 * Ce que fait la Salle quand elle réapparaît :
 *   - `keep` : rien, la séance ouverte se retrouve telle quelle (exo, série
 *     visée, côté, brouillon) ;
 *   - `reload` : chargement complet, comme l'ancien remontage ;
 *   - `forget-and-reload` : son exécution a été supprimée ailleurs ; son état
 *     local est effacé encore une fois, puis chargement complet, qui ramène sur
 *     « Quelle séance ? ».
 *
 * Sans séance ouverte (choix, rien à logger, erreur) ou une fois la séance
 * rangée, elle relit toujours. Une séance ouverte ne relit que si son exécution
 * ou une définition a été écrite ailleurs : corriger une vieille séance au
 * Journal ne lui coûte pas son brouillon. En plein chargement, rien : le
 * marqueur reste et sert au retour suivant.
 */
export function salleReturnAction(at: SalleAtReturn): 'keep' | 'reload' | 'forget-and-reload' {
  if (at.phase === 'loading') return 'keep';
  if (at.phase !== 'ready') return 'reload';
  if (at.executionId !== null && pendingExecutions.get(at.executionId) === 'deleted') return 'forget-and-reload';
  if (at.closed) return 'reload';
  if (at.executionId !== null && pendingExecutions.has(at.executionId)) return 'reload';
  if (definitionsPending) return 'reload';
  return 'keep';
}

/**
 * La clé React du tableau de capture. Elle change à chaque chargement
 * (`generation`) : un rechargement remonte TOUJOURS le tableau, même sur la même
 * exécution et même quand tout se lit sur les copies locales (React regrouperait
 * alors « chargement » et « prêt », et le tableau resterait monté avec son état
 * et ses refs). L'adoption tardive d'une autre exécution garde la génération et
 * change d'id : elle remonte aussi.
 */
export function captureBoardKey(load: { templateId: string; executionId: string; generation: number }): string {
  return `${load.templateId}:${load.executionId}:${load.generation}`;
}
