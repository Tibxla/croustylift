-- Migration: init_schema
-- Schéma initial de Croustylift (cf. docs/adr/0001, 0002, 0003).
--
-- Conventions (ADR 0003) :
--   - id uuid primary key default gen_random_uuid() (UUID générés client offline ;
--     le default ne couvre que les insertions serveur).
--   - created_at / updated_at timestamptz not null default now().
--   - Trigger BEFORE UPDATE -> set_updated_at() sur chaque table mutable.
--   - owner_id uuid not null default auth.uid() references auth.users on delete cascade
--     (exception : exercises.owner_id nullable = exo de base global).
--   - RLS activée partout, policies denormalisées sur owner_id / user_id (pas de jointure).

-- =====================================================================
-- Extensions
-- =====================================================================
-- gen_random_uuid() est fourni par pgcrypto. Sur Supabase l'extension vit
-- dans le schéma "extensions" ; on s'assure qu'elle est présente.
create extension if not exists pgcrypto with schema extensions;

-- =====================================================================
-- Fonction trigger updated_at
-- =====================================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''  -- durcit le search_path (advisor function_search_path_mutable)
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =====================================================================
-- 1. exercises — catalogue (base global owner_id null + perso owner_id user)
-- =====================================================================
create table public.exercises (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users (id) on delete cascade default auth.uid(),
  name text not null,
  muscle_group text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =====================================================================
-- 2. exercise_notes — note d'instructions par (user, exo)
-- =====================================================================
create table public.exercise_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id) on delete cascade,
  body text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, exercise_id)
);

-- =====================================================================
-- 3. routines
-- =====================================================================
create table public.routines (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =====================================================================
-- 4. seances — template, dans une routine
-- =====================================================================
create table public.seances (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  routine_id uuid not null references public.routines (id) on delete cascade,
  name text not null,
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =====================================================================
-- 5. seance_versions — versionnage (ADR 0001). Append-only : pas d'updated_at.
-- =====================================================================
create table public.seance_versions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  seance_id uuid not null references public.seances (id) on delete cascade,
  version int not null,
  created_at timestamptz not null default now(),
  unique (seance_id, version)
);

-- =====================================================================
-- 6. prescriptions — par (seance_version, exo)
-- =====================================================================
create table public.prescriptions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  seance_version_id uuid not null references public.seance_versions (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id),
  position int not null default 0,
  sets_min int not null,
  sets_max int not null,
  reps_min int not null,
  reps_max int not null,
  rir_min int not null,
  rir_max int not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint prescriptions_sets_min_check check (sets_min >= 1),
  constraint prescriptions_sets_range_check check (sets_min <= sets_max),
  constraint prescriptions_reps_min_check check (reps_min >= 1),
  constraint prescriptions_reps_range_check check (reps_min <= reps_max),
  constraint prescriptions_rir_min_check check (rir_min >= 0),
  constraint prescriptions_rir_range_check check (rir_min <= rir_max)
);

-- =====================================================================
-- 7. executions — séance réalisée
-- =====================================================================
create table public.executions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  seance_version_id uuid references public.seance_versions (id) on delete set null,
  performed_on date not null,
  bpm_avg int,
  duration_min int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint executions_bpm_avg_check check (bpm_avg is null or bpm_avg > 0),
  constraint executions_duration_min_check check (duration_min is null or duration_min > 0)
);

-- =====================================================================
-- 8. performed_sets — série de travail loggée
-- =====================================================================
create table public.performed_sets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  execution_id uuid not null references public.executions (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id),
  set_order int not null,
  exercise_position int,
  weight_kg numeric(6, 2) not null,
  reps int not null,
  rir int not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint performed_sets_set_order_check check (set_order >= 1),
  constraint performed_sets_weight_kg_check check (weight_kg >= 0),
  constraint performed_sets_reps_check check (reps >= 1),
  constraint performed_sets_rir_check check (rir >= 0)
);

-- =====================================================================
-- 9. dated_notes — note datée par (execution, exo)
-- =====================================================================
create table public.dated_notes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  execution_id uuid not null references public.executions (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id),
  body text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =====================================================================
-- 10. routine_activations — timeline de la routine courante (ADR 0001)
-- =====================================================================
create table public.routine_activations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  routine_id uuid not null references public.routines (id) on delete cascade,
  activated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =====================================================================
-- Index sur les FK les plus requêtées
-- =====================================================================
create index performed_sets_execution_id_idx on public.performed_sets (execution_id);
create index performed_sets_exercise_id_idx on public.performed_sets (exercise_id);
create index executions_owner_id_performed_on_idx on public.executions (owner_id, performed_on);
create index prescriptions_seance_version_id_idx on public.prescriptions (seance_version_id);
create index seance_versions_seance_id_idx on public.seance_versions (seance_id);

-- =====================================================================
-- Triggers updated_at (toutes les tables mutables ; pas seance_versions)
-- =====================================================================
create trigger set_updated_at before update on public.exercises
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.exercise_notes
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.routines
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.seances
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.prescriptions
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.executions
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.performed_sets
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.dated_notes
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.routine_activations
  for each row execute function public.set_updated_at();

-- =====================================================================
-- RLS : activation sur toutes les tables
-- =====================================================================
alter table public.exercises            enable row level security;
alter table public.exercise_notes       enable row level security;
alter table public.routines             enable row level security;
alter table public.seances              enable row level security;
alter table public.seance_versions      enable row level security;
alter table public.prescriptions        enable row level security;
alter table public.executions           enable row level security;
alter table public.performed_sets       enable row level security;
alter table public.dated_notes          enable row level security;
alter table public.routine_activations  enable row level security;

-- =====================================================================
-- Policies
-- =====================================================================

-- exercises : base global (owner_id null) en lecture seule pour tous ;
-- exo perso (owner_id = uid) en CRUD complet.
create policy exercises_select on public.exercises
  for select to authenticated
  using (owner_id is null or owner_id = auth.uid());
create policy exercises_insert on public.exercises
  for insert to authenticated
  with check (owner_id = auth.uid());
create policy exercises_update on public.exercises
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());
create policy exercises_delete on public.exercises
  for delete to authenticated
  using (owner_id = auth.uid());

-- exercise_notes : owner = user_id
create policy exercise_notes_all on public.exercise_notes
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- routines
create policy routines_all on public.routines
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- seances
create policy seances_all on public.seances
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- seance_versions
create policy seance_versions_all on public.seance_versions
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- prescriptions
create policy prescriptions_all on public.prescriptions
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- executions
create policy executions_all on public.executions
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- performed_sets
create policy performed_sets_all on public.performed_sets
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- dated_notes
create policy dated_notes_all on public.dated_notes
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- routine_activations
create policy routine_activations_all on public.routine_activations
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());
