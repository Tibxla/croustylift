-- Contrôle de la migration 0015 (lecture seule).
select case when ok then 'OK' else 'ECHEC' end as verdict, quoi, empeche from (
  select 'index ' || i.nom as quoi,
         exists (select 1 from pg_indexes where schemaname = 'public' and indexname = i.nom) as ok,
         'parcours complet de la table sur ce filtre ou cette clé étrangère' as empeche
  from (values ('executions_seance_version_id_idx'), ('performed_sets_owner_id_idx'),
               ('prescriptions_exercise_id_idx'), ('dated_notes_exercise_id_idx'),
               ('routine_activations_routine_id_idx')) as i(nom)
  union all
  select 'aucune policy ne lit auth.uid() nu',
         not exists (
           select 1 from pg_policies where schemaname = 'public'
             -- Espaces retirés : l'écriture de la sous-requête varie selon la version de Postgres.
             and (replace(replace(coalesce(qual, ''), ' ', ''), '(SELECTauth.uid()ASuid)', '') like '%auth.uid()%'
               or replace(replace(coalesce(with_check, ''), ' ', ''), '(SELECTauth.uid()ASuid)', '') like '%auth.uid()%')
         ),
         'réévaluation de auth.uid() à chaque ligne lue'
  union all
  select 'toutes les policies visent le seul rôle authenticated',
         not exists (select 1 from pg_policies where schemaname = 'public' and roles <> '{authenticated}'),
         'accès anonyme'
  union all
  select 'RLS active sur les 12 tables',
         (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity) = 12
         and not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
         'table lisible sans policy'
) t order by 1 desc, 2;
