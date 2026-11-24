-- Contrôle de la migration 0017 (lecture seule).
select case when ok then 'OK' else 'ECHEC' end as verdict, quoi, empeche from (
  select 'contrainte exercises_primary_muscles_non_vide_check' as quoi,
         exists (select 1 from pg_constraint where conrelid = 'public.exercises'::regclass
                   and conname = 'exercises_primary_muscles_non_vide_check' and convalidated) as ok,
         'exo créé ou modifié sans muscle principal' as empeche
  union all
  select 'aucun exo sans muscle principal',
         not exists (select 1 from exercises where cardinality(primary_muscles) = 0),
         'exo absent de tout décompte de séries'
) t order by 1 desc, 2;
