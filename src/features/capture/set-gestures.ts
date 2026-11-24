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
// l'envoi. Les ops d'un geste s'enfilent EN UNE FOIS, par `enqueueAll(ops)`
// (outbox.ts), jamais une à une : le geste est une unité dans la file (tout
// écrit sur l'appareil, ou tout en mémoire), sinon un stockage presque plein
// peut garder la suppression sans la remontée des rangs. L'exécution doit avoir été enfilée avant (`enqueueExecutionOnce`),
// ce qui est acquis dès qu'une série existe.
//
// CORRIGER UNE SÉRIE (`correctSet`). La correction est une écriture partielle
// de MÊME id, `patchSet` avec `only: 'values'` (outbox.ts). En base, seuls
// poids, reps et RIR sont écrits, par un `update` : le rang n'est pas touché,
// et une série supprimée entre-temps n'est pas recréée. Deux gestes faits
// depuis deux onglets (corriger S2 ici, supprimer S1 là, donc remonter S2) ne
// s'écrasent ainsi dans aucun ordre. Un type d'op à part, que le bundle de main
// ne connaît pas : un onglet resté dessus s'arrête sur elle au lieu de la
// rejouer en upsert complet (cf. `PatchSetOp`). L'op porte quand même la ligne
// entière, pour reconstituer une série dont l'insertion a été refusée.
//   - hors ligne, le log puis sa correction tiennent tous deux en file et
//     partent dans l'ordre, la dernière écriture gagne ;
//   - une série dont l'insertion a été refusée par la base (quarantaine) est
//     relevée par sa correction : le flush envoie alors la série ENTIÈRE,
//     reconstituée du refus et de la correction, et lève le refus une fois
//     l'écriture acquittée (outbox.ts, « Séries refusées, puis reprises ») ;
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
// `patchSet` avec `only: 'rank'` par ligne dont le rang a changé (seul le
// rang est écrit, jamais les valeurs). Suppressions d'abord,
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
import type { InsertSetOp, OutboxOp, PatchSetOp } from './outbox';
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

/**
 * L'op qui écrit la série `set` d'id `id`. Sans `only` : upsert complet
 * (`insertSet`). Avec `only` : écriture partielle d'une série existante
 * (`patchSet`, outbox.ts), les valeurs seules ou le rang seul.
 */
export function writeSetOp(state: CaptureState, exerciseId: string, id: string, set: PerformedSet): InsertSetOp;
export function writeSetOp(
  state: CaptureState,
  exerciseId: string,
  id: string,
  set: PerformedSet,
  only: 'values' | 'rank',
): PatchSetOp;
export function writeSetOp(
  state: CaptureState,
  exerciseId: string,
  id: string,
  set: PerformedSet,
  only?: 'values' | 'rank',
): InsertSetOp | PatchSetOp {
  const row = {
    id,
    executionId: state.executionId,
    exerciseId,
    setOrder: set.order,
    weightKg: set.weightKg,
    reps: set.reps,
    rir: set.rir,
    ...(set.side ? { side: set.side } : {}),
  };
  return only ? { type: 'patchSet', ...row, only } : { type: 'insertSet', ...row };
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
    ops: [writeSetOp(state, exerciseId, setId, { ...current, ...next }, 'values')],
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
    id === null || orderBefore.get(id) === set.order ? [] : [writeSetOp(state, exerciseId, id, set, 'rank')],
  );
  return {
    action: { type: 'delete-set', exerciseId, order: target.order },
    ops: [...deletes, ...rewrites],
  };
}
