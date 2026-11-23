-- 0015 : index manquants et policies en `(select auth.uid())` (audit du 2026-11-22, P11).
--
-- 1. Index. `executions.seance_version_id` filtre l'ouverture d'une séance et
--    porte une clé étrangère ; `performed_sets.owner_id` sert le filtre RLS des
--    lectures d'historique ; `prescriptions.exercise_id`, `dated_notes.exercise_id`
--    et `routine_activations.routine_id` sont des clés étrangères sans index
--    (la suppression du parent parcourait toute la table fille).
--
-- 2. Policies. `auth.uid()` nu est réévalué à chaque ligne ; `(select auth.uid())`
--    est évalué une fois par requête (advisor `auth_rls_initplan`). Le sens des
--    policies ne change pas : mêmes tables, mêmes commandes, mêmes conditions.
--    `alter policy` et non `drop` puis `create` : aucune fenêtre sans policy, et
--    une policy absente fait échouer la migration au lieu d'en créer une autre.
--
-- Rejouable : `create index if not exists`, `alter policy` réécrit la même
-- expression. Aucune donnée touchée.
--
-- CONTRÔLE PRÉALABLE (lecture seule). Attendu : les 18 policies ci-dessous,
-- toutes `{authenticated}`, et rien d'autre. Une policy de plus ou de moins
-- signale une dérive entre les migrations et la base : s'arrêter et comparer.
--
--   select tablename, policyname, cmd, roles, qual, with_check
--   from pg_policies where schemaname = 'public' order by 1, 2;
--
--   exercises            : exercises_select, _insert, _update, _delete
--   exercise_overrides   : exercise_overrides_select, _insert, _update, _delete
--   les dix autres tables : <table>_all (exercise_notes, routines, seances,
--     seance_versions, prescriptions, executions, performed_sets, dated_notes,
--     routine_activations, seance_archive_events)
--
-- RISQUE : faible. Tables de quelques milliers de lignes, verrous brefs.

begin;

-- Attente bornée : un verrou pris ailleurs fait échouer la migration (à
-- relancer) au lieu de geler l'app derrière elle.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 1. Index --------------------------------------------------------------------

create index if not exists executions_seance_version_id_idx
  on public.executions (seance_version_id);
create index if not exists performed_sets_owner_id_idx
  on public.performed_sets (owner_id);
create index if not exists prescriptions_exercise_id_idx
  on public.prescriptions (exercise_id);
create index if not exists dated_notes_exercise_id_idx
  on public.dated_notes (exercise_id);
create index if not exists routine_activations_routine_id_idx
  on public.routine_activations (routine_id);

-- 2. Policies -----------------------------------------------------------------

alter policy exercises_select on public.exercises
  using (owner_id is null or owner_id = (select auth.uid()));
alter policy exercises_insert on public.exercises
  with check (owner_id = (select auth.uid()));
alter policy exercises_update on public.exercises
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
alter policy exercises_delete on public.exercises
  using (owner_id = (select auth.uid()));

alter policy exercise_overrides_select on public.exercise_overrides
  using (user_id = (select auth.uid()));
alter policy exercise_overrides_insert on public.exercise_overrides
  with check (user_id = (select auth.uid()));
alter policy exercise_overrides_update on public.exercise_overrides
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
alter policy exercise_overrides_delete on public.exercise_overrides
  using (user_id = (select auth.uid()));

alter policy exercise_notes_all on public.exercise_notes
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter policy routines_all on public.routines
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
alter policy seances_all on public.seances
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
alter policy seance_versions_all on public.seance_versions
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
alter policy prescriptions_all on public.prescriptions
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
alter policy executions_all on public.executions
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
alter policy performed_sets_all on public.performed_sets
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
alter policy dated_notes_all on public.dated_notes
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
alter policy routine_activations_all on public.routine_activations
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- Le journal des archivages : la migration 0022 remplace cette policy par une
-- lecture et une insertion seules. Rejouée après elle, la 0015 ne la retrouve
-- plus et n'a rien à réécrire.
do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'seance_archive_events'
      and policyname = 'seance_archive_events_all'
  ) then
    alter policy seance_archive_events_all on public.seance_archive_events
      using (owner_id = (select auth.uid()))
      with check (owner_id = (select auth.uid()));
  end if;
end;
$$;

commit;
