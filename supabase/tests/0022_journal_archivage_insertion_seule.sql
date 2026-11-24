-- Contrôle de la migration 0022 (lecture seule).
select case when ok then 'OK' else 'ECHEC' end as verdict, quoi, empeche from (
  select 'policies du journal : lecture et insertion, rien d''autre' as quoi,
         (select array_agg(cmd order by cmd) from pg_policies
           where schemaname = 'public' and tablename = 'seance_archive_events') = array['INSERT', 'SELECT'] as ok,
         'modification ou suppression d''un événement d''archivage par l''API' as empeche
  union all
  select 'policies du journal limitées au compte et au rôle authenticated',
         not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'seance_archive_events'
                       and (roles <> '{authenticated}'
                            or replace(coalesce(qual, with_check), ' ', '') not like '%owner_id=(SELECTauth.uid()ASuid)%')),
         'lecture ou écriture du journal d''un autre compte'
  union all
  select 'RLS toujours active sur le journal',
         (select relrowsecurity from pg_class where oid = 'public.seance_archive_events'::regclass),
         'journal ouvert à tous'
) t order by 1 desc, 2;
