-- 0026 : réordonner les séances d'une routine SOUS RÉVISION (relecture Codex
-- de la branche d'intégration du 2026-11-24, constat 3).
--
-- `reorder_seances` (0023) réécrit toutes les positions à partir de la liste
-- envoyée. Un appareil qui affiche A, B, C pendant qu'un autre a placé C en
-- tête renvoyait B, A, C au premier « Monter » : le déplacement de C était
-- annulé sans que personne le voie. Le client ne peut pas vérifier puis
-- écrire d'un seul tenant ; la base, si.
--
-- `reorder_seances_revision(p_routine_id, p_expected_ids, p_seance_ids)` :
--   - `p_expected_ids` : l'ordre que le client AFFICHE (ses séances actives) ;
--   - `p_seance_ids`   : le nouvel ordre, une permutation de `p_expected_ids`.
-- Dans une seule transaction, elle verrouille les séances de la routine
-- (`for update`), puis compare l'ordre courant à l'attendu sur un instantané
-- pris après le verrou (READ COMMITTED) : un réordonnancement concurrent est
-- attendu, puis VU. Refus, sans rien écrire :
--   - PT409 « l'ordre a changé depuis sa lecture » : les séances actives de la
--     routine ne sont plus celles attendues (ajoutée, archivée, supprimée
--     ailleurs), ou leur ordre courant n'est plus celui attendu. PostgREST
--     répond 409 ; le client relit l'ordre et le dit ;
--   - 22023 : nouvel ordre qui n'est pas une permutation de l'attendu (doublon,
--     id nul ou en trop), ou aucune séance visible dans la routine (routine
--     d'un autre compte : la RLS les cache).
-- VERROU DE ROUTINE, commun au réordonnancement et à l'ajout : la ligne de la
-- routine, `for no key update` (il n'empêche ni les clés étrangères qui la
-- visent, ni les lectures). Les séances existantes, verrouillées seules, ne
-- couvraient pas un ajout : validé entre le contrôle et l'écriture, il
-- échappait au PT409, et sa position, calculée par le client (max + 1 d'une
-- copie), pouvait tomber au milieu des rangs 0..n-1 posés ensuite.
-- `seances_en_fin` (BEFORE INSERT, et BEFORE UPDATE au désarchivage) prend le
-- même verrou, PUIS calcule la position : la séance ajoutée ou désarchivée va
-- toujours en fin (max + 1 de la routine, 0 si vide), quelle que soit la
-- position envoyée. Un ajout concurrent d'un réordonnancement attend donc sa
-- fin et se place après lui ; un réordonnancement parti d'un ordre qui
-- n'avait pas l'ajout est refusé (PT409). L'import (0024,
-- `croustylift.import`) garde les positions du fichier.
-- Ordre des verrous, sans cycle : routine, puis séances actives. Le
-- désarchivage tient sa ligne (archivée) avant la routine, mais le
-- réordonnancement ne verrouille que les séances actives.
--
-- Deux séances à la même position (données anciennes) s'acceptent dans les
-- deux ordres : on vérifie que les positions ne DÉCROISSENT pas le long de
-- l'ordre attendu, pas un ordre strict que le client ne peut pas connaître.
-- Les positions posées sont 0..n-1, comme `reorder_seances`.
--
-- SECURITY INVOKER : la RLS de l'appelant s'applique. `reorder_seances` reste
-- en place : un client pas encore rechargé l'appelle toujours (sans contrôle
-- de révision, comme aujourd'hui ; ses ajouts passent par le trigger).
--
-- Appel côté client : `supabase.rpc('reorder_seances_revision', { p_routine_id,
-- p_expected_ids, p_seance_ids })` (`reorderSeances`,
-- src/features/authoring/data.ts, qui revient à `reorder_seances` tant que
-- cette fonction n'est pas en base).
--
-- Rejouable (`create or replace`). Aucune donnée touchée.
--
-- CONTRÔLE PRÉALABLE (lecture seule). Attendu : une seule ligne,
-- `reorder_seances(uuid,uuid[])` (0023 en place, pas encore de fonction 0026).
--
--   select p.oid::regprocedure from pg_proc p
--   where p.pronamespace = 'public'::regnamespace
--     and p.proname in ('reorder_seances', 'reorder_seances_revision', 'seances_en_fin');
--
-- et aucun trigger `seances_en_fin` sur public.seances :
--
--   select tgname from pg_trigger where tgrelid = 'public.seances'::regclass and tgname = 'seances_en_fin';
--
-- RISQUE : faible. Le trigger change la position d'un AJOUT (toujours en fin,
-- ce que le client demandait déjà) et d'un désarchivage (idem) ; la fonction
-- n'agit que si le client l'appelle. À appliquer AVANT de
-- déployer le client qui l'appelle (sans elle, ce client réordonne sans
-- contrôle de révision, comme aujourd'hui).

begin;

-- Attente bornée : un verrou pris ailleurs fait échouer la migration (à
-- relancer) au lieu de geler l'app derrière elle.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function public.reorder_seances_revision(
  p_routine_id uuid,
  p_expected_ids uuid[],
  p_seance_ids uuid[]
)
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

  -- 1. Le nouvel ordre est une permutation de l'ordre attendu.
  if coalesce(cardinality(p_expected_ids), 0) <> v_attendues
     or (select count(distinct t.id) from unnest(p_seance_ids) as t(id)) <> v_attendues
     or (select count(distinct t.id) from unnest(p_expected_ids) as t(id)) <> v_attendues
     or exists (select t.id from unnest(p_seance_ids) as t(id) except select e.id from unnest(p_expected_ids) as e(id)) then
    raise exception 'reorder_seances_revision : le nouvel ordre n''est pas une permutation de l''ordre affiché.'
      using errcode = '22023';
  end if;

  -- 2. Verrous : la routine (commun avec l'ajout, cf. `seances_en_fin`), puis
  --    ses séances actives. Attend un réordonnancement ou un ajout en cours.
  perform 1 from public.routines r where r.id = p_routine_id for no key update;
  perform 1 from public.seances s where s.routine_id = p_routine_id and s.archived_at is null for update;
  if not found then
    raise exception 'reorder_seances_revision : aucune séance de cette routine.'
      using errcode = '22023';
  end if;

  -- 3. L'ordre courant (instantané pris après le verrou) est-il l'attendu ?
  if exists (
       select 1 from public.seances s
       where s.routine_id = p_routine_id and s.archived_at is null
         and not (s.id = any (p_expected_ids)))
     or (select count(*) from public.seances s
         where s.routine_id = p_routine_id and s.archived_at is null
           and s.id = any (p_expected_ids)) <> v_attendues
     or exists (
       select 1 from (
         select s.position, lag(s.position) over (order by e.rang) as avant
         from unnest(p_expected_ids) with ordinality as e(id, rang)
         join public.seances s on s.id = e.id
       ) x
       where x.position < x.avant) then
    raise exception 'reorder_seances_revision : l''ordre a changé depuis sa lecture.'
      using errcode = 'PT409';
  end if;

  -- 4. Écriture, en une instruction.
  update public.seances s
    set position = t.rang - 1
    from unnest(p_seance_ids) with ordinality as t(id, rang)
    where s.id = t.id
      and s.routine_id = p_routine_id;
  get diagnostics v_touchees = row_count;

  if v_touchees <> v_attendues then
    raise exception 'reorder_seances_revision : % séance(s) sur % appartiennent à cette routine.', v_touchees, v_attendues
      using errcode = '22023';
  end if;
end;
$$;

-- Ajout ou désarchivage d'une séance : en fin de routine, sous le verrou de la
-- routine (cf. en-tête). Hors import : l'import garde les positions du fichier.
create or replace function public.seances_en_fin()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if coalesce(current_setting('croustylift.import', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'UPDATE' and not (old.archived_at is not null and new.archived_at is null) then
    return new;
  end if;
  perform 1 from public.routines r where r.id = new.routine_id for no key update;
  select coalesce(max(s.position) + 1, 0) into new.position
    from public.seances s
    where s.routine_id = new.routine_id and s.id <> new.id and s.archived_at is null;
  return new;
end;
$$;

revoke execute on function public.seances_en_fin() from public, anon;

drop trigger if exists seances_en_fin on public.seances;
create trigger seances_en_fin
  before insert or update of archived_at on public.seances
  for each row execute function public.seances_en_fin();

revoke execute on function public.reorder_seances_revision(uuid, uuid[], uuid[]) from public, anon;
grant execute on function public.reorder_seances_revision(uuid, uuid[], uuid[]) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
