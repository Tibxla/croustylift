-- Essais d'import du banc LOCAL, joués AVANT la migration 0021 : le client qui
-- importe par `import_user_data` (0024) est déployé avant elle (ORDRE.md), et
-- l'import doit donc tenir seul la règle « la routine courante n'est jamais
-- archivée ». Sous le rôle de l'API, dans une transaction annulée à la fin.
-- Les mêmes cas sont rejoués après 0021 dans 02_refus.sql. Jamais lancé sur la prod.
\set A '''aaaaaaaa-0000-0000-0000-000000000001'''

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
grant usage on schema banc to authenticated;

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

select banc.vrai('la migration 0021 n''est pas encore appliquée',
  not exists (select 1 from pg_trigger where tgname in ('refuse_archive_current_routine', 'refuse_activate_archived_routine')));

set local role authenticated;
select set_config('request.jwt.claim.sub', :A, true);

-- Fichier invalide par lui-même : il crée une routine déjà archivée et en fait
-- la routine courante. Sans le contrôle de l'import, il passait ici.
select banc.refuse('sauvegarde retouchée : elle crée une routine archivée et la rend courante', '23514',
  format('select public.import_user_data(%L::jsonb)', jsonb_build_object(
    'routines', jsonb_build_array(
      jsonb_build_object('id', 'a0000000-0000-0000-0000-0000000000d7', 'name', 'Fantôme', 'archived_at', '2026-11-01T00:00:00Z'),
      jsonb_build_object('id', 'a0000000-0000-0000-0000-0000000000a1', 'name', 'PPL retouchée')),
    'routine_activations', jsonb_build_array(
      jsonb_build_object('id', 'a0000000-0000-0000-0000-0000000000ca', 'routine_id', 'a0000000-0000-0000-0000-0000000000d7', 'activated_at', '2099-01-01T00:00:00Z')))));
select banc.vrai('refusé en entier : ni Fantôme ni le nouveau nom de PPL',
  (select count(*) = 0 from public.routines where id = 'a0000000-0000-0000-0000-0000000000d7')
  and (select name = 'PPL' from public.routines where id = 'a0000000-0000-0000-0000-0000000000a1'));

-- Sauvegarde où la routine courante du compte (PPL) est archivée : restaurée,
-- sauf cet archivage (X26).
select banc.accepte('sauvegarde où la routine courante du compte est archivée : restaurée',
  format('select public.import_user_data(%L::jsonb)', jsonb_build_object(
    'routines', jsonb_build_array(
      jsonb_build_object('id', 'a0000000-0000-0000-0000-0000000000a1', 'name', 'PPL restaurée', 'archived_at', '2026-11-01T00:00:00Z'),
      jsonb_build_object('id', 'a0000000-0000-0000-0000-0000000000a2', 'name', 'Upper Lower', 'archived_at', '2026-10-01T00:00:00Z')))));
select banc.vrai('PPL reste courante et active, Upper Lower est archivée',
  (select name = 'PPL restaurée' and archived_at is null from public.routines where id = 'a0000000-0000-0000-0000-0000000000a1')
  and (select archived_at is not null from public.routines where id = 'a0000000-0000-0000-0000-0000000000a2')
  and (select a.routine_id = 'a0000000-0000-0000-0000-0000000000a1' from public.routine_activations a order by a.activated_at desc limit 1));

-- Compte déjà dans l'état interdit (possible avant 0021, par un appel direct) :
-- l'import s'y refuse tant que le compte n'est pas réparé.
reset role;
update public.routines set archived_at = now() where id = 'a0000000-0000-0000-0000-0000000000a1';
set local role authenticated;
select banc.refuse('compte dont la routine courante est déjà archivée : import refusé, le message dit quoi faire', '23514',
  format('select public.import_user_data(%L::jsonb)', jsonb_build_object(
    'routines', jsonb_build_array(jsonb_build_object('id', 'a0000000-0000-0000-0000-0000000000a2', 'name', 'Upper Lower')))));
select banc.accepte('le même fichier, s''il désarchive la routine courante, passe',
  format('select public.import_user_data(%L::jsonb)', jsonb_build_object(
    'routines', jsonb_build_array(jsonb_build_object('id', 'a0000000-0000-0000-0000-0000000000a1', 'name', 'PPL', 'archived_at', null)))));

rollback;
