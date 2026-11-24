-- 0023 : réordonner les séances d'une routine en une seule écriture (audit du 2026-11-22, P10).
--
-- Le client réécrivait `position` par une requête par séance, en série et sans
-- transaction : six allers-retours pour déplacer une séance d'un cran dans une
-- routine de six, et des positions en double si la connexion tombait au milieu.
--
-- `reorder_seances(p_routine_id, p_seance_ids)` pose les positions 0..n-1 dans
-- l'ordre du tableau, en une instruction : tout passe ou rien ne change.
-- SECURITY INVOKER : la RLS de l'appelant s'applique, il ne réordonne que ses
-- séances. La fonction refuse (22023) un id en double, un id qui n'est pas une
-- séance de la routine, ou une séance d'un autre compte : dans les trois cas le
-- nombre de lignes touchées ne correspond pas.
--
-- Appel côté client : `supabase.rpc('reorder_seances', { p_routine_id, p_seance_ids })`.
--
-- Rejouable (`create or replace`). Aucune donnée touchée, rien à contrôler.
--
-- CONTRÔLE PRÉALABLE (lecture seule). Attendu : aucune ligne (pas de fonction
-- du même nom déjà en base).
--
--   select p.oid::regprocedure from pg_proc p
--   where p.pronamespace = 'public'::regnamespace and p.proname = 'reorder_seances';
--
-- RISQUE : nul tant que le client ne l'appelle pas. À appliquer AVANT de
-- déployer le client qui l'appelle.

begin;

-- Attente bornée : un verrou pris ailleurs fait échouer la migration (à
-- relancer) au lieu de geler l'app derrière elle.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function public.reorder_seances(p_routine_id uuid, p_seance_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = ''  -- durcit le search_path (advisor function_search_path_mutable)
as $$
declare
  v_attendues int := coalesce(cardinality(p_seance_ids), 0);
  v_touchees int;
begin
  if v_attendues = 0 then
    return;
  end if;

  if (select count(distinct t.id) from unnest(p_seance_ids) as t(id)) <> v_attendues then
    raise exception 'reorder_seances : une séance figure deux fois (ou un id est nul).'
      using errcode = '22023';
  end if;

  update public.seances s
    set position = t.rang - 1
    from unnest(p_seance_ids) with ordinality as t(id, rang)
    where s.id = t.id
      and s.routine_id = p_routine_id;
  get diagnostics v_touchees = row_count;

  if v_touchees <> v_attendues then
    raise exception 'reorder_seances : % séance(s) sur % appartiennent à cette routine.', v_touchees, v_attendues
      using errcode = '22023';
  end if;
end;
$$;

revoke execute on function public.reorder_seances(uuid, uuid[]) from public, anon;
grant execute on function public.reorder_seances(uuid, uuid[]) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
