-- Contrôle de la migration 0021 (lecture seule).
select case when ok then 'OK' else 'ECHEC' end as verdict, quoi, empeche from (
  select 'trigger refuse_archive_current_routine sur routines' as quoi,
         exists (select 1 from pg_trigger where tgrelid = 'public.routines'::regclass
                   and tgname = 'refuse_archive_current_routine' and tgenabled = 'O' and not tgisinternal) as ok,
         'archivage de la routine courante (23514)' as empeche
  union all
  select 'trigger refuse_activate_archived_routine sur routine_activations',
         exists (select 1 from pg_trigger where tgrelid = 'public.routine_activations'::regclass
                   and tgname = 'refuse_activate_archived_routine' and tgenabled = 'O' and not tgisinternal),
         'routine archivée définie comme courante (23514)'
  union all
  select 'aucun compte dont la routine courante est archivée',
         not exists (
           select 1 from (
             select distinct on (owner_id) owner_id, routine_id
             from routine_activations order by owner_id, activated_at desc
           ) c join routines r on r.id = c.routine_id where r.archived_at is not null),
         'compte sans séance proposée en salle'
) t order by 1 desc, 2;
