// Gestes sur les SÉRIES de la séance en cours, hors du simple « logger » :
// corriger une série, où qu'elle soit dans l'exo. Logique pure, sans React ni
// réseau.
//
// API pour l'écran. Chaque geste est une fonction
//
//     geste(état, arguments) -> { action, ops } | null
//
// - `action` : à passer au réducteur (`captureReducer`, state.ts) ;
// - `ops` : les écritures à enfiler dans la file (`enqueue`, outbox.ts), dans
//   l'ordre rendu ;
// - `null` : rien à faire (série inconnue, valeurs inchangées), l'écran ne
//   dispatche ni n'enfile rien.
// L'écran enchaîne comme pour un log (`handleLog`, CaptureScreen) : lire la
// projection synchrone de l'état, calculer le geste dessus, dispatcher l'action,
// avancer la projection par le même réducteur, puis enfiler les ops et lancer
// l'envoi. L'exécution doit avoir été enfilée avant (`enqueueExecutionOnce`),
// ce qui est acquis dès qu'une série existe.
//
// CORRIGER UNE SÉRIE (`correctSet`). Il n'y a pas d'écriture « mise à jour » : la
// base écrit une série par `upsert` sur son id (`upsertSet`, capture/data.ts), et
// l'éditeur de séance passée corrige déjà ainsi. La correction est donc une op
// `insertSet` de MÊME id, même rang, même côté, aux nouvelles valeurs :
//   - hors ligne, le log puis sa correction tiennent tous deux en file et
//     partent dans l'ordre, la dernière écriture gagne ;
//   - une série dont l'insertion a été refusée par la base (quarantaine) est
//     relevée par sa correction : l'enfilement retire l'écriture refusée de la
//     même série (`enqueue`, outbox.ts) ;
//   - la Référence fusionnée (`applyPendingSets`) et la reprise
//     (`applyQueuedSets`) remplacent déjà une série par son id.
// Les badges (battue, égalée, record) ne sont pas stockés : ils se recalculent
// des séries (`computeSetBadges`, set-badges.ts), donc suivent la correction.
// Unilatéral : chaque côté est une ligne, avec son id. Corriger un côté ne
// touche ni l'autre ni le rang de la série.

import type { PerformedSet } from '../../domain/types';
import type { InsertSetOp, OutboxOp } from './outbox';
import { boundSetValues } from './stepper-utils';
import { getProgress, type CaptureAction, type CaptureState } from './state';

/** Ce qu'un geste demande à l'écran : une action pour le réducteur, des écritures pour la file. */
export interface SetGesture {
  action: CaptureAction;
  ops: OutboxOp[];
}

/** Les valeurs saisies d'une série (ce que la feuille de correction règle). */
export type SetEntry = Pick<PerformedSet, 'weightKg' | 'reps' | 'rir'>;

/** L'op qui écrit (ou réécrit) la série `set` d'id `id` : upsert par id, rang et côté compris. */
export function writeSetOp(
  state: CaptureState,
  exerciseId: string,
  id: string,
  set: PerformedSet,
): InsertSetOp {
  return {
    type: 'insertSet',
    id,
    executionId: state.executionId,
    exerciseId,
    setOrder: set.order,
    weightKg: set.weightKg,
    reps: set.reps,
    rir: set.rir,
    ...(set.side ? { side: set.side } : {}),
  };
}

/**
 * Corrige la série d'id `setId` de l'exo `exerciseId` : poids, reps et RIR. Son
 * rang, son côté et son id ne changent pas. Les valeurs sont bornées comme au
 * log (`boundSetValues`). `null` si la série n'existe pas dans cet exo, si elle
 * n'a pas d'id (cache d'ancien format, rien à viser en base) ou si rien ne
 * change.
 */
export function correctSet(
  state: CaptureState,
  exerciseId: string,
  setId: string,
  values: SetEntry,
): SetGesture | null {
  const progress = getProgress(state, exerciseId);
  const index = progress.setIds.indexOf(setId);
  const current = index === -1 ? undefined : progress.sets[index];
  if (current === undefined) return null;
  const next = boundSetValues({ weightKg: values.weightKg, reps: values.reps, rir: values.rir });
  if (next.weightKg === current.weightKg && next.reps === current.reps && next.rir === current.rir) {
    return null;
  }
  return {
    action: { type: 'correct-set', exerciseId, setId, values: next },
    ops: [writeSetOp(state, exerciseId, setId, { ...current, ...next })],
  };
}
