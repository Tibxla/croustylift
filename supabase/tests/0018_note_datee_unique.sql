-- Contrôle de la migration 0018 (lecture seule).
select case when ok then 'OK' else 'ECHEC' end as verdict, quoi, empeche from (
  select 'index unique dated_notes_execution_exercise_unique' as quoi,
         exists (select 1 from pg_indexes where schemaname = 'public'
                   and indexname = 'dated_notes_execution_exercise_unique'
                   and indexdef like 'CREATE UNIQUE INDEX%(execution_id, exercise_id, owner_id)') as ok,
         'deux notes datées pour le même exo dans la même exécution' as empeche
  union all
  select 'index simple dated_notes_execution_id_idx retiré (préfixe de l''unique)',
         not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'dated_notes_execution_id_idx'),
         'index en double'
  union all
  select 'aucun trigger de remplacement sur dated_notes (le client upserte par le couple)',
         not exists (select 1 from pg_trigger where tgrelid = 'public.dated_notes'::regclass
                   and tgname = 'replace_dated_note' and not tgisinternal),
         'suppression en base à l''insertion, décidée hors du client'
  union all
  select 'aucun doublon en base',
         not exists (select 1 from dated_notes group by execution_id, exercise_id having count(*) > 1),
         'note cachée derrière la plus récente'
) t order by 1 desc, 2;
