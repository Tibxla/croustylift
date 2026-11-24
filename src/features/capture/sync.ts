// Câblage outbox -> Supabase, partagé par la capture du jour et l'édition d'une
// séance passée (issue #38).
//
// Le SEUL chemin d'écriture du réalisé est le registre d'écritures (outbox.ts,
// idempotent par id, cf. ADR 0003) + les fonctions de `data.ts`. Ce module expose ce câblage
// (op -> fonction de sync) et un helper pour enfiler puis flusher un lot d'ops,
// pour que l'éditeur de séance passée n'invente PAS un second chemin : il
// produit des `OutboxOp` (via past-session-edit) et les passe à `flushOps`,
// exactement comme la capture du jour passe ses ops à l'outbox.
import {
  deleteExecutionById,
  deleteExecutionIfEmpty,
  deleteSetById,
  exercisesHoldingRows,
  patchSet,
  refreshExerciseRows,
  updateExecution,
  upsertExecution,
  upsertSet,
} from './data';
import {
  upsertDatedNote as upsertDatedNoteRow,
  deleteDatedNoteById,
  deleteDatedNoteByCouple,
  upsertExerciseNoteRow,
  deleteExerciseNoteByExercise,
} from '../notes/data';
import {
  enqueueAll,
  fatesOf,
  flush,
  setFlushRetryRunner,
  type FlushResult,
  type OutboxOp,
  type SyncFns,
} from './outbox';
import { sessionUserId } from '../../lib/session-identity';
import { seedRead } from '../../lib/read-cache';
import { EXERCISE_NOTE_PREFIX } from './plan-copies';

/**
 * Relit en fond les copies d'historique que la passe vient de rendre périmées
 * (cf. `refreshExerciseRows`, ADR 0020). La passe DIT ce qu'elle a acquitté
 * (`FlushResult.settled`) : les exos d'une série écrite, et pour une suppression
 * ceux que l'émetteur a nommés ou que le registre retient encore pour cette
 * série ou cette exécution (`touches`). S'y ajoutent les copies qui CONTIENNENT
 * la ligne supprimée (`exercisesHoldingRows`) : la série a pu être faite
 * ailleurs, ou acquittée depuis plus longtemps que le registre ne la garde.
 * Les autres copies ne sont ni relues ni marquées d'un seuil : la réponse
 * tardive d'un exo sans rapport reste valide. Les écritures d'exécution
 * (création, clôture, métriques) ne touchent aucune copie.
 *
 * Sans attendre : la capture ne dépend pas du retour de cette lecture, et un
 * échec réseau laisse simplement la copie. Une passe partagée par plusieurs
 * appelants (flush mémoïsé) n'est relue qu'une fois.
 */
const refreshed = new WeakSet<FlushResult>();
function refreshTouchedHistory(result: FlushResult): void {
  if (refreshed.has(result)) return;
  refreshed.add(result);
  const touched = new Set<string>();
  const deleted = { setIds: [] as string[], executionIds: [] as string[] };
  for (const write of result.settled) {
    if (write.fate !== 'acked') continue;
    for (const exerciseId of write.touches) touched.add(exerciseId);
    // Suppression conditionnelle que la base n'a pas faite : rien n'a changé.
    if (write.noEffect) continue;
    if (write.op.type === 'deleteSet') deleted.setIds.push(write.op.id);
    else if (write.op.type === 'deleteExecution' || write.op.type === 'deleteExecutionIfEmpty') {
      deleted.executionIds.push(write.op.id);
    }
  }
  if (deleted.setIds.length > 0 || deleted.executionIds.length > 0) {
    for (const exerciseId of exercisesHoldingRows(deleted)) touched.add(exerciseId);
  }
  if (touched.size > 0) void refreshExerciseRows([...touched]);
}

/**
 * Une note d'instructions vient d'être acquittée : son corps est posé dans la
 * copie locale de l'exo. Tant que l'op attendait, la Capture la lisait dans la
 * file (`applyPendingExerciseNote`) ; une fois sortie de la file, sans cette
 * écriture, la copie d'avant reprenait la main au remontage suivant. Le seuil
 * posé avec (`seedRead`) écarte une revalidation partie avant l'acquittement.
 *
 * `writer` : le compte de la session, relevé AVANT la requête. La copie n'est
 * écrite que si l'appareil reconnaît encore ce compte ; sans session lisible
 * (`null`), rien n'est écrit. Sans lecteur posé (`undefined`, tests), la copie
 * va au compte reconnu.
 */
function rememberExerciseNote(
  exerciseId: string,
  body: string,
  writer: string | null | undefined,
): void {
  if (writer === null) return;
  seedRead(`${EXERCISE_NOTE_PREFIX}${exerciseId}`, body, writer);
}

/**
 * Les fonctions de sync réelles consommées par `flush` : une par type d'op,
 * toutes idempotentes par id (cf. data.ts). C'est l'unique point de couplage
 * entre l'outbox (logique pure) et Supabase.
 */
export const syncFns: SyncFns = {
  upsertExecution: (op) =>
    upsertExecution({
      id: op.id,
      seanceVersionId: op.seanceVersionId,
      performedOn: op.performedOn,
      startedAt: op.startedAt,
    }),
  // Écriture partielle (correction : valeurs seules ; remontée : rang seul) :
  // un `update` qui ne recrée jamais la ligne (cf. `PatchSetOp`, outbox.ts).
  patchSet: async (op) => {
    await patchSet(
      op.only === 'values'
        ? { id: op.id, only: 'values', weightKg: op.weightKg, reps: op.reps, rir: op.rir, cols: op.cols }
        : { id: op.id, only: 'rank', setOrder: op.setOrder },
    );
  },
  insertSet: async (op) => {
    await upsertSet({
      id: op.id,
      executionId: op.executionId,
      exerciseId: op.exerciseId,
      setOrder: op.setOrder,
      weightKg: op.weightKg,
      reps: op.reps,
      rir: op.rir,
      // Côté unilatéral (ADR 0005) : porté jusqu'à la base pour ne pas écraser
      // `side` à null et dé-apparier G/D quand on édite une exécution passée.
      side: op.side,
    });
  },
  deleteSet: async (op) => {
    await deleteSetById(op.id);
  },
  updateExecution: async (op) => {
    // Le nombre de lignes touchées n'est pas un critère d'échec (cf. data.ts,
    // « LIGNES TOUCHÉES ») : 0 = exécution absente de la base, rien à clore.
    await updateExecution({
      id: op.id,
      bpmAvg: op.bpmAvg,
      durationMin: op.durationMin,
      closedAt: op.closedAt,
    });
  },
  upsertDatedNote: (op) =>
    upsertDatedNoteRow({
      id: op.id,
      executionId: op.executionId,
      exerciseId: op.exerciseId,
      body: op.body,
    }),
  // Effacement par COUPLE (exécution, exercice), l'identité de la note en base ;
  // par id pour une op d'un bundle antérieur, qui ne porte que lui.
  deleteDatedNote: async (op) => {
    if (op.executionId !== undefined && op.exerciseId !== undefined) {
      await deleteDatedNoteByCouple(op.executionId, op.exerciseId);
    } else {
      await deleteDatedNoteById(op.id);
    }
  },
  // Note d'instructions (issue #52, blind F3) : l'`id` de l'op porte l'`exerciseId`
  // (clé idempotente, 1 note par user+exo). Le corps est déjà normalisé en amont.
  upsertExerciseNote: async (op) => {
    const writer = await sessionUserId();
    await upsertExerciseNoteRow({ exerciseId: op.id, body: op.body });
    rememberExerciseNote(op.id, op.body, writer);
  },
  deleteExerciseNote: async (op) => {
    const writer = await sessionUserId();
    await deleteExerciseNoteByExercise(op.id);
    rememberExerciseNote(op.id, '', writer);
  },
  deleteExecution: async (op) => {
    await deleteExecutionById(op.id);
  },
  // Suppression conditionnelle (« Changer de séance ») : la passe apprend si la
  // base a réellement supprimé l'exécution, et ne relit les copies que dans ce cas.
  deleteExecutionIfEmpty: (op) => deleteExecutionIfEmpty(op.id),
};

/** Ce qu'il advient d'un lot d'ops soumis par `flushOps`. */
export interface OpsFlushResult extends FlushResult {
  /** De NOS écritures, celles qui attendent encore (réseau, session). */
  pending: number;
  /** De NOS écritures, celles que la base a refusées ou retient : elles ne partiront pas seules. */
  refused: number;
}

/**
 * Enfile un lot d'écritures, d'un seul tenant et dans l'ordre, puis tente un
 * envoi immédiat. Elles sont durables dès l'enfilement : même si l'envoi échoue
 * (hors ligne), elles remonteront au prochain, comme la capture du jour.
 *
 * Le résultat ne compte QUE NOS écritures, par le SORT que le registre leur
 * donne (`fatesOf`), PAS par le `remaining` GLOBAL de la passe (BUG M4) : le
 * flush est mémoïsé, et une passe déjà en vol rend un résultat d'avant notre
 * enfilement. `pending` et `refused` sont rendus À PART : une correction que la
 * base a refusée n'est pas une correction qui attend le réseau. `remaining`
 * reste leur somme (rien de nous n'est en base tant qu'il n'est pas nul).
 *
 * Une écriture refusée puis ÉCARTÉE au profit d'une plus récente de la même
 * série a le sort de sa remplaçante : tant que celle-ci attend, la nôtre
 * n'est pas sauvegardée. Avant, elle n'était plus ni en file ni en quarantaine,
 * et l'éditeur de séance passée annonçait une sauvegarde.
 */
export async function flushOps(ops: OutboxOp[]): Promise<OpsFlushResult> {
  const ours = enqueueAll(ops);
  // On attend la passe (la nôtre ou une déjà en vol) pour laisser le temps à nos
  // écritures d'être tentées, mais on ne se fie pas à son `remaining` global.
  const { flushed, settled } = await flushOutbox();
  const fates = fatesOf(ours);
  const pending = fates.filter((fate) => fate === 'pending').length;
  const refused = fates.filter((fate) => fate === 'refused').length;
  return { remaining: pending + refused, pending, refused, flushed, settled };
}

/**
 * Flush GLOBAL de la file, sans rien enfiler. Câblé au niveau de l'app (montage
 * + retour réseau, cf. App.tsx) pour que TOUTE op en attente — capture du jour,
 * correction ou suppression d'une séance passée — remonte au retour du réseau,
 * quel que soit l'onglet monté. Avant ce point, seul `CaptureBoard` déclenchait
 * un flush au montage / 'online' : une suppression faite depuis l'Analyse en
 * offline restait en file tant qu'on ne passait pas en Capture (« delete
 * zombie » au reload). Renvoie le résultat du flush (combien restent / passées).
 *
 * C'est aussi le point de passage de TOUS les flush (Capture, journal, App) :
 * après la passe, même arrêtée sur un échec, les copies d'historique des séries
 * acquittées sont relues (`refreshTouchedHistory`).
 */
export function flushOutbox() {
  // Le lecteur de session ferme la porte aux écritures sans compte vérifié : sans
  // session, une requête part sous la clé publique et un `update`/`delete` est
  // « acquitté » sans avoir touché de ligne (cf. `runFlush`, outbox.ts).
  return flush(syncFns, sessionUserId).then((result) => {
    refreshTouchedHistory(result);
    return result;
  });
}

// Un essai reprogrammé après un verrou occupé (cf. outbox) passe par le flush de
// l'app, pour que les copies d'historique acquittées soient relues comme après
// toute autre passe.
setFlushRetryRunner(flushOutbox);
