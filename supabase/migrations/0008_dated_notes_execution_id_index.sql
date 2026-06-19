-- Migration: dated_notes_execution_id_index
-- Index manquant sur dated_notes.execution_id (audit 2026-06-19, finding perf).
--
-- La suppression d'une exécution (ADR 0008) s'appuie sur la cascade
-- `on delete cascade` de dated_notes.execution_id (migration 0001) : Postgres
-- résout les notes datées filles par execution_id. performed_sets.execution_id a
-- son index (0001), mais dated_notes l'avait oublié → seq scan sur la cascade.
-- Additif et idempotent (même pattern qu'en 0007).
create index if not exists dated_notes_execution_id_idx
  on public.dated_notes (execution_id);
