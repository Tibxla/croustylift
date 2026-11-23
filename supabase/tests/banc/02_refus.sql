-- Essais d'écriture du banc LOCAL : ce que les migrations 0015 à 0024 refusent,
-- et ce qu'elles doivent continuer d'accepter. Joué sous le rôle de l'API
-- (`authenticated`, compte porté par le GUC que lit auth.uid()), dans une
-- transaction annulée à la fin. Jamais lancé sur la prod.
\set A '''aaaaaaaa-0000-0000-0000-000000000001'''
\set B '''bbbbbbbb-0000-0000-0000-000000000002'''

begin;

-- Garde : ce fichier n'est fait que pour le banc local. Sur un projet Supabase
-- (schémas `storage` ou `supabase_migrations` présents), il s'arrête ici et la
-- transaction annule tout ce qui suit.
do $$
begin
  if exists (select 1 from pg_namespace where nspname in ('storage', 'supabase_migrations', 'realtime', 'vault')) then
    raise exception 'Fichier du banc local : à ne jamais lancer sur un projet Supabase.';
  end if;
end;
$$;

create schema banc;
grant usage on schema banc to authenticated, anon;

-- L'écriture doit échouer avec ce code SQLSTATE, sans laisser de trace.
create function banc.refuse(p_nom text, p_code text, p_sql text) returns text
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate = p_code then
      return format('OK    refusé (%s) : %s', p_code, p_nom);
    end if;
    raise exception 'ECHEC % : code % (%), attendu %', p_nom, sqlstate, sqlerrm, p_code;
  end;
  raise exception 'ECHEC % : écriture acceptée, refus % attendu', p_nom, p_code;
end;
$$;

-- L'écriture doit passer.
create function banc.accepte(p_nom text, p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return format('OK    accepté : %s', p_nom);
end;
$$;

create function banc.vrai(p_nom text, p_condition boolean) returns text
language plpgsql as $$
begin
  if p_condition is not true then
    raise exception 'ECHEC %', p_nom;
  end if;
  return format('OK    %s', p_nom);
end;
$$;

create function banc.compte(p_user uuid) returns void
language sql as $$ select set_config('request.jwt.claim.sub', p_user::text, true) $$;

set local role authenticated;

-- ===================== 0015 : la RLS garde son sens =====================
select banc.compte(:A);
select banc.vrai('A lit ses 2 routines et aucune de B', (select count(*) from public.routines) = 2);
select banc.vrai('A lit les exos de base et son exo perso',
  (select count(*) filter (where owner_id is null) > 0 and count(*) filter (where owner_id is not null) = 1 from public.exercises));
select banc.compte(:B);
select banc.vrai('B ne lit ni les séries ni les notes de A',
  (select count(*) from public.performed_sets) = 0 and (select count(*) from public.dated_notes) = 0);
select banc.refuse('B écrit une routine au nom de A', '42501',
  format('insert into public.routines (owner_id, name) values (%L, ''vol'')', :A));

-- ===================== 0016 : bornes de taille =====================
select banc.compte(:A);
select banc.accepte('nom de routine de 200 caractères',
  format('insert into public.routines (name) values (%L)', repeat('é', 200)));
select banc.refuse('nom de routine de 201 caractères', '23514',
  format('insert into public.routines (name) values (%L)', repeat('n', 201)));
select banc.refuse('nom de séance de 201 caractères', '23514',
  format('update public.seances set name = %L where id = ''a0000000-0000-0000-0000-0000000000b1''', repeat('n', 201)));
select banc.accepte('note datée de 5000 caractères',
  format('update public.dated_notes set body = %L where id = ''a0000000-0000-0000-0000-000000000031''', repeat('x', 5000)));
select banc.refuse('note datée de 5001 caractères', '23514',
  format('update public.dated_notes set body = %L where id = ''a0000000-0000-0000-0000-000000000031''', repeat('x', 5001)));
select banc.refuse('note d''instructions de 1 Mo', '23514',
  format('insert into public.exercise_notes (exercise_id, body) values (''a0000000-0000-0000-0000-0000000000e1'', %L)', repeat('x', 1000000)));
select banc.refuse('exo à 31 muscles', '23514',
  'insert into public.exercises (name, muscle_group, primary_muscles) select ''x'', ''dos'', array_agg(''m'' || i) from generate_series(1, 31) i');
select banc.refuse('exo à un muscle de 1501 caractères', '23514',
  format('insert into public.exercises (name, muscle_group, primary_muscles) values (''x'', ''dos'', array[%L])', repeat('m', 1501)));
select banc.refuse('override au nom de 201 caractères', '23514',
  format('insert into public.exercise_overrides (exercise_id, name) select id, %L from public.exercises where owner_id is null limit 1', repeat('n', 201)));

-- ===================== 0017 : au moins un muscle =====================
select banc.refuse('exo sans muscle principal', '23514',
  'insert into public.exercises (name, muscle_group, primary_muscles) values (''x'', ''dos'', ''{}'')');
select banc.refuse('exo sans muscle principal (défaut de la colonne)', '23514',
  'insert into public.exercises (name, muscle_group) values (''x'', ''dos'')');
select banc.accepte('exo perso à un muscle',
  'insert into public.exercises (id, name, muscle_group, primary_muscles) values (''a0000000-0000-0000-0000-0000000000e2'', ''Tirage maison'', ''dos'', ''{dos}'')');
select banc.accepte('override aux muscles vides (= pas d''override sur ce champ)',
  'insert into public.exercise_overrides (exercise_id, name, primary_muscles) select id, ''DC haltères'', ''{}'' from public.exercises where owner_id is null order by name limit 1');

select banc.compte(:B);
select banc.vrai('exo d''avant 0005 sans muscle : rempli depuis son groupe par la migration',
  (select primary_muscles = array['jambes'] from public.exercises where id = 'b0000000-0000-0000-0000-0000000000e1'));
select banc.compte(:A);

-- ===================== 0018 : une note datée par couple =====================
select banc.accepte('seconde note du même couple sous un autre id : elle remplace',
  'insert into public.dated_notes (id, execution_id, exercise_id, body) values (''a0000000-0000-0000-0000-000000000032'', ''a0000000-0000-0000-0000-000000000011'', ''a0000000-0000-0000-0000-0000000000e1'', ''nouvelle note'')');
select banc.vrai('une seule note reste pour le couple, la dernière écrite',
  (select count(*) = 1 and min(body) = 'nouvelle note' and min(id::text) = 'a0000000-0000-0000-0000-000000000032'
   from public.dated_notes where execution_id = 'a0000000-0000-0000-0000-000000000011'));
select banc.accepte('rejouer la même note par son id (upsert de l''outbox)',
  'insert into public.dated_notes (id, execution_id, exercise_id, body) values (''a0000000-0000-0000-0000-000000000032'', ''a0000000-0000-0000-0000-000000000011'', ''a0000000-0000-0000-0000-0000000000e1'', ''rejouée'') on conflict (id) do update set body = excluded.body');
select banc.vrai('toujours une seule note, corps mis à jour',
  (select count(*) = 1 and min(body) = 'rejouée' from public.dated_notes where execution_id = 'a0000000-0000-0000-0000-000000000011'));
select banc.accepte('note d''un autre exo dans la même exécution',
  'insert into public.dated_notes (execution_id, exercise_id, body) values (''a0000000-0000-0000-0000-000000000011'', ''a0000000-0000-0000-0000-0000000000e2'', ''autre exo'')');
select banc.refuse('déplacer une note sur un couple déjà pris', '23505',
  'update public.dated_notes set exercise_id = ''a0000000-0000-0000-0000-0000000000e1'' where exercise_id = ''a0000000-0000-0000-0000-0000000000e2''');

-- ===================== 0019 : liens du même compte =====================
select banc.compte(:B);
select banc.refuse('B pose une séance au nom déjà pris dans la routine de A', '23503',
  'insert into public.seances (routine_id, name) values (''a0000000-0000-0000-0000-0000000000a1'', ''Push'')');
select banc.refuse('B pose une version déjà numérotée sur la séance de A', '23503',
  'insert into public.seance_versions (seance_id, version) values (''a0000000-0000-0000-0000-0000000000b1'', 1)');
select banc.refuse('B pose une exécution sur la version de A', '23503',
  'insert into public.executions (seance_version_id, performed_on) values (''a0000000-0000-0000-0000-0000000000d1'', ''2026-06-04'')');
select banc.refuse('B pose une prescription sur la version de A', '23503',
  'insert into public.prescriptions (seance_version_id, exercise_id, sets_min, sets_max, reps_min, reps_max, rir_min, rir_max) select ''a0000000-0000-0000-0000-0000000000d1'', id, 1, 1, 1, 1, 0, 0 from public.exercises where owner_id is null limit 1');
select banc.refuse('B pose une série dans l''exécution de A', '23503',
  'insert into public.performed_sets (execution_id, exercise_id, set_order, weight_kg, reps, rir) select ''a0000000-0000-0000-0000-000000000011'', id, 1, 10, 5, 0 from public.exercises where owner_id is null limit 1');
select banc.refuse('B pose une note datée dans l''exécution de A', '23503',
  'insert into public.dated_notes (execution_id, exercise_id, body) select ''a0000000-0000-0000-0000-000000000011'', id, ''x'' from public.exercises where owner_id is null limit 1');
select banc.refuse('B active la routine de A', '23503',
  'insert into public.routine_activations (routine_id) values (''a0000000-0000-0000-0000-0000000000a1'')');
select banc.refuse('B écrit dans le journal d''archivage de A', '23503',
  'insert into public.seance_archive_events (seance_id, archived) values (''a0000000-0000-0000-0000-0000000000b1'', true)');
select banc.refuse('B pose une série sur l''exo perso de A', '23503',
  'insert into public.performed_sets (execution_id, exercise_id, set_order, weight_kg, reps, rir) values (''b0000000-0000-0000-0000-000000000011'', ''a0000000-0000-0000-0000-0000000000e1'', 1, 10, 5, 0)');
select banc.refuse('B pose une note d''instructions sur l''exo perso de A', '23503',
  'insert into public.exercise_notes (exercise_id, body) values (''a0000000-0000-0000-0000-0000000000e1'', ''x'')');
select banc.refuse('B pose une note datée sur l''exo perso de A', '23503',
  'insert into public.dated_notes (execution_id, exercise_id, body) values (''b0000000-0000-0000-0000-000000000011'', ''a0000000-0000-0000-0000-0000000000e1'', ''x'')');
select banc.accepte('B pose une série sur un exo de base dans sa propre exécution',
  'insert into public.performed_sets (execution_id, exercise_id, set_order, weight_kg, reps, rir) select ''b0000000-0000-0000-0000-000000000011'', id, 1, 10, 5, 0 from public.exercises where owner_id is null limit 1');
select banc.accepte('B pose une exécution hors séance (sans version)',
  'insert into public.executions (performed_on) values (''2026-06-05'')');
select banc.compte(:A);
select banc.accepte('A pose une série sur son exo perso',
  'insert into public.performed_sets (execution_id, exercise_id, set_order, weight_kg, reps, rir) values (''a0000000-0000-0000-0000-000000000011'', ''a0000000-0000-0000-0000-0000000000e1'', 2, 22.5, 8, 1)');
select banc.accepte('A pose une note d''instructions sur un exo de base',
  'insert into public.exercise_notes (exercise_id, body) select id, ''coudes rentrés'' from public.exercises where owner_id is null limit 1');
select banc.refuse('A supprime sa séance exécutée (0014 tient toujours)', '23503',
  'delete from public.seances where id = ''a0000000-0000-0000-0000-0000000000b1''');
select banc.accepte('A crée une séance du même nom que celle de B, chacun dans sa routine',
  'insert into public.seances (routine_id, name, position) values (''a0000000-0000-0000-0000-0000000000a2'', ''Jour 1'', 0)');

-- ===================== 0020 : override d'un exo de base seulement =====================
select banc.refuse('A pose un override sur son exo perso', '23514',
  'insert into public.exercise_overrides (exercise_id, name) values (''a0000000-0000-0000-0000-0000000000e1'', ''x'')');
select banc.compte(:B);
select banc.refuse('B pose un override sur l''exo perso de A', '23514',
  'insert into public.exercise_overrides (exercise_id, name) values (''a0000000-0000-0000-0000-0000000000e1'', ''x'')');
select banc.accepte('B pose un override sur un exo de base',
  'insert into public.exercise_overrides (exercise_id, unilateral) select id, true from public.exercises where owner_id is null limit 1');

-- ===================== 0021 : routine courante jamais archivée =====================
select banc.compte(:A);
select banc.refuse('A archive sa routine courante', '23514',
  'update public.routines set archived_at = now() where id = ''a0000000-0000-0000-0000-0000000000a1''');
select banc.accepte('A archive une routine qui n''est pas la courante',
  'update public.routines set archived_at = now() where id = ''a0000000-0000-0000-0000-0000000000a2''');
select banc.accepte('A réécrit une routine déjà archivée (upsert de l''import)',
  'update public.routines set archived_at = ''2026-05-01'', name = name where id = ''a0000000-0000-0000-0000-0000000000a2''');
select banc.refuse('A définit la routine archivée comme courante', '23514',
  'insert into public.routine_activations (routine_id) values (''a0000000-0000-0000-0000-0000000000a2'')');
select banc.accepte('A restaure une activation passée de la routine archivée',
  'insert into public.routine_activations (routine_id, activated_at) values (''a0000000-0000-0000-0000-0000000000a2'', ''2025-12-01'')');
select banc.accepte('A restaure en une instruction une activation récente de l''archivée et une plus récente de la courante',
  'insert into public.routine_activations (routine_id, activated_at) values (''a0000000-0000-0000-0000-0000000000a2'', ''2026-07-01''), (''a0000000-0000-0000-0000-0000000000a1'', ''2026-07-02'')');
select banc.accepte('A désarchive puis définit comme courante',
  'update public.routines set archived_at = null where id = ''a0000000-0000-0000-0000-0000000000a2''; insert into public.routine_activations (routine_id) values (''a0000000-0000-0000-0000-0000000000a2'')');
select banc.accepte('A archive l''ancienne courante, qui ne l''est plus',
  'update public.routines set archived_at = now() where id = ''a0000000-0000-0000-0000-0000000000a1''');
select banc.accepte('retour à l''état de départ',
  'update public.routines set archived_at = null where id = ''a0000000-0000-0000-0000-0000000000a1''; insert into public.routine_activations (routine_id, activated_at) values (''a0000000-0000-0000-0000-0000000000a1'', now() + interval ''1 second'')');

-- ===================== 0022 : journal en insertion seule =====================
select banc.accepte('A archive une séance : le trigger écrit l''événement',
  'update public.seances set archived_at = now() where id = ''a0000000-0000-0000-0000-0000000000b2''');
select banc.vrai('un événement d''archivage dans le journal',
  (select count(*) = 1 and bool_and(archived) from public.seance_archive_events where seance_id = 'a0000000-0000-0000-0000-0000000000b2'));
update public.seance_archive_events set occurred_at = '2020-01-01', archived = false;
select banc.vrai('modifier le journal ne touche aucune ligne',
  (select bool_and(archived and occurred_at > '2026-01-01') from public.seance_archive_events));
delete from public.seance_archive_events;
select banc.vrai('vider le journal ne supprime aucune ligne', (select count(*) = 1 from public.seance_archive_events));
select banc.refuse('upsert de l''ancien import sur un événement existant', '42501',
  'insert into public.seance_archive_events (id, seance_id, archived) select id, seance_id, false from public.seance_archive_events on conflict (id) do update set archived = excluded.archived');
select banc.accepte('insertion sans réécriture (nouvel import)',
  'insert into public.seance_archive_events (id, seance_id, archived) select id, seance_id, false from public.seance_archive_events on conflict (id) do nothing');
select banc.compte(:B);
select banc.vrai('B ne lit pas le journal de A', (select count(*) = 0 from public.seance_archive_events));

-- ===================== 0023 : reorder_seances =====================
select banc.compte(:A);
select banc.accepte('A réordonne ses trois séances',
  'select public.reorder_seances(''a0000000-0000-0000-0000-0000000000a1'', array[''a0000000-0000-0000-0000-0000000000b3'', ''a0000000-0000-0000-0000-0000000000b1'', ''a0000000-0000-0000-0000-0000000000b2'']::uuid[])');
select banc.vrai('positions 0, 1, 2 dans l''ordre demandé',
  (select array_agg(name order by position) = array['Legs', 'Push', 'Pull'] and array_agg(position order by position) = array[0, 1, 2]
   from public.seances where routine_id = 'a0000000-0000-0000-0000-0000000000a1'));
select banc.refuse('une séance en double', '22023',
  'select public.reorder_seances(''a0000000-0000-0000-0000-0000000000a1'', array[''a0000000-0000-0000-0000-0000000000b1'', ''a0000000-0000-0000-0000-0000000000b1'']::uuid[])');
select banc.refuse('une séance de B dans la liste', '22023',
  'select public.reorder_seances(''a0000000-0000-0000-0000-0000000000a1'', array[''a0000000-0000-0000-0000-0000000000b2'', ''b0000000-0000-0000-0000-0000000000b1'']::uuid[])');
select banc.vrai('après un refus, aucune position n''a bougé',
  (select array_agg(name order by position) = array['Legs', 'Push', 'Pull'] from public.seances where routine_id = 'a0000000-0000-0000-0000-0000000000a1'));
select banc.compte(:B);
select banc.refuse('B réordonne la routine de A', '22023',
  'select public.reorder_seances(''a0000000-0000-0000-0000-0000000000a1'', array[''a0000000-0000-0000-0000-0000000000b1'']::uuid[])');
set local role anon;
select banc.refuse('appel anonyme de reorder_seances', '42501',
  'select public.reorder_seances(''a0000000-0000-0000-0000-0000000000a1'', array[]::uuid[])');
select banc.refuse('appel anonyme de import_user_data', '42501', 'select public.import_user_data(''{}''::jsonb)');
set local role authenticated;

-- ===================== 0024 : import transactionnel =====================
select banc.compte(:A);
-- Une sauvegarde de A : son état actuel, lu sous sa RLS, comme le fait l'export.
create temp table sauvegarde on commit drop as
select jsonb_build_object(
  'exercises', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.exercises t where owner_id is not null),
  'exercise_notes', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.exercise_notes t),
  'exercise_overrides', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.exercise_overrides t),
  'routines', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.routines t),
  'routine_activations', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.routine_activations t),
  'seances', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.seances t),
  'seance_archive_events', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.seance_archive_events t),
  'seance_versions', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.seance_versions t),
  'prescriptions', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.prescriptions t),
  'executions', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.executions t),
  'performed_sets', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.performed_sets t),
  'dated_notes', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.dated_notes t)
) as data;
create temp table avant on commit drop as
select (select count(*) from public.performed_sets) as series, (select count(*) from public.seance_archive_events) as evenements,
       (select count(*) from public.routines) as routines;

select banc.accepte('réimporter sa sauvegarde sur un compte inchangé',
  format('select public.import_user_data(%L::jsonb)', (select data from sauvegarde)));
select banc.vrai('réimport sans doublon ni événement d''archivage en plus',
  (select a.series = (select count(*) from public.performed_sets)
      and a.evenements = (select count(*) from public.seance_archive_events)
      and a.routines = (select count(*) from public.routines) from avant a));

-- Le compte change après la sauvegarde, puis on la restaure.
update public.seances set archived_at = null where id = 'a0000000-0000-0000-0000-0000000000b2';
update public.performed_sets set reps = 99 where id = 'a0000000-0000-0000-0000-000000000021';
delete from public.performed_sets where id <> 'a0000000-0000-0000-0000-000000000021';
select banc.vrai('le désarchivage hors import écrit bien son événement',
  (select count(*) = 2 from public.seance_archive_events where seance_id = 'a0000000-0000-0000-0000-0000000000b2'));
select banc.accepte('restaurer la sauvegarde sur un compte modifié',
  format('select public.import_user_data(%L::jsonb)', (select data from sauvegarde)));
select banc.vrai('série modifiée rendue à sa valeur, série supprimée revenue',
  (select (select reps from public.performed_sets where id = 'a0000000-0000-0000-0000-000000000021') = 10
      and (select count(*) from public.performed_sets) = (select series from avant)));
select banc.vrai('état d''archivage rendu par le fichier, sans événement daté de la restauration',
  (select (select archived_at is not null from public.seances where id = 'a0000000-0000-0000-0000-0000000000b2')
      and (select count(*) = 2 from public.seance_archive_events where seance_id = 'a0000000-0000-0000-0000-0000000000b2')));
select banc.accepte('après l''import, le trigger d''archivage a repris',
  'update public.seances set archived_at = null where id = ''a0000000-0000-0000-0000-0000000000b2''');
select banc.vrai('événement écrit de nouveau hors import',
  (select count(*) = 3 from public.seance_archive_events where seance_id = 'a0000000-0000-0000-0000-0000000000b2'));

-- Atomicité : la dernière table échoue, les premières ne doivent pas rester.
select banc.refuse('import dont une série pointe une exécution absente', '23503',
  format('select public.import_user_data(%L::jsonb)', jsonb_build_object(
    'routines', jsonb_build_array(jsonb_build_object('id', 'a0000000-0000-0000-0000-0000000000a9', 'name', 'Routine du fichier')),
    'performed_sets', jsonb_build_array(jsonb_build_object('id', 'a0000000-0000-0000-0000-000000000099',
      'execution_id', 'a0000000-0000-0000-0000-000000000098', 'exercise_id', 'a0000000-0000-0000-0000-0000000000e1',
      'set_order', 1, 'weight_kg', 10, 'reps', 5, 'rir', 0)))));
select banc.vrai('import refusé : la routine du fichier n''a pas été écrite',
  (select count(*) = 0 from public.routines where id = 'a0000000-0000-0000-0000-0000000000a9'));

-- Sauvegarde ancienne : colonnes absentes du fichier, clé inconnue de la table.
select banc.accepte('sauvegarde d''avant `unilateral`, `archived_at` et `side`, avec une clé inconnue',
  format('select public.import_user_data(%L::jsonb)', jsonb_build_object(
    'exercises', jsonb_build_array(jsonb_build_object('id', 'a0000000-0000-0000-0000-0000000000e9', 'name', 'Vieil exo',
      'muscle_group', 'dos', 'primary_muscles', jsonb_build_array('dos'), 'colonne_disparue', 1)),
    'routines', jsonb_build_array(jsonb_build_object('id', 'a0000000-0000-0000-0000-0000000000a8', 'name', 'Vieille routine')),
    'seance_archive_events', '[]'::jsonb, 'dated_notes', null)));
select banc.vrai('colonnes absentes : valeurs par défaut, compte de l''appelant',
  (select unilateral = false and owner_id = 'aaaaaaaa-0000-0000-0000-000000000001' from public.exercises where id = 'a0000000-0000-0000-0000-0000000000e9'));

-- Le fichier d'un autre compte ne s'importe pas chez soi, ni chez lui.
select banc.compte(:B);
select banc.refuse('B importe la sauvegarde de A (lignes au compte de A)', '42501',
  format('select public.import_user_data(%L::jsonb)', (select data from sauvegarde)));
select banc.refuse('B importe une ligne qui vise l''id d''une routine de A', '42501',
  format('select public.import_user_data(%L::jsonb)', jsonb_build_object(
    'routines', jsonb_build_array(jsonb_build_object('id', 'a0000000-0000-0000-0000-0000000000a1', 'name', 'Prise'))))) ;
select banc.refuse('B importe une ligne qui vise un exo de base', '42501',
  format('select public.import_user_data(%L::jsonb)', jsonb_build_object(
    'exercises', (select jsonb_agg(jsonb_build_object('id', id, 'name', 'Détourné', 'muscle_group', 'dos', 'primary_muscles', jsonb_build_array('dos')))
                  from (select id from public.exercises where owner_id is null limit 1) x))));
select banc.refuse('table qui n''est pas un tableau', '22023',
  'select public.import_user_data(''{"routines": "oops"}''::jsonb)');
select banc.refuse('ligne sans id', '22023',
  'select public.import_user_data(''{"routines": [{"name": "x"}]}''::jsonb)');
select banc.accepte('une table hors liste dans le fichier est ignorée',
  'select public.import_user_data(''{"auth.users": [{"id": "cccccccc-0000-0000-0000-000000000003"}], "pg_class": []}''::jsonb)');
reset role;
select banc.vrai('aucun compte créé par le fichier', (select count(*) = 2 from auth.users));

-- ===================== suppression de compte =====================
reset role;
delete from auth.users where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select banc.vrai('supprimer le compte A emporte toutes ses lignes, rien de B',
  (select count(*) = 0 from public.routines where owner_id = 'aaaaaaaa-0000-0000-0000-000000000001')
  and (select count(*) = 0 from public.executions where owner_id = 'aaaaaaaa-0000-0000-0000-000000000001')
  and (select count(*) = 0 from public.seance_archive_events where owner_id = 'aaaaaaaa-0000-0000-0000-000000000001')
  and (select count(*) > 0 from public.routines where owner_id = 'bbbbbbbb-0000-0000-0000-000000000002'));

rollback;
