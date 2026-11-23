-- Contrôle de la migration 0019 (lecture seule), à lancer après 0019c.
select case when ok then 'OK' else 'ECHEC' end as verdict, quoi, empeche from (
  select format('clé composite %s', k.nom) as quoi,
         exists (
           select 1 from pg_constraint c
           where c.conname = k.nom and c.contype = 'f' and c.convalidated
             and c.conrelid = format('public.%I', k.enfant)::regclass
             and c.confrelid = format('public.%I', k.parent)::regclass
             and c.confdeltype = k.action
             and pg_get_constraintdef(c.oid) like format('FOREIGN KEY (%s, owner_id) REFERENCES %s(id, owner_id)%%', k.colonne, k.parent)
         ) as ok,
         format('%s rattaché à un parent (%s) d''un autre compte', k.enfant, k.parent) as empeche
  from (values
    ('seances_routine_id_fkey', 'seances', 'routine_id', 'routines', 'c'),
    ('routine_activations_routine_id_fkey', 'routine_activations', 'routine_id', 'routines', 'c'),
    ('seance_versions_seance_id_fkey', 'seance_versions', 'seance_id', 'seances', 'c'),
    ('seance_archive_events_seance_id_fkey', 'seance_archive_events', 'seance_id', 'seances', 'c'),
    ('prescriptions_seance_version_id_fkey', 'prescriptions', 'seance_version_id', 'seance_versions', 'c'),
    ('executions_seance_version_id_fkey', 'executions', 'seance_version_id', 'seance_versions', 'a'),
    ('performed_sets_execution_id_fkey', 'performed_sets', 'execution_id', 'executions', 'c'),
    ('dated_notes_execution_id_fkey', 'dated_notes', 'execution_id', 'executions', 'c')
  ) as k(nom, enfant, colonne, parent, action)
  union all
  select 'les six index de 0019a sont uniques et valides',
         (select count(*) from pg_index i join pg_class c on c.oid = i.indexrelid
           join pg_namespace ns on ns.oid = c.relnamespace
           where ns.nspname = 'public' and i.indisvalid and i.indisunique and c.relname in (
             'routines_id_owner_id_key', 'seances_id_owner_id_key', 'seance_versions_id_owner_id_key',
             'executions_id_owner_id_key', 'seances_owner_routine_name_unique',
             'seance_versions_owner_seance_version_key')) = 6,
         'clé composite sans cible, ou index resté invalide après une construction interrompue'
  union all
  select 'index des noms de séance : owner_id en tête',
         exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'seances_owner_routine_name_unique'
                   and indexdef like 'CREATE UNIQUE INDEX%(owner_id, routine_id, lower(%')
         and not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'seances_routine_name_unique'),
         'lecture des noms de séance d''un autre compte par l''erreur d''unicité'
  union all
  select 'unicité des versions : owner_id en tête',
         exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'seance_versions_owner_seance_version_key'
                   and indexdef like 'CREATE UNIQUE INDEX%(owner_id, seance_id, version)')
         and not exists (select 1 from pg_constraint where conrelid = 'public.seance_versions'::regclass
                   and conname = 'seance_versions_seance_id_version_key'),
         'lecture des numéros de version d''un autre compte par l''erreur d''unicité'
  union all
  select 'une seule clé étrangère entre deux tables',
         not exists (select 1 from pg_constraint where contype = 'f' and connamespace = 'public'::regnamespace
                       and confrelid <> 'auth.users'::regclass
                     group by conrelid, confrelid having count(*) > 1),
         'jointure PostgREST ambiguë côté client'
  union all
  select format('trigger check_exercise_link sur %s', t.nom),
         exists (select 1 from pg_trigger where tgrelid = format('public.%I', t.nom)::regclass
                   and tgname = 'check_exercise_link' and tgenabled = 'O' and not tgisinternal),
         format('%s pointant l''exo perso d''un autre compte (23503)', t.nom)
  from (values ('prescriptions'), ('performed_sets'), ('dated_notes'), ('exercise_notes')) as t(nom)
  union all
  select 'aucun lien croisé entre comptes',
         not exists (select 1 from seances s join routines r on r.id = s.routine_id where s.owner_id <> r.owner_id)
         and not exists (select 1 from seance_versions v join seances s on s.id = v.seance_id where v.owner_id <> s.owner_id)
         and not exists (select 1 from prescriptions p join seance_versions v on v.id = p.seance_version_id where p.owner_id <> v.owner_id)
         and not exists (select 1 from executions e join seance_versions v on v.id = e.seance_version_id where e.owner_id <> v.owner_id)
         and not exists (select 1 from performed_sets ps join executions e on e.id = ps.execution_id where ps.owner_id <> e.owner_id)
         and not exists (select 1 from dated_notes d join executions e on e.id = d.execution_id where d.owner_id <> e.owner_id)
         and not exists (select 1 from routine_activations a join routines r on r.id = a.routine_id where a.owner_id <> r.owner_id)
         and not exists (select 1 from seance_archive_events ev join seances s on s.id = ev.seance_id where ev.owner_id <> s.owner_id)
         and not exists (select 1 from prescriptions p join exercises x on x.id = p.exercise_id where x.owner_id <> p.owner_id)
         and not exists (select 1 from performed_sets ps join exercises x on x.id = ps.exercise_id where x.owner_id <> ps.owner_id)
         and not exists (select 1 from dated_notes d join exercises x on x.id = d.exercise_id where x.owner_id <> d.owner_id)
         and not exists (select 1 from exercise_notes n join exercises x on x.id = n.exercise_id where x.owner_id <> n.user_id),
         'suppression de séance, de routine ou de compte bloquée par les lignes d''un autre'
) t order by 1 desc, 2;
