-- Migration: executions_closed_at
-- Matérialise la CLÔTURE d'une exécution (ADR 0009). Une séance « rangée » porte
-- désormais un `closed_at` en base (posé via l'op outbox updateExecution à la
-- clôture), ce qui permet à la réhydratation (loadTodayExecution) de l'EXCLURE :
-- après clôture, on repart vraiment vierge même après un reload, et non plus
-- seulement grâce au nettoyage du cache local (fragile — cache survivant, quota,
-- minuit). Nullable (null = exécution en cours), additif, idempotent.
alter table public.executions
  add column if not exists closed_at timestamptz;
