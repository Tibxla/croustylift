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
  select 'trigger seances_en_fin (ajout et désarchivage en fin, sous le verrou de la routine), fonction en SECURITY INVOKER, search_path figé',
         exists (select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid
                 where t.tgrelid = 'public.seances'::regclass and t.tgname = 'seances_en_fin' and not t.tgisinternal
                   and t.tgenabled = 'O' and not p.prosecdef and p.proconfig @> array['search_path=""']),
         'ajout concurrent d''un réordonnancement placé au milieu, ou échappant au contrôle de révision'
  union all
  select 'l''ancienne reorder_seances(uuid, uuid[]) est toujours là',
         to_regprocedure('public.reorder_seances(uuid, uuid[])') is not null,
         'ancien client (PWA pas encore rechargée) incapable de réordonner'
) t order by 1 desc, 2;
