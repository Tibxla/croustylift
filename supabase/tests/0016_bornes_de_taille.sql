-- Contrôle de la migration 0016 (lecture seule).
select case when ok then 'OK' else 'ECHEC' end as verdict, quoi, empeche from (
  select 'contrainte ' || c.nom as quoi,
         exists (select 1 from pg_constraint where connamespace = 'public'::regnamespace
                   and conname = c.nom and contype = 'c' and convalidated) as ok,
         c.empeche
  from (values
    ('exercises_name_taille_check', 'nom d''exo de plus de 200 caractères'),
    ('exercises_muscle_group_taille_check', 'groupe musculaire de plus de 80 caractères'),
    ('exercises_primary_muscles_taille_check', 'plus de 30 muscles ou plus de 1500 caractères'),
    ('exercise_overrides_name_taille_check', 'nom surchargé de plus de 200 caractères'),
    ('exercise_overrides_primary_muscles_taille_check', 'plus de 30 muscles surchargés ou plus de 1500 caractères'),
    ('exercise_notes_body_taille_check', 'note d''instructions de plus de 5000 caractères'),
    ('dated_notes_body_taille_check', 'note datée de plus de 5000 caractères'),
    ('routines_name_taille_check', 'nom de routine de plus de 200 caractères'),
    ('seances_name_taille_check', 'nom de séance de plus de 200 caractères')
  ) as c(nom, empeche)
  union all
  select 'aucune ligne hors borne',
         not exists (select 1 from exercises where char_length(name) > 200 or char_length(muscle_group) > 80
                       or cardinality(primary_muscles) > 30 or char_length(array_to_string(primary_muscles, '')) > 1500)
         and not exists (select 1 from exercise_overrides where char_length(name) > 200
                       or cardinality(primary_muscles) > 30 or char_length(array_to_string(primary_muscles, '')) > 1500)
         and not exists (select 1 from exercise_notes where char_length(body) > 5000)
         and not exists (select 1 from dated_notes where char_length(body) > 5000)
         and not exists (select 1 from routines where char_length(name) > 200)
         and not exists (select 1 from seances where char_length(name) > 200),
         'saturation de la base par des textes géants'
) t order by 1 desc, 2;
