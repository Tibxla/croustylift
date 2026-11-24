-- 0027 : créer une séance et sa version initiale en UNE transaction
-- (relecture Codex de la branche d'intégration du 2026-11-24).
--
-- Le client créait la séance, puis sa version 1, en deux requêtes. Une
-- coupure entre les deux laissait une séance visible sans aucune version : la
-- Salle refuse de la lancer, et le nouvel essai au même nom butait sur
-- l'unicité du nom. La copie d'une séance (ADR 0015) ajoutait une troisième et
-- une quatrième requête (version 2 et ses prescriptions).
--
-- `create_seance(p_seance_id, p_routine_id, p_name, p_prescriptions)` crée la
-- séance, sa version 1 et, pour une copie, ses prescriptions (`jsonb`, un
-- tableau d'objets aux colonnes de `prescriptions` : exercise_id, position,
-- sets_min, sets_max, reps_min, reps_max, rir_min, rir_max), d'un seul tenant.
-- Elle rend la séance.
--
-- IDEMPOTENTE PAR ID : l'id est fourni par le client. Une demande rejouée
-- parce que sa réponse s'est perdue retrouve la séance déjà créée et la rend,
-- sans rien créer de plus (`on conflict (id) do nothing` : un rejeu concurrent
-- attend la première transaction, puis la lit). Le même id pour une autre
-- séance (autre routine ou autre nom), ou un id déjà pris par un autre compte,
-- est refusé (22023).
--
-- La position est calculée en fin de routine ; le trigger `seances_en_fin`
-- (0026) la recalcule sous le verrou de la routine. Un nom déjà pris dans la
-- routine est refusé par l'index unique (23505), que le client dit en clair ;
-- rien n'est créé. Une routine d'un autre compte est refusée par les clés de
-- 0019 (23503). SECURITY INVOKER : la RLS de l'appelant s'applique.
--
-- Appel côté client : `supabase.rpc('create_seance', { p_seance_id,
-- p_routine_id, p_name, p_prescriptions })` (`createSeance`,
-- src/features/authoring/data.ts, qui revient aux requêtes séparées tant que
-- cette fonction n'est pas en base).
--
-- Rejouable (`create or replace`). Aucune donnée touchée.
--
-- CONTRÔLE PRÉALABLE (lecture seule). Attendu : aucune ligne.
--
--   select p.oid::regprocedure from pg_proc p
--   where p.pronamespace = 'public'::regnamespace and p.proname = 'create_seance';
--
-- RISQUE : nul tant que le client ne l'appelle pas. À appliquer APRÈS 0026 et
-- AVANT le client qui l'appelle (supabase/tests/ORDRE.md).

begin;

-- Attente bornée : un verrou pris ailleurs fait échouer la migration (à
-- relancer) au lieu de geler l'app derrière elle.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function public.create_seance(
  p_seance_id uuid,
  p_routine_id uuid,
  p_name text,
  p_prescriptions jsonb default '[]'::jsonb
)
returns public.seances
language plpgsql
security invoker
set search_path = ''  -- durcit le search_path (advisor function_search_path_mutable)
as $$
declare
  v_seance public.seances;
  v_version uuid;
begin
  insert into public.seances (id, routine_id, name, position)
    values (
      p_seance_id,
      p_routine_id,
      p_name,
      coalesce((select max(s.position) + 1 from public.seances s
                where s.routine_id = p_routine_id and s.archived_at is null), 0)
    )
    on conflict (id) do nothing
    returning * into v_seance;

  if not found then
    -- Rejeu : la séance existe déjà. La même demande la retrouve ; une autre
    -- (ou un id d'un autre compte, invisible ici) est refusée.
    select s.* into v_seance from public.seances s where s.id = p_seance_id;
    if not found or v_seance.routine_id <> p_routine_id or v_seance.name <> p_name then
      raise exception 'create_seance : cet id désigne déjà une autre séance.'
        using errcode = '22023';
    end if;
    return v_seance;
  end if;

  insert into public.seance_versions (seance_id, version)
    values (p_seance_id, 1)
    returning id into v_version;

  insert into public.prescriptions
    (seance_version_id, exercise_id, position, sets_min, sets_max, reps_min, reps_max, rir_min, rir_max)
  select v_version, x.exercise_id, x.position, x.sets_min, x.sets_max, x.reps_min, x.reps_max, x.rir_min, x.rir_max
    from jsonb_to_recordset(coalesce(p_prescriptions, '[]'::jsonb))
      as x(exercise_id uuid, position int, sets_min int, sets_max int, reps_min int, reps_max int, rir_min int, rir_max int);

  return v_seance;
end;
$$;

revoke execute on function public.create_seance(uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.create_seance(uuid, uuid, text, jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
