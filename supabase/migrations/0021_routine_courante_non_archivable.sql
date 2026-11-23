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
-- 2. `routines`, à la suppression : refus d'une suppression qui laisse pour
--    courante une routine archivée. Vérifié en fin d'INSTRUCTION, donc APRÈS
--    les cascades qui emportent les activations, et sur l'ensemble des
--    routines supprimées : une suppression groupée est jugée sur son résultat.
--    La règle ne vaut que pour une suppression DIRECTE : dans la cascade d'un
--    compte supprimé (depuis auth.users), rien n'est vérifié, tout part.
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
-- ORDRE, impératif (voir supabase/tests/ORDRE.md) : cette migration s'applique
-- APRÈS le déploiement du client qui importe par `import_user_data` (migration
-- 0024) ET après le passage des anciens clients. L'ancien import écrivait les
-- tables l'une après l'autre, sans transaction : sur une sauvegarde « A
-- archivée, B courante » restaurée dans un compte où A est redevenue courante,
-- il aurait été refusé ici en réarchivant A, après avoir déjà écrit les tables
-- précédentes, laissant le compte à moitié restauré. Le client à jour n'a pas
-- besoin d'elle pour tenir la règle dans ses propres gestes (`archiveRoutine`
-- relit la routine courante) : elle ferme les courses et les appels directs.
-- Son numéro ne dit pas son rang.
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
-- supprimer la routine courante (jamais exécutée) quand celle qui redeviendrait
-- courante est archivée. Le message dit quoi faire ; l'écran peut le traduire.

begin;

-- Attente bornée : un verrou pris ailleurs fait échouer la migration (à
-- relancer) au lieu de geler l'app derrière elle.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Verrou d'abord : plus aucune écriture sur les deux tables jusqu'au commit
-- (les lectures passent). Sans lui, une activation et un archivage simultanés
-- pouvaient encore se croiser entre le comptage ci-dessous et la pose des
-- triggers, et la migration validait un état déjà faux.
lock table public.routines, public.routine_activations in share row exclusive mode;

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

-- 1. `routines` : la courante ne s'archive pas ------------------------------

create or replace function public.refuse_archive_current_routine()
returns trigger
language plpgsql
set search_path = ''  -- durcit le search_path (advisor function_search_path_mutable)
as $$
begin
  if not (old.archived_at is null and new.archived_at is not null) then
    return new;
  end if;
  perform public.lock_current_routine(new.owner_id);
  if new.id = (
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

-- 2. et 3. La routine courante RÉSULTANTE n'est pas archivée ------------------

-- Une seule fonction pour quatre triggers de fin d'instruction (activations
-- insérées, modifiées, supprimées ; routines supprimées). Chacun lui présente
-- ses lignes sous le nom `touched` ; elle n'en lit que `owner_id`.
create or replace function public.refuse_activate_archived_routine()
returns trigger
language plpgsql
set search_path = ''  -- durcit le search_path (advisor function_search_path_mutable)
as $$
declare
  v_owner uuid;
begin
  -- Suppression en cascade : rien ici. Les activations d'une routine supprimée
  -- sont jugées par le trigger de `routines`, qui passe après ses cascades ;
  -- celles d'un compte supprimé partent toutes.
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
      raise exception 'Une routine archivée ne peut pas être la routine courante. Désarchive-la d''abord, ou définis une autre routine comme courante.'
        using errcode = '23514', table = tg_table_name;
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

-- Après les cascades : un trigger d'instruction AFTER passe après les triggers
-- de ligne, dont ceux des clés étrangères qui emportent les activations.
drop trigger if exists refuse_delete_current_routine on public.routines;
create trigger refuse_delete_current_routine after delete on public.routines
  referencing old table as touched
  for each statement execute function public.refuse_activate_archived_routine();

commit;
