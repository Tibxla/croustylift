-- Migration: backfill_closed_at
-- Rattrape les exécutions clôturées par un bundle ANTÉRIEUR au fix `closed_at`
-- (commit d2385c2) : celles-ci ont été RANGÉES (durée/BPM saisis à la clôture)
-- mais sans poser `closed_at`, car l'ancien code ne le transmettait pas. Résultat :
-- `loadTodayExecution` (filtre `closed_at IS NULL`) les ressuscite à chaque refresh
-- — la séance « finie » réapparaît avec son réalisé.
--
-- Critère sûr de « clôture passée » : `duration_min` ou `bpm_avg` non nul. Ces deux
-- colonnes ne sont écrites QUE par l'op de clôture (updateExecution), jamais en
-- cours de séance ; leur présence prouve donc une clôture. On pose `closed_at` à
-- `updated_at` (instant de la clôture) à défaut `created_at`. Additif, idempotent
-- (la garde `closed_at IS NULL` rend une ré-exécution sans effet).
update public.executions
set closed_at = coalesce(updated_at, created_at)
where closed_at is null
  and (duration_min is not null or bpm_avg is not null);
