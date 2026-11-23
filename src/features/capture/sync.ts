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
  exercisesHoldingRows,
  refreshExerciseRows,
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
import { sessionUserId } from '../../lib/session-identity';

// Exos dont l'historique des séries vient de changer EN BASE (ops acquittées
// depuis la dernière relecture). `flush` ne dit pas quelles ops sont passées :
// chaque fonction de sync le note ici après son succès, et `flushOutbox` relit
// les copies locales concernées une fois la passe finie. Les ops d'exécution
// (`upsertExecution`, `updateExecution`) n'y figurent pas : la copie ne porte
// ni clôture ni métriques de fin, et la date d'une exécution ne change jamais
// après coup (elle arrive avec ses premières séries, qui déclenchent la relecture).
const touchedExercises = new Set<string>();
// Les séries acquittées PAR CETTE SESSION : de quel exo et de quelle exécution.
// Une suppression ne porte que l'id de sa ligne ; on retrouve ses exos dans les
// copies qui la CONTIENNENT (`exercisesHoldingRows`), mais une série tout juste
// acquittée peut ne pas y être encore (sa relecture est en vol, et sa réponse
// la ramènerait après coup) : cette mémoire désigne alors son exo. Bornée à la
// session (quelques dizaines d'ids), jamais persistée.
const ackedSets = new Map<string, { exerciseId: string; executionId: string }>();

/**
 * Une suppression vient d'être acquittée : marque à relire les seuls exos
 * concernés (copies qui contiennent la ligne, plus la mémoire de session). Les
 * autres copies ne sont ni relues ni marquées d'un seuil : la réponse tardive
 * d'un exo sans rapport reste valide.
 */
function touchDeleted(deleted: { setIds: string[]; executionIds: string[] }): void {
  for (const exerciseId of exercisesHoldingRows(deleted)) touchedExercises.add(exerciseId);
  for (const [setId, acked] of ackedSets) {
    if (deleted.setIds.includes(setId) || deleted.executionIds.includes(acked.executionId)) {
      touchedExercises.add(acked.exerciseId);
      ackedSets.delete(setId);
    }
  }
}

/**
 * Relit en fond les copies d'historique que la passe vient de rendre périmées
 * (cf. `refreshExerciseRows`). Sans attendre : la capture ne dépend pas du
 * retour de cette lecture, et un échec réseau laisse simplement la copie.
 */
function refreshTouchedHistory(): void {
  if (touchedExercises.size === 0) return;
  const target = [...touchedExercises];
  touchedExercises.clear();
  void refreshExerciseRows(target);
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
    touchedExercises.add(op.exerciseId);
    ackedSets.set(op.id, { exerciseId: op.exerciseId, executionId: op.executionId });
  },
  deleteSet: async (op) => {
    await deleteSetById(op.id);
    touchDeleted({ setIds: [op.id], executionIds: [] });
  },
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
  deleteExecution: async (op) => {
    await deleteExecutionById(op.id);
    touchDeleted({ setIds: [], executionIds: [op.id] });
  },
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
  const { flushed } = await flushOutbox();
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
 *
 * C'est aussi le point de passage de TOUS les flush (Capture, journal, App) :
 * après la passe, même arrêtée sur un échec, les copies d'historique des séries
 * acquittées sont relues (`refreshTouchedHistory`).
 */
export function flushOutbox() {
  // Le lecteur de session ferme la porte aux écritures sans compte vérifié : sans
  // session, une requête part sous la clé publique et un `update`/`delete` est
  // « acquitté » sans avoir touché de ligne (cf. `runFlushOnce`).
  return flush(syncFns, sessionUserId).finally(refreshTouchedHistory);
}
