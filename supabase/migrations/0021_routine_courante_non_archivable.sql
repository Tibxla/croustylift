-- 0021 : la routine courante n'est jamais une routine archivée (audit du 2026-11-22, X11).
--
-- ADR 0017 : la routine courante ne s'archive pas, et une routine archivée ne
-- peut plus devenir courante. Seul le client tenait la règle, par une lecture
-- suivie d'une écriture (`archiveRoutine`) : deux appareils, ou un appel direct
-- à l'API, laissaient le compte sans séance à proposer en salle.
--
-- « Routine courante » = celle de l'activation la plus récente du compte, comme
-- `getCurrentRoutineId` côté client.
--
-- 1. `routines`, à la modification : refus du passage de `archived_at` de
--    null à une date quand la routine est la courante. Seule cette TRANSITION
--    est refusée : réécrire une routine déjà archivée (import, upsert) ne
--    déclenche rien.
--
-- 2. `routines`, à la suppression : refus de supprimer la routine courante
--    quand ses activations, en partant, rendraient courante une routine
--    archivée. La règle ne vaut que pour une suppression DIRECTE : dans une
--    cascade (suppression du compte depuis auth.users), rien n'est vérifié,
--    tout part de toute façon.
--
-- 3. `routine_activations`, à l'insertion, à la modification et à la
--    suppression directe : refus d'une écriture qui laisse pour courante une
--    routine archivée. La vérification se fait en fin d'INSTRUCTION, sur
--    l'état résultant : l'import rejoue l'historique complet des activations
--    (insertions et réécritures), dont celles, passées, de routines archivées
--    depuis.
--
-- COURSES : deux appareils pouvaient archiver et activer la même routine au
-- même instant, chacun lisant l'état d'avant l'autre. Chaque trigger prend donc
-- d'abord un verrou consultatif de transaction PAR COMPTE
-- (`pg_advisory_xact_lock`) : archivage, activation et suppression d'un même
-- compte passent l'un après l'autre, et le second voit l'écriture du premier.
--
-- Rejouable. Aucune donnée modifiée : un compte déjà dans l'état interdit fait
-- échouer la migration entière.
--
-- CONTRÔLE PRÉALABLE (lecture seule). Attendu : aucune ligne.
--
--   select r.owner_id, r.id, r.name, r.archived_at, c.activated_at
--   from (
--     select distinct on (owner_id) owner_id, routine_id, activated_at
--     from routine_activations order by owner_id, activated_at desc
--   ) c join routines r on r.id = c.routine_id
--   where r.archived_at is not null;
--
-- SI DES LIGNES SORTENT : ce compte n'a plus de séance proposée en salle.
-- Désarchiver la routine le répare sans rien perdre (`update routines set
-- archived_at = null where id = '...'`) ; le propriétaire choisira ensuite une
-- autre routine courante s'il voulait vraiment archiver celle-là. Appliquer
-- ensuite.
--
-- RISQUE : faible. Un seul geste du client peut désormais être refusé :
-- supprimer la routine courante (jamais exécutée) quand la précédente est
-- archivée. Le message dit quoi faire (définir d'abord une autre routine
-- courante) ; l'écran peut le traduire.

begin;

-- Attente bornée : un verrou pris ailleurs fait échouer la migration (à
-- relancer) au lieu de geler l'app derrière elle.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
declare
  v_comptes int;
begin
  select count(*) into v_comptes
  from (
    select distinct on (owner_id) owner_id, routine_id
    from public.routine_activations order by owner_id, activated_at desc
  ) c join public.routines r on r.id = c.routine_id
  where r.archived_at is not null;
  if v_comptes > 0 then
    raise exception
      '0021 : % compte(s) ont pour routine courante une routine archivée. Voir le contrôle préalable en tête de fichier.',
      v_comptes;
  end if;
end;
$$;

-- Verrou par compte, partagé par tous les triggers de cette règle.
create or replace function public.lock_current_routine(p_owner uuid)
returns void
language sql
set search_path = ''  -- durcit le search_path (advisor function_search_path_mutable)
as $$
  select pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('croustylift.routine_courante:' || p_owner::text, 0)
  );
$$;

revoke execute on function public.lock_current_routine(uuid) from public, anon;
grant execute on function public.lock_current_routine(uuid) to authenticated, service_role;

-- 1. et 2. `routines` : ni archiver la courante, ni la supprimer au profit
-- d'une archivée -------------------------------------------------------------

create or replace function public.refuse_archive_current_routine()
returns trigger
language plpgsql
set search_path = ''  -- durcit le search_path (advisor function_search_path_mutable)
as $$
declare
  v_courante uuid;
  v_suivante_archivee boolean;
begin
  if tg_op = 'UPDATE' then
    if not (old.archived_at is null and new.archived_at is not null) then
      return new;
    end if;
    perform public.lock_current_routine(new.owner_id);
    select a.routine_id into v_courante from public.routine_activations a
      where a.owner_id = new.owner_id
      order by a.activated_at desc
      limit 1;
    if v_courante = new.id then
      raise exception 'La routine courante ne s''archive pas. Définis d''abord une autre routine comme courante.'
        using errcode = '23514', table = tg_table_name, column = 'archived_at';
    end if;
    return new;
  end if;

  -- DELETE. Dans une cascade (compte supprimé), on ne vérifie rien.
  if pg_catalog.pg_trigger_depth() > 1 then
    return old;
  end if;
  perform public.lock_current_routine(old.owner_id);
  select a.routine_id into v_courante from public.routine_activations a
    where a.owner_id = old.owner_id
    order by a.activated_at desc
    limit 1;
  if v_courante = old.id then
    select r.archived_at is not null into v_suivante_archivee
      from public.routine_activations a
      join public.routines r on r.id = a.routine_id
      where a.owner_id = old.owner_id and a.routine_id <> old.id
      order by a.activated_at desc
      limit 1;
    if v_suivante_archivee then
      raise exception 'Supprimer la routine courante rendrait courante une routine archivée. Définis d''abord une autre routine comme courante.'
        using errcode = '23514', table = tg_table_name;
    end if;
  end if;
  return old;
end;
$$;

drop trigger if exists refuse_archive_current_routine on public.routines;
create trigger refuse_archive_current_routine before update of archived_at on public.routines
  for each row execute function public.refuse_archive_current_routine();

drop trigger if exists refuse_delete_current_routine on public.routines;
create trigger refuse_delete_current_routine before delete on public.routines
  for each row execute function public.refuse_archive_current_routine();

-- 3. `routine_activations` : la courante résultante n'est pas archivée --------

-- TG_ARGV[0] : la table de transition à lire (`touched`), commune aux trois
-- triggers, qui la nomment chacun pour son événement.
create or replace function public.refuse_activate_archived_routine()
returns trigger
language plpgsql
set search_path = ''  -- durcit le search_path (advisor function_search_path_mutable)
as $$
declare
  v_owner uuid;
begin
  -- Suppression en cascade (routine ou compte supprimé) : la règle est tenue
  -- par le trigger de `routines`, ou sans objet.
  if tg_op = 'DELETE' and pg_catalog.pg_trigger_depth() > 1 then
    return null;
  end if;

  -- Comptes touchés par l'instruction, dans un ordre fixe (pas d'interblocage).
  for v_owner in select distinct t.owner_id from touched t order by 1 loop
    perform public.lock_current_routine(v_owner);
    if (
      select r.archived_at is not null
      from public.routine_activations a
      join public.routines r on r.id = a.routine_id
      where a.owner_id = v_owner
      order by a.activated_at desc
      limit 1
    ) then
      raise exception 'Une routine archivée ne peut pas être la routine courante. Désarchive-la d''abord.'
        using errcode = '23514', table = tg_table_name, column = 'routine_id';
    end if;
  end loop;
  return null;
end;
$$;

drop trigger if exists refuse_activate_archived_routine on public.routine_activations;
create trigger refuse_activate_archived_routine after insert on public.routine_activations
  referencing new table as touched
  for each statement execute function public.refuse_activate_archived_routine();

drop trigger if exists refuse_activate_archived_routine_update on public.routine_activations;
create trigger refuse_activate_archived_routine_update after update on public.routine_activations
  referencing new table as touched
  for each statement execute function public.refuse_activate_archived_routine();

drop trigger if exists refuse_activate_archived_routine_delete on public.routine_activations;
create trigger refuse_activate_archived_routine_delete after delete on public.routine_activations
  referencing old table as touched
  for each statement execute function public.refuse_activate_archived_routine();

commit;
