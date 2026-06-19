-- Migration: exercise_overrides
-- Personnalisation PER-USER des exos de BASE (issue #50).
--
-- Un exo de base (exercises.owner_id null) est COMMUN à tous : on ne le modifie
-- jamais. Pour qu'un user l'adapte à sa réalité (renommer, marquer unilatéral,
-- ajuster les muscles principaux) SANS toucher la ligne partagée, on stocke un
-- OVERRIDE par (user, exo). L'override gagne CHAMP PAR CHAMP à la lecture (cf.
-- domain/exercise-override.ts) : un champ NULL = pas d'override sur ce champ.
--
-- Conventions (ADR 0003, cf. 0001_init_schema) :
--   - id uuid primary key default gen_random_uuid() ;
--   - user_id uuid not null default auth.uid() references auth.users on delete cascade ;
--   - created_at / updated_at timestamptz not null default now() + trigger updated_at ;
--   - RLS activée, policies denormalisées sur user_id (jamais réécrit côté client).
--
-- Idempotente : create table if not exists + drop policy if exists avant chaque
-- create policy (le re-jeu de la migration ne lève pas).

-- =====================================================================
-- Table
-- =====================================================================
create table if not exists public.exercise_overrides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id) on delete cascade,
  -- Champs surchargeables : NULL = « pas d'override sur ce champ », la base gagne.
  name text,
  unilateral boolean,
  primary_muscles text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Un seul override par (user, exo) : l'upsert vise cette contrainte.
  unique (user_id, exercise_id)
);

-- =====================================================================
-- Trigger updated_at
-- =====================================================================
drop trigger if exists set_updated_at on public.exercise_overrides;
create trigger set_updated_at before update on public.exercise_overrides
  for each row execute function public.set_updated_at();

-- =====================================================================
-- RLS : un override n'est visible et modifiable que par son user
-- =====================================================================
alter table public.exercise_overrides enable row level security;

drop policy if exists exercise_overrides_select on public.exercise_overrides;
create policy exercise_overrides_select on public.exercise_overrides
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists exercise_overrides_insert on public.exercise_overrides;
create policy exercise_overrides_insert on public.exercise_overrides
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists exercise_overrides_update on public.exercise_overrides;
create policy exercise_overrides_update on public.exercise_overrides
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists exercise_overrides_delete on public.exercise_overrides;
create policy exercise_overrides_delete on public.exercise_overrides
  for delete to authenticated
  using (user_id = auth.uid());

-- =====================================================================
-- Index sur la FK la plus requêtée (jointure exo -> override à la lecture)
-- =====================================================================
create index if not exists exercise_overrides_exercise_id_idx
  on public.exercise_overrides (exercise_id);
