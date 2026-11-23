-- Bouchons du banc d'essai local : ce que Supabase fournit et qu'un Postgres nu
-- n'a pas. Jamais lancé sur la prod (voir lancer.sh).
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

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema extensions;
create schema auth;
create table auth.users (id uuid primary key, email text);
-- Le compte connecté : PostgREST le pose dans ce GUC, le banc aussi.
create function auth.uid() returns uuid language sql stable
  as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth, public to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
-- Droits par défaut d'un projet Supabase d'avant le 2026-10-30.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

commit;
