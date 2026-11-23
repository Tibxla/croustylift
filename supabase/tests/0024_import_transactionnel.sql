-- Contrôle de la migration 0024 (lecture seule).
select case when ok then 'OK' else 'ECHEC' end as verdict, quoi, empeche from (
  select 'fonction import_user_data(jsonb) en SECURITY INVOKER, search_path figé' as quoi,
         exists (select 1 from pg_proc p where p.oid = to_regprocedure('public.import_user_data(jsonb)')
                   and not p.prosecdef and p.proconfig @> array['search_path=""']) as ok,
         'import partiel (une seule transaction), écriture chez un autre compte (RLS de l''appelant)' as empeche
  union all
  select 'exécutable par authenticated, pas par anon ni public',
         has_function_privilege('authenticated', 'public.import_user_data(jsonb)', 'execute')
         and not has_function_privilege('anon', 'public.import_user_data(jsonb)', 'execute')
         and not has_function_privilege('public', 'public.import_user_data(jsonb)', 'execute'),
         'appel sans compte'
  union all
  select 'log_seance_archive se tait pendant un import, toujours en SECURITY INVOKER',
         exists (select 1 from pg_proc p where p.oid = to_regprocedure('public.log_seance_archive()')
                   and not p.prosecdef and p.proconfig @> array['search_path=""']
                   and p.prosrc like '%croustylift.import%'),
         'événement d''archivage en double, daté de la restauration'
  union all
  select 'import_user_data rapproche le journal de l''état des séances',
         exists (select 1 from pg_proc p where p.oid = to_regprocedure('public.import_user_data(jsonb)')
                   and p.prosrc like '%is distinct from coalesce(dernier.archived, false)%'),
         'séance masquée par le plan mais comptée par l''Analyse après une restauration, ou l''inverse'
  union all
  select 'import_user_data diffère les archivages nouveaux de routines après leurs activations, sous le verrou du compte',
         exists (select 1 from pg_proc p where p.oid = to_regprocedure('public.import_user_data(jsonb)')
                   and p.prosrc like '%when cible.archived_at is null then null else excluded.archived_at%'
                   and p.prosrc like '%f.archived_at is not null%and r.archived_at is null%'
                   and p.prosrc like '%croustylift.routine_courante:%'),
         'sauvegarde valide refusée (routine archivée dans le fichier, redevenue courante en base), import croisé avec un archivage'
  union all
  select 'import_user_data n''archive pas la routine courante du compte',
         exists (select 1 from pg_proc p where p.oid = to_regprocedure('public.import_user_data(jsonb)')
                   and p.prosrc like '%and r.archived_at is null%and r.id is distinct from (%order by a.activated_at desc%'),
         'restauration refusée en entier (routine archivée dans le fichier, réactivée depuis), routine courante archivée avant 0021'
  union all
  select 'aucune fonction SECURITY DEFINER dans public',
         not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and prosecdef),
         'fonction qui contournerait la RLS'
) t order by 1 desc, 2;
