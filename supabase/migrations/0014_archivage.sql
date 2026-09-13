-- 0014 — archivage des routines et des séances (ADR 0017).
--
-- Une routine ou une séance déjà exécutée ne se supprime plus : elle s'archive.
-- Archivée, elle sort du plan (ni routine courante, ni séance en salle) mais son
-- historique reste entier. Le désarchivage la rend au plan.
--
-- 1. `archived_at` sur `routines` et `seances` : l'état courant (null = actif),
--    lu par la liste de l'authoring et le choix de séance en salle.
--
-- 2. `seance_archive_events` : le journal DATÉ des archivages / désarchivages de
--    séance, append-only comme `routine_activations`. La timeline des blocs le
--    rejoue : archiver une séance de la routine courante change la configuration
--    du template, donc coupe un bloc. Une simple date effacée au désarchivage
--    réécrirait les blocs passés (ADR 0017). Pas de journal pour les routines :
--    la routine courante ne s'archive pas, et une routine archivée ne compte
--    dans aucune configuration tant qu'elle n'est pas réactivée.
--
--    Le journal est alimenté par un TRIGGER sur `seances` : le client ne fait
--    qu'une écriture (`archived_at`), l'événement suit dans la même transaction.
--    Deux écritures client pourraient diverger (événement sans état, ou
--    l'inverse) et mentir aux blocs. Le trigger date aussi l'archivage à l'heure
--    du serveur, pour que l'état et l'événement portent le même instant.
--
-- 3. `executions.seance_version_id` passe de `on delete set null` à `no action` :
--    supprimer une séance (ou une routine) qui a des exécutions est refusé par la
--    base (23503), au lieu de laisser des exécutions orphelines regroupées en
--    « Hors séance ». NO ACTION plutôt que RESTRICT : la vérification a lieu en
--    fin d'instruction, donc la suppression d'un compte (cascade depuis
--    auth.users qui emporte aussi les exécutions) passe toujours.

-- 1. État courant ------------------------------------------------------------

alter table public.routines add column archived_at timestamptz;
alter table public.seances  add column archived_at timestamptz;

-- 2. Journal daté des archivages de séance -----------------------------------

create table public.seance_archive_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  seance_id uuid not null references public.seances (id) on delete cascade,
  -- true = archivage, false = désarchivage.
  archived boolean not null,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index seance_archive_events_seance_id_idx
  on public.seance_archive_events (seance_id);

alter table public.seance_archive_events enable row level security;

create policy seance_archive_events_all on public.seance_archive_events
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- Trigger : un changement d'état d'archivage d'une séance écrit son événement.
-- Ré-archiver une séance déjà archivée ne change rien (ni date, ni événement).
create or replace function public.log_seance_archive()
returns trigger
language plpgsql
set search_path = ''  -- durcit le search_path (advisor function_search_path_mutable)
as $$
begin
  if (new.archived_at is null) = (old.archived_at is null) then
    new.archived_at = old.archived_at;
    return new;
  end if;

  if new.archived_at is not null then
    new.archived_at = now();
  end if;

  insert into public.seance_archive_events (owner_id, seance_id, archived, occurred_at)
  values (new.owner_id, new.id, new.archived_at is not null, now());

  return new;
end;
$$;

create trigger log_seance_archive before update of archived_at on public.seances
  for each row execute function public.log_seance_archive();

-- 3. Plus d'exécution orpheline -----------------------------------------------

alter table public.executions
  drop constraint executions_seance_version_id_fkey;

alter table public.executions
  add constraint executions_seance_version_id_fkey
  foreign key (seance_version_id) references public.seance_versions (id);
