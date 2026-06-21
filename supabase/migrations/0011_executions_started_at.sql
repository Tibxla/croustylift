-- Migration: executions_started_at
-- Matérialise le LANCEMENT d'une exécution (ADR 0011). Une séance « démarrée »
-- porte désormais un `started_at` en base, recopié de l'instant du lancement
-- (mémorisé en localStorage, écrit via l'op outbox upsertExecution au PREMIER
-- set — la ligne n'existe pas avant, règle anti-orpheline ADR 0009). Sert au
-- chrono « lancement -> clôture » et survit au cache vidé / multi-appareil, là où
-- la valeur en localStorage seul se réinitialisait au remontage. Nullable
-- (null = legacy / inconnu), additif, idempotent. Pas de backfill : les
-- exécutions anciennes gardent leur `duration_min` déjà figé.
alter table public.executions
  add column if not exists started_at timestamptz;
