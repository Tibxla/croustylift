-- 0025 : supprimer une exécution seulement si elle est encore ouverte et vide
-- (relecture du moteur de la Salle, lot 3, constats 1 et 7).
--
-- « Changer de séance » part sans confirmation quand rien n'est saisi au
-- tableau. Mais le tableau d'un onglet ne voit pas ce qu'un autre onglet ou un
-- autre appareil a saisi dans la même exécution : un `delete` par id emportait
-- en cascade une série arrivée entre-temps. Le client ne peut pas vérifier puis
-- supprimer d'un seul tenant ; la base, si.
--
-- `delete_execution_if_empty(p_execution_id)` rend :
--   'deleted' : l'exécution était ouverte (closed_at nul), sans série ni note
--               datée ; elle est supprimée ;
--   'kept'    : elle est close, ou porte au moins une série ou une note ;
--   'absent'  : elle n'existe pas (ou n'est pas visible de l'appelant).
-- Idempotente : la rejouer ne change rien de plus.
--
-- TROIS INSTRUCTIONS, pas un seul `delete ... where not exists` : celui-ci
-- attendrait le verrou d'une insertion concurrente puis supprimerait sur son
-- ancien instantané, série fraîchement insérée comprise. Ici la ligne est
-- d'abord verrouillée (`for update`) : une insertion de série ou de note en
-- cours (verrou `for key share` de sa clé étrangère) est attendue, puis VUE par
-- la vérification, qui prend un instantané neuf (READ COMMITTED) ; une
-- insertion qui arrive après attend à son tour, puis est refusée par sa clé
-- étrangère (23503) si l'exécution a été supprimée. Rien ne part en cascade.
--
-- SECURITY INVOKER : la RLS de l'appelant s'applique, il ne touche que ses
-- exécutions.
--
-- Appel côté client : `supabase.rpc('delete_execution_if_empty', { p_execution_id })`
-- (`deleteExecutionIfEmpty`, src/features/capture/data.ts, qui ne supprime
-- rien et garde l'exécution tant que cette fonction n'est pas en base).
--
-- Rejouable (`create or replace`). Aucune donnée touchée.
--
-- CONTRÔLE PRÉALABLE (lecture seule). Attendu : aucune ligne (pas de fonction
-- du même nom déjà en base).
--
--   select p.oid::regprocedure from pg_proc p
--   where p.pronamespace = 'public'::regnamespace and p.proname = 'delete_execution_if_empty';
--
-- RISQUE : nul tant que le client ne l'appelle pas. Compatible avec le client
-- en place ; le client qui l'appelle marche aussi sans elle, mais ne
-- supprime alors aucune exécution vide (elle reste au Journal).

begin;

-- Attente bornée : un verrou pris ailleurs fait échouer la migration (à
-- relancer) au lieu de geler l'app derrière elle.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function public.delete_execution_if_empty(p_execution_id uuid)
returns text
language plpgsql
security invoker
set search_path = ''  -- durcit le search_path (advisor function_search_path_mutable)
as $$
declare
  v_closed_at timestamptz;
begin
  -- 1. Verrou : attend les insertions de séries et de notes en cours, bloque les suivantes.
  select e.closed_at into v_closed_at
    from public.executions e
    where e.id = p_execution_id
    for update;
  if not found then
    return 'absent';
  end if;

  -- 2. Vérification, sur un instantané pris après le verrou.
  if v_closed_at is not null then
    return 'kept';
  end if;
  if exists (select 1 from public.performed_sets s where s.execution_id = p_execution_id)
     or exists (select 1 from public.dated_notes n where n.execution_id = p_execution_id) then
    return 'kept';
  end if;

  -- 3. Suppression.
  delete from public.executions e where e.id = p_execution_id;
  return 'deleted';
end;
$$;

revoke execute on function public.delete_execution_if_empty(uuid) from public, anon;
grant execute on function public.delete_execution_if_empty(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
