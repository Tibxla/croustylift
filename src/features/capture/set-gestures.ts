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
//
// SUPPRIMER UNE SÉRIE (`deleteSet`), n'importe laquelle. On désigne une ligne par
// son id ; c'est sa série LOGIQUE qui part : en unilatéral, la gauche ET la
// droite (c'est ce que dit la confirmation à l'écran). Les rangs des séries
// suivantes suivent LA règle de `ranksAfterDeletion` (set-ranks.ts : remontée
// par défaut, ADR 0024 proposé ; une constante à changer pour laisser un trou).
// Écritures, dans cet ordre : un `deleteSet` par ligne supprimée, PUIS un
// `insertSet` (upsert) par ligne dont le rang a changé. Suppressions d'abord,
// comme dans l'éditeur de séance passée : le flush peut s'interrompre entre
// deux ops, et aucune série gardée ne doit partager un rang avec celle qui s'en
// va. Aucune unicité ne porte sur le rang en base. Une ligne sans id (cache
// d'ancien format) est retirée ou renumérotée à l'écran sans écriture.
// « Annuler la dernière série » (`undo-last-set`) reste le geste d'une touche
// juste après un log ; en unilatéral il ne retire que le dernier côté saisi.
//
// Réponse tardive de la base : une série corrigée, renumérotée ou supprimée ici
// pendant le trajet d'une lecture garde son état local à l'arrivée de la
// réponse, que ses écritures soient encore en file ou déjà acquittées
// (`reconcileProgress` et le cas `reconcile-progress` du réducteur, state.ts).

import type { PerformedSet } from '../../domain/types';
import type { InsertSetOp, OutboxOp } from './outbox';
import { RANK_POLICY_AFTER_DELETION, ranksAfterDeletion } from './set-ranks';
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

export { RANK_POLICY_AFTER_DELETION, ranksAfterDeletion, type RankPolicy } from './set-ranks';

/**
 * Supprime la série à laquelle appartient la ligne d'id `setId` dans l'exo
 * `exerciseId` (cf. en-tête). `null` si aucune ligne de cet exo ne porte cet id.
 */
export function deleteSet(state: CaptureState, exerciseId: string, setId: string): SetGesture | null {
  const progress = getProgress(state, exerciseId);
  const index = progress.setIds.indexOf(setId);
  const target = index === -1 ? undefined : progress.sets[index];
  if (target === undefined) return null;

  const rows = progress.sets.map((set, i) => ({ set, id: progress.setIds[i] ?? null }));
  const removed = rows.filter((row) => row.set.order === target.order);
  const after = ranksAfterDeletion(
    rows.map((row) => ({ ...row.set, id: row.id })),
    target.order,
    RANK_POLICY_AFTER_DELETION,
  );
  const orderBefore = new Map(rows.map((row) => [row.id, row.set.order] as const));

  const deletes: OutboxOp[] = removed.flatMap((row) =>
    // L'exo est connu ici : l'op le porte pour la relecture de sa copie locale.
    row.id === null ? [] : [{ type: 'deleteSet' as const, id: row.id, exerciseIds: [exerciseId] }],
  );
  const rewrites: OutboxOp[] = after.flatMap(({ id, ...set }) =>
    id === null || orderBefore.get(id) === set.order ? [] : [writeSetOp(state, exerciseId, id, set)],
  );
  return {
    action: { type: 'delete-set', exerciseId, order: target.order },
    ops: [...deletes, ...rewrites],
  };
}
