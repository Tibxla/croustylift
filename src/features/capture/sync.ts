// Câblage outbox -> Supabase, partagé par la capture du jour et l'édition d'une
// séance passée (issue #38).
//
// Le SEUL chemin d'écriture du réalisé est l'outbox (FIFO, idempotent par id,
// cf. ADR 0003) + les fonctions de `data.ts`. Ce module expose ce câblage
// (op -> fonction de sync) et un helper pour enfiler puis flusher un lot d'ops,
// pour que l'éditeur de séance passée n'invente PAS un second chemin : il
// produit des `OutboxOp` (via past-session-edit) et les passe à `flushOps`,
// exactement comme la capture du jour passe ses ops à l'outbox.
import {
  deleteExecutionById,
  deleteSetById,
  updateExecution,
  upsertExecution,
  upsertSet,
} from './data';
import {
  upsertDatedNote as upsertDatedNoteRow,
  deleteDatedNoteById,
  upsertExerciseNoteRow,
  deleteExerciseNoteByExercise,
} from '../notes/data';
import { enqueue, flush, readQueue, type FlushResult, type OutboxOp, type SyncFns } from './outbox';

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
    }),
  insertSet: (op) =>
    upsertSet({
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
    }),
  deleteSet: (op) => deleteSetById(op.id),
  updateExecution: (op) =>
    updateExecution({
      id: op.id,
      bpmAvg: op.bpmAvg,
      durationMin: op.durationMin,
      closedAt: op.closedAt,
    }),
  upsertDatedNote: (op) =>
    upsertDatedNoteRow({
      id: op.id,
      executionId: op.executionId,
      exerciseId: op.exerciseId,
      body: op.body,
    }),
  deleteDatedNote: (op) => deleteDatedNoteById(op.id),
  // Note d'instructions (issue #52, blind F3) : l'`id` de l'op porte l'`exerciseId`
  // (clé idempotente, 1 note par user+exo). Le corps est déjà normalisé en amont.
  upsertExerciseNote: (op) =>
    upsertExerciseNoteRow({ exerciseId: op.id, body: op.body }),
  deleteExerciseNote: (op) => deleteExerciseNoteByExercise(op.id),
  deleteExecution: (op) => deleteExecutionById(op.id),
};

/**
 * Enfile un lot d'ops (dans l'ordre) puis tente un flush immédiat. Les ops sont
 * durables dès l'enqueue (localStorage) : même si le flush échoue (offline),
 * elles remonteront au prochain flush — comme la capture du jour.
 *
 * Renvoie un `remaining` qui ne compte QUE NOS ops (les ids qu'on vient
 * d'enfiler) encore présentes après la passe — PAS le `remaining` GLOBAL du
 * `FlushResult` (BUG M4). Pourquoi : `flush` est mémoïsé (un seul flush à la fois,
 * cf. outbox). Si une passe est déjà en vol, `flush(syncFns)` renvoie SA promesse,
 * dont le `remaining` reflète l'état AU LANCEMENT de cette passe — avant qu'on
 * enfile nos ops. Il pourrait donc valoir `0` alors que NOS ops dorment encore en
 * file (faux succès → l'éditeur de séance se fermerait à tort). En recomptant nos
 * propres ids dans `readQueue()` après l'attente, on obtient l'état réel des ops
 * qu'on a soumises, indépendamment de la passe qui a effectivement tourné.
 * `flushed` reste celui de la passe (best-effort, purement indicatif).
 */
export async function flushOps(ops: OutboxOp[]): Promise<FlushResult> {
  const ourIds = new Set(ops.map((op) => op.id));
  for (const op of ops) enqueue(op);
  // On attend la passe (qu'elle soit la nôtre ou une déjà en vol) pour laisser le
  // temps à nos ops d'être tentées, mais on ne se fie pas à son `remaining` global.
  const { flushed } = await flush(syncFns);
  // `remaining` PROPRE : combien de NOS ids restent réellement en file maintenant.
  const remaining = readQueue().filter((op) => ourIds.has(op.id)).length;
  return { remaining, flushed };
}

/**
 * Flush GLOBAL de la file, sans rien enfiler. Câblé au niveau de l'app (montage
 * + retour réseau, cf. App.tsx) pour que TOUTE op en attente — capture du jour,
 * correction ou suppression d'une séance passée — remonte au retour du réseau,
 * quel que soit l'onglet monté. Avant ce point, seul `CaptureBoard` déclenchait
 * un flush au montage / 'online' : une suppression faite depuis l'Analyse en
 * offline restait en file tant qu'on ne passait pas en Capture (« delete
 * zombie » au reload). Renvoie le résultat du flush (combien restent / passées).
 */
export function flushOutbox() {
  return flush(syncFns);
}
