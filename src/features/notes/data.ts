// Couche d'accès Supabase des NOTES (issue #26).
//
// Deux types de notes, deux tables (cf. domain/notes.ts + brainstorm §4) :
//   - exercise_notes : instructions PERSISTANTES par (user, exo). UNIQUE
//     (user_id, exercise_id) → au plus une note par exo. Éditée en authoring,
//     affichée en référence (lecture seule) en Capture.
//   - dated_notes : contexte d'une perf un jour donné, attaché à l'EXÉCUTION.
//     Saisie en Capture ; écriture routée par l'OUTBOX (offline-first, comme les
//     séries) → la note prise en salle survit au wifi pourri et remonte seule.
//
// Conventions DB (cf. ADR 0003 + migration 0001) :
//   - user_id / owner_id se remplissent tout seuls (default auth.uid()) — on ne
//     les écrit JAMAIS. Le default suffit aussi à résoudre le ON CONFLICT de
//     exercise_notes (la ligne candidate porte user_id = auth.uid()).
//   - RLS scope déjà tout à l'utilisateur connecté ; pas de filtre côté client.
//   - UUID des notes datées générés CÔTÉ CLIENT (idempotence outbox, cf. ADR 0003).
import { supabase } from '../../lib/supabase';
import { isBlankNote, normalizeNoteBody } from '../../domain/notes';
import type { OutboxOp } from '../capture/outbox';
import { invalidateExerciseNoteCopy } from '../capture/plan-copies';
import { withReloadBlocked } from '../../pwa/blockers';
import { translateConstraintError } from '../../lib/db-errors';

/** Raison du blocage de rechargement tenu pendant l'écriture directe d'une note d'instructions. */
export const NOTE_WRITE_BLOCK = 'ecriture-note-instructions';

// =====================================================================
// Helper pur (testé) — cf. data.test.ts
// =====================================================================

/**
 * Décide l'op d'outbox pour une note datée, à partir du corps saisi :
 *   - corps réel  -> `upsertDatedNote` (corps NORMALISÉ) ;
 *   - corps vide  -> `deleteDatedNote` (on efface plutôt que stocker du blanc).
 * Les deux ops portent le COUPLE (exécution, exercice), qui est l'identité de la
 * note en base : rejouer ou alterner vise toujours la même ligne, y compris une
 * note née sous un autre id (cf. `upsertDatedNote`). Logique PURE, sans réseau.
 */
export function datedNoteOutboxOp(params: {
  id: string;
  executionId: string;
  exerciseId: string;
  body: string;
}): OutboxOp {
  if (isBlankNote(params.body)) {
    return {
      type: 'deleteDatedNote',
      id: params.id,
      executionId: params.executionId,
      exerciseId: params.exerciseId,
    };
  }
  return {
    type: 'upsertDatedNote',
    id: params.id,
    executionId: params.executionId,
    exerciseId: params.exerciseId,
    body: normalizeNoteBody(params.body),
  };
}

/**
 * Les notes datées de l'exécution `executionId` dont une écriture attend encore
 * en file : leurs exos, et l'id de la note pour une op d'effacement d'un bundle
 * antérieur (qui ne porte ni exécution ni exo). Sert à la réconciliation d'une
 * réponse tardive de la base (`reconcileDatedNotes`, capture/state) : la base
 * ne connaît pas encore ces écritures, sa version de ces notes est périmée.
 * Logique PURE.
 */
export function pendingDatedNoteKeys(queue: readonly OutboxOp[], executionId: string): string[] {
  const keys: string[] = [];
  for (const op of queue) {
    if (op.type === 'upsertDatedNote') {
      if (op.executionId === executionId) keys.push(op.exerciseId);
    } else if (op.type === 'deleteDatedNote') {
      if (op.executionId === undefined || op.exerciseId === undefined) keys.push(op.id);
      else if (op.executionId === executionId) keys.push(op.exerciseId);
    }
  }
  return keys;
}

/**
 * Décide l'op d'outbox pour une note d'INSTRUCTIONS (issue #52, blind F3), à
 * partir du corps saisi :
 *   - corps réel  -> `upsertExerciseNote` (corps NORMALISÉ) ;
 *   - corps vide  -> `deleteExerciseNote` (on efface plutôt que stocker du blanc).
 * Miroir de `datedNoteOutboxOp`, mais la clé idempotente est l'`exerciseId` (pas
 * un UUID de ligne client) : la note est un singleton par (user, exo), unique en
 * base — rejouer ou alterner upsert/delete vise toujours cette même ligne.
 * Logique PURE, sans réseau.
 */
export function exerciseNoteOutboxOp(params: { exerciseId: string; body: string }): OutboxOp {
  if (isBlankNote(params.body)) {
    return { type: 'deleteExerciseNote', id: params.exerciseId };
  }
  return {
    type: 'upsertExerciseNote',
    id: params.exerciseId,
    body: normalizeNoteBody(params.body),
  };
}

// =====================================================================
// Note par exo (exercise_notes) — éditée en authoring, lue en Capture
// =====================================================================

/**
 * Corps de la note d'instructions d'un exo (chaîne vide si aucune note). Lue au
 * chargement de la Capture (référence) et de l'éditeur d'exo (pré-remplissage).
 * RLS scope à l'user : pas de filtre user_id. `maybeSingle` car la note est
 * unique par exo mais peut ne pas exister.
 */
export async function loadExerciseNote(exerciseId: string): Promise<string> {
  const { data, error } = await supabase
    .from('exercise_notes')
    .select('body')
    .eq('exercise_id', exerciseId)
    .maybeSingle();
  if (error) throw error;
  return data?.body ?? '';
}

/**
 * Enregistre la note d'instructions d'un exo. Corps réel -> upsert par
 * (user_id, exercise_id) : ré-éditer écrase l'unique ligne, sans doublon.
 * Corps vide -> on SUPPRIME la note (pas de ligne blanche à traîner). owner via
 * default auth.uid() ; le corps est normalisé (domain/notes).
 *
 * Écriture DIRECTE (authoring, onglet Exercices), hors file d'attente : aucun
 * rechargement automatique tant qu'elle n'est pas finie, sinon la note serait
 * perdue sans message. Les notes saisies en Capture passent par la file, qui
 * survit à un rechargement. Un refus de contrainte (exo supprimé entre-temps,
 * note trop longue) sort en français (lib/db-errors).
 */
export async function saveExerciseNote(exerciseId: string, body: string): Promise<void> {
  try {
    await withReloadBlocked(NOTE_WRITE_BLOCK, () => writeExerciseNote(exerciseId, body));
  } finally {
    // La copie servie à la Capture est périmée (cf. capture/plan-copies).
    invalidateExerciseNoteCopy(exerciseId);
  }
}

async function writeExerciseNote(exerciseId: string, body: string): Promise<void> {
  if (isBlankNote(body)) {
    const { error } = await supabase
      .from('exercise_notes')
      .delete()
      .eq('exercise_id', exerciseId);
    if (error) throw translateConstraintError(error);
    return;
  }

  const { error } = await supabase.from('exercise_notes').upsert(
    { exercise_id: exerciseId, body: normalizeNoteBody(body) },
    { onConflict: 'user_id,exercise_id' },
  );
  if (error) throw translateConstraintError(error);
}

// =====================================================================
// Note datée (dated_notes) — saisie en Capture, le jour de la séance
// =====================================================================

/** Violation d'unicité (Postgres 23505) : ici, le couple de la migration 0018. */
function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === '23505';
}

/**
 * L'id de la note datée que la base tient pour ce couple (exécution, exercice),
 * ou `null`. S'il y en a plusieurs (doublons d'avant la migration 0018), la plus
 * récente : celle que lit la réhydratation de la Capture.
 */
async function findDatedNoteId(executionId: string, exerciseId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('dated_notes')
    .select('id')
    .eq('execution_id', executionId)
    .eq('exercise_id', exerciseId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

/**
 * Écrit la note datée d'un exo dans une exécution. Idempotent → consommée par
 * l'outbox (SyncFns). owner via default auth.uid().
 *
 * L'IDENTITÉ d'une note datée est son couple (exécution, exercice), pas son id.
 * `params.id` est l'UUID déterministe du couple (dated-note-id), mais une note
 * écrite par un ancien client porte un id aléatoire : écrire sous l'id
 * déterministe sans regarder créait une seconde ligne tant que l'index unique
 * de la migration 0018 n'existe pas, et était refusé (23505, saisie en
 * quarantaine) une fois qu'il existe. On relit donc le couple d'abord et on
 * écrit sur la ligne qu'il a déjà ; `params.id` ne sert qu'à en créer une.
 *
 * Pas d'upsert `onConflict` sur le couple : il exige l'index de 0018, absent
 * tant que la migration n'est pas passée. Cette voie marche dans les deux états
 * du schéma. Le repli sur 23505 couvre la course (un autre appareil crée la
 * note entre la lecture et l'écriture, index posé) : on réécrit sur sa ligne.
 */
export async function upsertDatedNote(params: {
  id: string;
  executionId: string;
  exerciseId: string;
  body: string;
}): Promise<void> {
  const write = (id: string) =>
    supabase.from('dated_notes').upsert(
      {
        id,
        execution_id: params.executionId,
        exercise_id: params.exerciseId,
        body: params.body,
      },
      { onConflict: 'id' },
    );

  const known = await findDatedNoteId(params.executionId, params.exerciseId);
  const id = known ?? params.id;
  const { error } = await write(id);
  if (!error) return;
  if (!isUniqueViolation(error)) throw error;

  const taken = await findDatedNoteId(params.executionId, params.exerciseId);
  if (taken === null || taken === id) throw error;
  const { error: retryError } = await write(taken);
  if (retryError) throw retryError;
}

/**
 * Supprime une note datée par son id. Idempotent (delete par id). Rend le nombre
 * de lignes touchées : 0 (note déjà absente) reste un succès. Pour une op
 * d'effacement enfilée par un bundle antérieur, qui ne porte que l'id.
 */
export async function deleteDatedNoteById(id: string): Promise<number> {
  const { data, error } = await supabase.from('dated_notes').delete().eq('id', id).select('id');
  if (error) throw error;
  return data?.length ?? 0;
}

/**
 * Efface la note datée d'un exo dans une exécution, par son COUPLE : toute
 * ligne du couple part, quel que soit son id (note d'un ancien client, doublon
 * d'avant la migration 0018). Idempotent. Rend le nombre de lignes touchées : 0
 * (note déjà absente) reste un succès.
 */
export async function deleteDatedNoteByCouple(
  executionId: string,
  exerciseId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from('dated_notes')
    .delete()
    .eq('execution_id', executionId)
    .eq('exercise_id', exerciseId)
    .select('id');
  if (error) throw error;
  return data?.length ?? 0;
}

// =====================================================================
// Note d'instructions par exo, routée par l'OUTBOX (issue #52, blind F3)
// =====================================================================
//
// `saveExerciseNote` ci-dessus reste le chemin DIRECT de l'authoring (éditeur de
// séance, écran Exercices) : là, on est forcément en ligne et l'écriture est
// synchrone. En Capture, on édite la même note hors-ligne → l'écriture passe par
// l'outbox via ces deux fonctions atomiques (upsert / delete), idempotentes,
// consommées par les SyncFns. Le corps arrive DÉJÀ normalisé/tranché par
// `exerciseNoteOutboxOp` ; on ne re-décide rien ici, on écrit.

/**
 * Crée (ou ré-affirme) la note d'instructions d'un exo. Upsert onConflict
 * (user_id, exercise_id) : rejouer (retry après coupure) écrase l'unique ligne
 * du couple (user, exo), jamais de doublon. user_id via default auth.uid().
 * Idempotent → consommé par l'outbox (SyncFns).
 */
export async function upsertExerciseNoteRow(params: {
  exerciseId: string;
  body: string;
}): Promise<void> {
  const { error } = await supabase.from('exercise_notes').upsert(
    { exercise_id: params.exerciseId, body: params.body },
    { onConflict: 'user_id,exercise_id' },
  );
  if (error) throw error;
}

/**
 * Supprime la note d'instructions d'un exo (corps vidé). RLS scope à l'user (au
 * plus une ligne par exo) : delete par `exercise_id`, idempotent (sans effet si
 * aucune ligne). Consommé par l'outbox (SyncFns).
 */
export async function deleteExerciseNoteByExercise(exerciseId: string): Promise<number> {
  const { data, error } = await supabase
    .from('exercise_notes')
    .delete()
    .eq('exercise_id', exerciseId)
    .select('exercise_id');
  if (error) throw error;
  return data?.length ?? 0;
}
