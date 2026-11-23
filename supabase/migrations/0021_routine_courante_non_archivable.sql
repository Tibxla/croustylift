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
-- 1. `routines` : refus du passage de `archived_at` de null à une date quand la
--    routine est la courante. Seule cette TRANSITION est refusée : réécrire une
--    routine déjà archivée (import, upsert) ne déclenche rien.
--
-- 2. `routine_activations` : refus d'une insertion qui laisse pour courante une
--    routine archivée. La vérification se fait en fin d'INSTRUCTION, sur
--    l'ensemble des lignes insérées : l'import rejoue l'historique complet des
--    activations, dont celles, passées, de routines archivées depuis.
--
-- Les deux refus sont en 23514 (classe 23, ADR 0018). Le client garde son
-- message (« La routine courante ne s'archive pas... ») : il lit avant d'écrire,
-- le trigger ne répond qu'aux courses et aux appels directs.
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
-- RISQUE : faible. Les deux triggers ne refusent qu'un état que le client ne
-- produit pas par ces deux écritures.
--
-- CE QUE LA BASE NE COUVRE PAS : la routine courante se DÉRIVE de la dernière
-- activation. Supprimer la routine courante (possible tant qu'elle n'a jamais
-- été exécutée) emporte ses activations, et la précédente redevient courante,
-- même archivée. La base ne peut pas refuser cette suppression sans refuser
-- aussi celle d'un compte (cascade depuis auth.users). Le remède est dans la
-- dérivation côté client : ignorer les activations des routines archivées
-- (`getCurrentRoutineId`). Tant qu'il n'est pas livré, le contrôle préalable
-- ci-dessus peut de nouveau rendre une ligne par ce chemin.

begin;

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

-- 1. La routine courante ne s'archive pas ------------------------------------

create or replace function public.refuse_archive_current_routine()
returns trigger
language plpgsql
set search_path = ''  -- durcit le search_path (advisor function_search_path_mutable)
as $$
begin
  if old.archived_at is null and new.archived_at is not null and new.id = (
    select a.routine_id from public.routine_activations a
    where a.owner_id = new.owner_id
    order by a.activated_at desc
    limit 1
  ) then
    raise exception 'La routine courante ne s''archive pas. Définis d''abord une autre routine comme courante.'
      using errcode = '23514', table = tg_table_name, column = 'archived_at';
  end if;
  return new;
end;
$$;

drop trigger if exists refuse_archive_current_routine on public.routines;
create trigger refuse_archive_current_routine before update of archived_at on public.routines
  for each row execute function public.refuse_archive_current_routine();

-- 2. Une routine archivée ne devient pas courante -----------------------------

create or replace function public.refuse_activate_archived_routine()
returns trigger
language plpgsql
set search_path = ''  -- durcit le search_path (advisor function_search_path_mutable)
as $$
begin
  -- Pour chaque compte touché par l'instruction : si l'activation la plus
  -- récente vient d'être insérée et vise une routine archivée, on refuse.
  if exists (
    select 1
    from (select distinct owner_id from inserted) o
    cross join lateral (
      select a.id, a.routine_id from public.routine_activations a
      where a.owner_id = o.owner_id
      order by a.activated_at desc
      limit 1
    ) courante
    join public.routines r on r.id = courante.routine_id
    where r.archived_at is not null
      and courante.id in (select id from inserted)
  ) then
    raise exception 'Une routine archivée ne peut pas devenir la routine courante. Désarchive-la d''abord.'
      using errcode = '23514', table = tg_table_name, column = 'routine_id';
  end if;
  return null;
end;
$$;

drop trigger if exists refuse_activate_archived_routine on public.routine_activations;
create trigger refuse_activate_archived_routine after insert on public.routine_activations
  referencing new table as inserted
  for each statement execute function public.refuse_activate_archived_routine();

commit;
