-- Contrôle de la migration 0025 (lecture seule).
select case when ok then 'OK' else 'ECHEC' end as verdict, quoi, empeche from (
  select 'fonction delete_execution_if_empty(uuid) en SECURITY INVOKER, search_path figé' as quoi,
         exists (select 1 from pg_proc p where p.oid = to_regprocedure('public.delete_execution_if_empty(uuid)')
                   and not p.prosecdef and p.proconfig @> array['search_path=""']) as ok,
         'suppression en cascade d''une série arrivée entre la vérification et le delete, contournement de la RLS' as empeche
  union all
  select 'elle rend un texte (deleted, kept, absent)',
         exists (select 1 from pg_proc p where p.oid = to_regprocedure('public.delete_execution_if_empty(uuid)')
                   and p.prorettype = 'text'::regtype),
         'client incapable de savoir si l''exécution est partie'
  union all
  select 'exécutable par authenticated, pas par anon ni public',
         has_function_privilege('authenticated', 'public.delete_execution_if_empty(uuid)', 'execute')
         and not has_function_privilege('anon', 'public.delete_execution_if_empty(uuid)', 'execute')
         and not has_function_privilege('public', 'public.delete_execution_if_empty(uuid)', 'execute'),
         'appel sans compte'
) t order by 1 desc, 2;
