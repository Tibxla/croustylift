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
  deleteSetById,
  updateExecution,
  upsertExecution,
  upsertSet,
} from './data';
import {
  upsertDatedNote as upsertDatedNoteRow,
  deleteDatedNoteById,
} from '../notes/data';
import { enqueue, flush, type OutboxOp, type SyncFns } from './outbox';

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
    }),
  deleteSet: (op) => deleteSetById(op.id),
  updateExecution: (op) =>
    updateExecution({ id: op.id, bpmAvg: op.bpmAvg, durationMin: op.durationMin }),
  upsertDatedNote: (op) =>
    upsertDatedNoteRow({
      id: op.id,
      executionId: op.executionId,
      exerciseId: op.exerciseId,
      body: op.body,
    }),
  deleteDatedNote: (op) => deleteDatedNoteById(op.id),
};

/**
 * Enfile un lot d'ops (dans l'ordre) puis tente un flush immédiat. Les ops sont
 * durables dès l'enqueue (localStorage) : même si le flush échoue (offline),
 * elles remonteront au prochain flush — comme la capture du jour. Renvoie le
 * résultat du flush (combien restent / ont été synchronisées).
 */
export async function flushOps(ops: OutboxOp[]) {
  for (const op of ops) enqueue(op);
  return flush(syncFns);
}
