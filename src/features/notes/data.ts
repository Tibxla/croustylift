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

// =====================================================================
// Helper pur (testé) — cf. data.test.ts
// =====================================================================

/**
 * Décide l'op d'outbox pour une note datée, à partir du corps saisi :
 *   - corps réel  -> `upsertDatedNote` (corps NORMALISÉ) ;
 *   - corps vide  -> `deleteDatedNote` (on efface plutôt que stocker du blanc).
 * L'id (UUID client) reste stable entre upsert et delete : rejouer ou alterner
 * vise toujours la même ligne (idempotence). Logique PURE, sans réseau.
 */
export function datedNoteOutboxOp(params: {
  id: string;
  executionId: string;
  exerciseId: string;
  body: string;
}): OutboxOp {
  if (isBlankNote(params.body)) {
    return { type: 'deleteDatedNote', id: params.id };
  }
  return {
    type: 'upsertDatedNote',
    id: params.id,
    executionId: params.executionId,
    exerciseId: params.exerciseId,
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
 */
export async function saveExerciseNote(exerciseId: string, body: string): Promise<void> {
  if (isBlankNote(body)) {
    const { error } = await supabase
      .from('exercise_notes')
      .delete()
      .eq('exercise_id', exerciseId);
    if (error) throw error;
    return;
  }

  const { error } = await supabase.from('exercise_notes').upsert(
    { exercise_id: exerciseId, body: normalizeNoteBody(body) },
    { onConflict: 'user_id,exercise_id' },
  );
  if (error) throw error;
}

// =====================================================================
// Note datée (dated_notes) — saisie en Capture, le jour de la séance
// =====================================================================

/**
 * Corps de la note datée d'un exo pour une exécution (chaîne vide si aucune).
 * Une exécution n'a normalement qu'une note par exo (l'UI n'en crée qu'une) ;
 * on prend la plus récente par sécurité (`limit(1)`). Sert à RÉHYDRATER la
 * saisie en Capture après un reload.
 */
export async function loadDatedNote(
  executionId: string,
  exerciseId: string,
): Promise<string> {
  const { data, error } = await supabase
    .from('dated_notes')
    .select('body')
    .eq('execution_id', executionId)
    .eq('exercise_id', exerciseId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.body ?? '';
}

/**
 * Crée (ou ré-affirme) une note datée par son id client. `upsert` onConflict id :
 * rejouer (retry après coupure) ne crée pas de doublon. owner via default
 * auth.uid(). Idempotent → consommée par l'outbox (SyncFns).
 */
export async function upsertDatedNote(params: {
  id: string;
  executionId: string;
  exerciseId: string;
  body: string;
}): Promise<void> {
  const { error } = await supabase.from('dated_notes').upsert(
    {
      id: params.id,
      execution_id: params.executionId,
      exercise_id: params.exerciseId,
      body: params.body,
    },
    { onConflict: 'id' },
  );
  if (error) throw error;
}

/** Supprime une note datée par son id (corps vidé). Idempotent (delete par id). */
export async function deleteDatedNoteById(id: string): Promise<void> {
  const { error } = await supabase.from('dated_notes').delete().eq('id', id);
  if (error) throw error;
}
