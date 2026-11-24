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
  enqueueTracked,
  flush,
  setFlushRetryRunner,
  pendingAmong,
  refusedAmong,
  type FlushResult,
  type OutboxOp,
  type SyncFns,
} from './outbox';
import { sessionUserId } from '../../lib/session-identity';
import { seedRead } from '../../lib/read-cache';
import { REALISED_VIEWS, refreshMountedViews } from '../../lib/dated-read';
import { EXERCISE_NOTE_PREFIX } from './plan-copies';

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
// Une écriture du réalisé (série, séance supprimée, métriques de fin) a été
// acquittée depuis la dernière passe : les vues montées de l'Analyse sont à
// relire (`refreshMountedViews`, lib/dated-read).
let realisedTouched = false;

/**
 * Une suppression vient d'être acquittée : marque à relire les seuls exos
 * concernés (copies qui contiennent la ligne, plus la mémoire de session). Les
 * autres copies ne sont ni relues ni marquées d'un seuil : la réponse tardive
 * d'un exo sans rapport reste valide.
 */
function touchDeleted(
  deleted: { setIds: string[]; executionIds: string[] },
  named: readonly string[] = [],
): void {
  // Les exos que l'émetteur de l'op a nommés (`exerciseIds`) : la ligne peut
  // n'être dans aucune copie ni dans la mémoire de session (série faite
  // ailleurs, copie en retard) alors qu'une revalidation partie avant la
  // suppression la ramènerait. Le seuil posé par la relecture l'en empêche.
  for (const exerciseId of named) touchedExercises.add(exerciseId);
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
  if (realisedTouched) {
    realisedTouched = false;
    refreshMountedViews(REALISED_VIEWS);
  }
  if (touchedExercises.size === 0) return;
  const target = [...touchedExercises];
  touchedExercises.clear();
  void refreshExerciseRows(target);
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
        ? { id: op.id, only: 'values', weightKg: op.weightKg, reps: op.reps, rir: op.rir }
        : { id: op.id, only: 'rank', setOrder: op.setOrder },
    );
    touchedExercises.add(op.exerciseId);
    ackedSets.set(op.id, { exerciseId: op.exerciseId, executionId: op.executionId });
    realisedTouched = true;
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
    touchedExercises.add(op.exerciseId);
    ackedSets.set(op.id, { exerciseId: op.exerciseId, executionId: op.executionId });
    realisedTouched = true;
  },
  deleteSet: async (op) => {
    await deleteSetById(op.id);
    touchDeleted({ setIds: [op.id], executionIds: [] }, op.exerciseIds);
    realisedTouched = true;
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
    // Durée et BPM : les mesures de séance de l'Analyse.
    realisedTouched = true;
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
    touchDeleted({ setIds: [], executionIds: [op.id] }, op.exerciseIds);
    realisedTouched = true;
  },
  // Suppression conditionnelle (« Changer de séance ») : les copies locales ne
  // sont relues que si la base a réellement supprimé l'exécution.
  deleteExecutionIfEmpty: async (op) => {
    const outcome = await deleteExecutionIfEmpty(op.id);
    if (outcome === 'deleted') {
      touchDeleted({ setIds: [], executionIds: [op.id] }, op.exerciseIds);
      realisedTouched = true;
    }
  },
};

/** Ce qu'il advient d'un lot d'ops soumis par `flushOps`. */
export interface OpsFlushResult extends FlushResult {
  /** De NOS ops, celles qui attendent encore en file (réseau, session). */
  pending: number;
  /** De NOS ops, celles que la base a refusées (quarantaine) : elles ne partiront pas. */
  refused: number;
}

/**
 * Enfile un lot d'ops (dans l'ordre) puis tente un flush immédiat. Les ops sont
 * durables dès l'enqueue (localStorage) : même si le flush échoue (offline),
 * elles remonteront au prochain flush, comme la capture du jour.
 *
 * Le résultat ne compte QUE NOS ops, retrouvées par leur identité d'enfilement
 * (`_uid`), PAS le `remaining` GLOBAL du `FlushResult` (BUG M4). Pourquoi :
 * `flush` est mémoïsé (un seul flush à la fois, cf. outbox). Si une passe est
 * déjà en vol, `flush(syncFns)` renvoie SA promesse, dont le `remaining` reflète
 * l'état AU LANCEMENT de cette passe, avant qu'on enfile nos ops. Il pourrait
 * donc valoir `0` alors que NOS ops dorment encore en file (faux succès →
 * l'éditeur de séance se fermerait à tort).
 *
 * `pending` et `refused` sont rendus À PART : une correction que la base a
 * refusée n'est pas une correction qui attend le réseau, et l'écran ne doit pas
 * dire « pas de réseau » pour elle. `remaining` reste leur somme (rien de nous
 * n'est en base tant qu'il n'est pas nul). L'identité d'enfilement est un UUID :
 * avant, nos ops refusées se repéraient par leur POSITION dans la quarantaine, et
 * une purge faite par un autre onglet pendant la passe pouvait faire passer une
 * correction refusée pour une sauvegarde réussie.
 * `flushed` reste celui de la passe (best-effort, purement indicatif).
 */
export async function flushOps(ops: OutboxOp[]): Promise<OpsFlushResult> {
  const ours = ops.map((op) => enqueueTracked(op));
  // On attend la passe (qu'elle soit la nôtre ou une déjà en vol) pour laisser le
  // temps à nos ops d'être tentées, mais on ne se fie pas à son `remaining` global.
  const { flushed } = await flushOutbox();
  const pending = pendingAmong(ours);
  const refused = refusedAmong(ours);
  return { remaining: pending + refused, pending, refused, flushed };
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

// Un essai reprogrammé après un verrou occupé (cf. outbox) passe par le flush de
// l'app, pour que les copies d'historique acquittées soient relues comme après
// toute autre passe.
setFlushRetryRunner(flushOutbox);
