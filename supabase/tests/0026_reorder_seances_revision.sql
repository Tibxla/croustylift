-- Contrôle de la migration 0026 (lecture seule).
select case when ok then 'OK' else 'ECHEC' end as verdict, quoi, empeche from (
  select 'fonction reorder_seances_revision(uuid, uuid[], uuid[]) en SECURITY INVOKER, search_path figé' as quoi,
         exists (select 1 from pg_proc p where p.oid = to_regprocedure('public.reorder_seances_revision(uuid, uuid[], uuid[])')
                   and not p.prosecdef and p.proconfig @> array['search_path=""']) as ok,
         'réordonnancement d''un ordre dépassé, contournement de la RLS' as empeche
  union all
  select 'exécutable par authenticated, pas par anon ni public',
         has_function_privilege('authenticated', 'public.reorder_seances_revision(uuid, uuid[], uuid[])', 'execute')
         and not has_function_privilege('anon', 'public.reorder_seances_revision(uuid, uuid[], uuid[])', 'execute')
         and not has_function_privilege('public', 'public.reorder_seances_revision(uuid, uuid[], uuid[])', 'execute'),
         'appel sans compte'
  union all
  select 'l''ancienne reorder_seances(uuid, uuid[]) est toujours là',
         to_regprocedure('public.reorder_seances(uuid, uuid[])') is not null,
         'ancien client (PWA pas encore rechargée) incapable de réordonner'
) t order by 1 desc, 2;
