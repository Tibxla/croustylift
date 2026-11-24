-- Contrôle de la migration 0027 (lecture seule).
select case when ok then 'OK' else 'ECHEC' end as verdict, quoi, empeche from (
  select 'fonction create_seance(uuid, uuid, text, jsonb) en SECURITY INVOKER, search_path figé' as quoi,
         exists (select 1 from pg_proc p where p.oid = to_regprocedure('public.create_seance(uuid, uuid, text, jsonb)')
                   and not p.prosecdef and p.proconfig @> array['search_path=""']) as ok,
         'séance sans version (impossible à lancer) après une coupure, contournement de la RLS' as empeche
  union all
  select 'exécutable par authenticated, pas par anon ni public',
         has_function_privilege('authenticated', 'public.create_seance(uuid, uuid, text, jsonb)', 'execute')
         and not has_function_privilege('anon', 'public.create_seance(uuid, uuid, text, jsonb)', 'execute')
         and not has_function_privilege('public', 'public.create_seance(uuid, uuid, text, jsonb)', 'execute'),
         'appel sans compte'
) t order by 1 desc, 2;
