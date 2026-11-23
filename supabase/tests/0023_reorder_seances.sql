-- Contrôle de la migration 0023 (lecture seule).
select case when ok then 'OK' else 'ECHEC' end as verdict, quoi, empeche from (
  select 'fonction reorder_seances(uuid, uuid[]) en SECURITY INVOKER, search_path figé' as quoi,
         exists (select 1 from pg_proc p where p.oid = to_regprocedure('public.reorder_seances(uuid, uuid[])')
                   and not p.prosecdef and p.proconfig @> array['search_path=""']) as ok,
         'positions à moitié réécrites (une seule instruction), contournement de la RLS' as empeche
  union all
  select 'exécutable par authenticated, pas par anon ni public',
         has_function_privilege('authenticated', 'public.reorder_seances(uuid, uuid[])', 'execute')
         and not has_function_privilege('anon', 'public.reorder_seances(uuid, uuid[])', 'execute')
         and not has_function_privilege('public', 'public.reorder_seances(uuid, uuid[])', 'execute'),
         'appel sans compte'
) t order by 1 desc, 2;
