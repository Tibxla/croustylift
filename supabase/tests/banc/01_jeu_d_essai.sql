-- Jeu d'essai du banc local : deux comptes (A et B), posé après les migrations
-- 0001 à 0014, donc AVANT les migrations testées (elles doivent passer sur une
-- base qui porte déjà des lignes).
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

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@banc.test'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'b@banc.test');

-- Compte A : un exo perso, une routine courante, une séance exécutée avec une note.
insert into public.exercises (id, owner_id, name, muscle_group, primary_muscles) values
  ('a0000000-0000-0000-0000-0000000000e1', 'aaaaaaaa-0000-0000-0000-000000000001', 'Curl maison', 'biceps', '{biceps}');
insert into public.routines (id, owner_id, name) values
  ('a0000000-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-000000000001', 'PPL'),
  ('a0000000-0000-0000-0000-0000000000a2', 'aaaaaaaa-0000-0000-0000-000000000001', 'Upper Lower');
insert into public.routine_activations (id, owner_id, routine_id, activated_at) values
  ('a0000000-0000-0000-0000-0000000000c1', 'aaaaaaaa-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000a2', '2026-01-01'),
  ('a0000000-0000-0000-0000-0000000000c2', 'aaaaaaaa-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000a1', '2026-06-01');
insert into public.seances (id, owner_id, routine_id, name, position) values
  ('a0000000-0000-0000-0000-0000000000b1', 'aaaaaaaa-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000a1', 'Push', 0),
  ('a0000000-0000-0000-0000-0000000000b2', 'aaaaaaaa-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000a1', 'Pull', 1),
  ('a0000000-0000-0000-0000-0000000000b3', 'aaaaaaaa-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000a1', 'Legs', 2);
insert into public.seance_versions (id, owner_id, seance_id, version) values
  ('a0000000-0000-0000-0000-0000000000d1', 'aaaaaaaa-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000b1', 1);
insert into public.prescriptions (id, owner_id, seance_version_id, exercise_id, sets_min, sets_max, reps_min, reps_max, rir_min, rir_max) values
  ('a0000000-0000-0000-0000-0000000000f1', 'aaaaaaaa-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000d1', 'a0000000-0000-0000-0000-0000000000e1', 2, 3, 8, 12, 0, 2);
insert into public.executions (id, owner_id, seance_version_id, performed_on) values
  ('a0000000-0000-0000-0000-000000000011', 'aaaaaaaa-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000d1', '2026-06-02');
insert into public.performed_sets (id, owner_id, execution_id, exercise_id, set_order, weight_kg, reps, rir) values
  ('a0000000-0000-0000-0000-000000000021', 'aaaaaaaa-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-0000000000e1', 1, 20, 10, 1);
insert into public.dated_notes (id, owner_id, execution_id, exercise_id, body) values
  ('a0000000-0000-0000-0000-000000000031', 'aaaaaaaa-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-0000000000e1', 'coude gauche sensible');

-- Compte B : une routine courante, de quoi tenter les liens croisés.
insert into public.routines (id, owner_id, name) values
  ('b0000000-0000-0000-0000-0000000000a1', 'bbbbbbbb-0000-0000-0000-000000000002', 'Full body');
insert into public.routine_activations (id, owner_id, routine_id, activated_at) values
  ('b0000000-0000-0000-0000-0000000000c1', 'bbbbbbbb-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000000a1', '2026-03-01');
insert into public.seances (id, owner_id, routine_id, name, position) values
  ('b0000000-0000-0000-0000-0000000000b1', 'bbbbbbbb-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000000a1', 'Jour 1', 0);
insert into public.seance_versions (id, owner_id, seance_id, version) values
  ('b0000000-0000-0000-0000-0000000000d1', 'bbbbbbbb-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000000b1', 1);
insert into public.executions (id, owner_id, seance_version_id, performed_on) values
  ('b0000000-0000-0000-0000-000000000011', 'bbbbbbbb-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000000d1', '2026-06-03');
-- Un exo perso resté sans muscle principal : la migration 0017 doit le remplir.
insert into public.exercises (id, owner_id, name, muscle_group, primary_muscles) values
  ('b0000000-0000-0000-0000-0000000000e1', 'bbbbbbbb-0000-0000-0000-000000000002', 'Presse maison', 'jambes', '{}');

commit;
