-- 0019 : une ligne ne se rattache qu'à un parent du même compte (audit du 2026-11-22, X8).
--
-- Les clés étrangères et les index uniques ne passent pas par la RLS : un compte
-- authentifié qui connaissait un UUID d'un autre compte pouvait y rattacher ses
-- propres lignes. La victime ne les voyait jamais, mais :
--   - une exécution étrangère bloquait la suppression de sa séance, de sa
--     routine et de son compte (clé en NO ACTION depuis la migration 0014) ;
--   - une séance étrangère prenait un nom dans sa routine et révélait par
--     l'erreur d'unicité si un nom y existait (migration 0013) ;
--   - une version étrangère bloquait la modification de sa séance
--     (`unique (seance_id, version)`, migration 0001) ;
--   - une prescription ou une série étrangère bloquait la suppression de son
--     exo perso.
--
-- 1. Parents possédés (routines, seances, seance_versions, executions) : la clé
--    étrangère devient COMPOSITE, `(parent_id, owner_id)` vers `(id, owner_id)`.
--    L'appartenance est alors tenue par la base elle-même, quelle que soit la
--    policy. Chaque clé est REMPLACÉE sous le même nom et avec la même action à
--    la suppression : il reste une seule clé entre deux tables, les jointures
--    PostgREST du client ne deviennent pas ambiguës. `executions.seance_version_id`
--    reste nullable : sans séance, rien à vérifier (MATCH SIMPLE).
--
-- 2. Unicités qui traversaient les comptes. Postgres vérifie un index unique
--    AVANT la clé étrangère : sans `owner_id` dans l'index, l'écriture d'un
--    autre compte recevait 23505 si le nom (ou le numéro de version) existait,
--    23503 sinon, et lisait ainsi le plan d'autrui. L'index des noms de séance
--    (migration 0013) et l'unicité des versions (migration 0001) portent donc
--    `owner_id` en tête. La règle ne change pas : la clé composite garantit
--    qu'une routine et ses séances ont le même compte.
--
-- 3. Liens vers `exercises` : le parent peut être un exo de base (`owner_id`
--    null), une clé composite ne convient pas. Un trigger refuse un exo qui
--    n'est ni de base ni au compte de la ligne, en 23503 comme une clé
--    étrangère (classe 23 : quarantaine de l'ADR 0018, jamais de file bloquée).
--    `exercise_overrides` est traité par la migration 0020 (exo de base requis).
--
-- Rejouable. Aucune donnée modifiée : un lien croisé existant fait échouer la
-- migration entière.
--
-- CONTRÔLE PRÉALABLE (lecture seule). Attendu : 0 sur chaque ligne.
--
--   select 'seances/routines' as lien, count(*) from seances s join routines r on r.id = s.routine_id where s.owner_id <> r.owner_id
--   union all select 'seance_versions/seances', count(*) from seance_versions v join seances s on s.id = v.seance_id where v.owner_id <> s.owner_id
--   union all select 'prescriptions/seance_versions', count(*) from prescriptions p join seance_versions v on v.id = p.seance_version_id where p.owner_id <> v.owner_id
--   union all select 'executions/seance_versions', count(*) from executions e join seance_versions v on v.id = e.seance_version_id where e.owner_id <> v.owner_id
--   union all select 'performed_sets/executions', count(*) from performed_sets ps join executions e on e.id = ps.execution_id where ps.owner_id <> e.owner_id
--   union all select 'dated_notes/executions', count(*) from dated_notes d join executions e on e.id = d.execution_id where d.owner_id <> e.owner_id
--   union all select 'routine_activations/routines', count(*) from routine_activations a join routines r on r.id = a.routine_id where a.owner_id <> r.owner_id
--   union all select 'seance_archive_events/seances', count(*) from seance_archive_events ev join seances s on s.id = ev.seance_id where ev.owner_id <> s.owner_id
--   union all select 'prescriptions/exercises', count(*) from prescriptions p join exercises x on x.id = p.exercise_id where x.owner_id is not null and x.owner_id <> p.owner_id
--   union all select 'performed_sets/exercises', count(*) from performed_sets ps join exercises x on x.id = ps.exercise_id where x.owner_id is not null and x.owner_id <> ps.owner_id
--   union all select 'dated_notes/exercises', count(*) from dated_notes d join exercises x on x.id = d.exercise_id where x.owner_id is not null and x.owner_id <> d.owner_id
--   union all select 'exercise_notes/exercises', count(*) from exercise_notes n join exercises x on x.id = n.exercise_id where x.owner_id is not null and x.owner_id <> n.user_id;
--
-- Et les noms normalisés en double dans une routine (attendu : aucune ligne ;
-- l'index de la migration 0013 le garantit déjà, sauf dérive) :
--
--   select routine_id, lower(btrim(regexp_replace(name, '\s+', ' ', 'g'))), count(*)
--   from seances group by 1, 2 having count(*) > 1;
--
-- Et les clés étrangères en place (attendu : les huit noms `<table>_<colonne>_fkey`
-- remplacés plus bas, sur une seule colonne ; un autre nom signale une dérive) :
--
--   select conrelid::regclass, conname, confdeltype, pg_get_constraintdef(oid)
--   from pg_constraint where connamespace = 'public'::regnamespace and contype = 'f' order by 1, 2;
--
-- SI UN COMPTE N'EST PAS À 0 : aucune règle automatique n'est sûre, la ligne
-- appartient à un compte et pointe chez un autre. Lister les lignes (même
-- jointure, `select *`), identifier d'où elles viennent (file d'un appareil
-- partagé remontée sous un autre compte, ou écriture directe par l'API), puis,
-- avec les propriétaires : soit les supprimer chez le compte qui les porte à
-- tort, soit les rendre à leur vrai compte (`update ... set owner_id = ...`,
-- avec le rôle postgres). Appliquer ensuite.
--
-- RISQUE : moyen. C'est la migration la plus structurante du lot : huit clés
-- étrangères remplacées. Elle n'écrit aucune ligne et s'annule en entier au
-- moindre échec. À appliquer hors des heures de salle, puis ouvrir l'app et
-- vérifier une séance (lecture du plan, saisie d'une série).

begin;

-- 1. Parents : cible `(id, owner_id)` des clés composites ---------------------

do $$
declare
  v_table text;
begin
  foreach v_table in array array['routines', 'seances', 'seance_versions', 'executions'] loop
    if not exists (
      select 1 from pg_constraint
      where conrelid = format('public.%I', v_table)::regclass
        and conname = v_table || '_id_owner_id_key'
    ) then
      execute format(
        'alter table public.%I add constraint %I unique (id, owner_id)',
        v_table, v_table || '_id_owner_id_key'
      );
    end if;
  end loop;
end;
$$;

-- 2. Clés étrangères composites, remplacées sous le même nom ------------------

alter table public.seances drop constraint if exists seances_routine_id_fkey;
alter table public.seances add constraint seances_routine_id_fkey
  foreign key (routine_id, owner_id) references public.routines (id, owner_id) on delete cascade;

alter table public.routine_activations drop constraint if exists routine_activations_routine_id_fkey;
alter table public.routine_activations add constraint routine_activations_routine_id_fkey
  foreign key (routine_id, owner_id) references public.routines (id, owner_id) on delete cascade;

alter table public.seance_versions drop constraint if exists seance_versions_seance_id_fkey;
alter table public.seance_versions add constraint seance_versions_seance_id_fkey
  foreign key (seance_id, owner_id) references public.seances (id, owner_id) on delete cascade;

alter table public.seance_archive_events drop constraint if exists seance_archive_events_seance_id_fkey;
alter table public.seance_archive_events add constraint seance_archive_events_seance_id_fkey
  foreign key (seance_id, owner_id) references public.seances (id, owner_id) on delete cascade;

alter table public.prescriptions drop constraint if exists prescriptions_seance_version_id_fkey;
alter table public.prescriptions add constraint prescriptions_seance_version_id_fkey
  foreign key (seance_version_id, owner_id) references public.seance_versions (id, owner_id) on delete cascade;

-- NO ACTION, comme la migration 0014 : une séance exécutée ne se supprime pas.
alter table public.executions drop constraint if exists executions_seance_version_id_fkey;
alter table public.executions add constraint executions_seance_version_id_fkey
  foreign key (seance_version_id, owner_id) references public.seance_versions (id, owner_id);

alter table public.performed_sets drop constraint if exists performed_sets_execution_id_fkey;
alter table public.performed_sets add constraint performed_sets_execution_id_fkey
  foreign key (execution_id, owner_id) references public.executions (id, owner_id) on delete cascade;

alter table public.dated_notes drop constraint if exists dated_notes_execution_id_fkey;
alter table public.dated_notes add constraint dated_notes_execution_id_fkey
  foreign key (execution_id, owner_id) references public.executions (id, owner_id) on delete cascade;

-- Garde : une seule clé étrangère entre deux tables de `public`. Une ancienne
-- clé restée sous un autre nom (dérive) rendrait les jointures PostgREST
-- ambiguës : mieux vaut tout annuler.
do $$
declare
  v_doublons text;
begin
  select string_agg(format('%s -> %s', enfant, parent), ', ') into v_doublons from (
    select conrelid::regclass::text as enfant, confrelid::regclass::text as parent
    from pg_constraint
    where contype = 'f'
      and connamespace = 'public'::regnamespace
      and confrelid in (
        'public.routines'::regclass, 'public.seances'::regclass,
        'public.seance_versions'::regclass, 'public.executions'::regclass
      )
    group by 1, 2 having count(*) > 1
  ) d;
  if v_doublons is not null then
    raise exception '0019 : plusieurs clés étrangères entre les mêmes tables (%). Dérive à corriger avant d''appliquer.', v_doublons;
  end if;
end;
$$;

-- 3. Unicités : `owner_id` en tête -------------------------------------------

drop index if exists public.seances_routine_name_unique;
create unique index seances_routine_name_unique
  on public.seances (owner_id, routine_id, lower(btrim(regexp_replace(name, '\s+', ' ', 'g'))));

alter table public.seance_versions drop constraint if exists seance_versions_seance_id_version_key;
alter table public.seance_versions add constraint seance_versions_seance_id_version_key
  unique (owner_id, seance_id, version);

-- 4. Liens vers `exercises` : exo de base ou exo du compte de la ligne ---------

-- Garde : le trigger ne revérifie pas les lignes déjà en base.
do $$
declare
  v_croises int;
begin
  select
      (select count(*) from public.prescriptions p join public.exercises x on x.id = p.exercise_id
        where x.owner_id is not null and x.owner_id <> p.owner_id)
    + (select count(*) from public.performed_sets ps join public.exercises x on x.id = ps.exercise_id
        where x.owner_id is not null and x.owner_id <> ps.owner_id)
    + (select count(*) from public.dated_notes d join public.exercises x on x.id = d.exercise_id
        where x.owner_id is not null and x.owner_id <> d.owner_id)
    + (select count(*) from public.exercise_notes n join public.exercises x on x.id = n.exercise_id
        where x.owner_id is not null and x.owner_id <> n.user_id)
    into v_croises;
  if v_croises > 0 then
    raise exception
      '0019 : % ligne(s) pointent l''exo perso d''un autre compte. Voir le contrôle préalable en tête de fichier.',
      v_croises;
  end if;
end;
$$;

-- TG_ARGV[0] : la colonne qui porte le compte de la ligne (`owner_id` ou `user_id`).
create or replace function public.check_exercise_link()
returns trigger
language plpgsql
set search_path = ''  -- durcit le search_path (advisor function_search_path_mutable)
as $$
declare
  v_compte uuid := (to_jsonb(new) ->> tg_argv[0])::uuid;
begin
  if not exists (
    select 1 from public.exercises x
    where x.id = new.exercise_id
      and (x.owner_id is null or x.owner_id = v_compte)
  ) then
    raise exception 'L''exercice % n''est ni un exo de base ni un exo de ce compte.', new.exercise_id
      using errcode = '23503', table = tg_table_name, column = 'exercise_id';
  end if;
  return new;
end;
$$;

drop trigger if exists check_exercise_link on public.prescriptions;
create trigger check_exercise_link before insert or update of exercise_id, owner_id on public.prescriptions
  for each row execute function public.check_exercise_link('owner_id');

drop trigger if exists check_exercise_link on public.performed_sets;
create trigger check_exercise_link before insert or update of exercise_id, owner_id on public.performed_sets
  for each row execute function public.check_exercise_link('owner_id');

drop trigger if exists check_exercise_link on public.dated_notes;
create trigger check_exercise_link before insert or update of exercise_id, owner_id on public.dated_notes
  for each row execute function public.check_exercise_link('owner_id');

drop trigger if exists check_exercise_link on public.exercise_notes;
create trigger check_exercise_link before insert or update of exercise_id, user_id on public.exercise_notes
  for each row execute function public.check_exercise_link('user_id');

-- Les clés étrangères ont changé de forme : PostgREST relit son schéma.
notify pgrst, 'reload schema';

commit;
