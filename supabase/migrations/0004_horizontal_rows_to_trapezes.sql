-- Les tirages horizontaux sollicitent surtout le milieu du dos (trapèzes/rhomboïdes).
-- En modèle « un seul muscle principal », on les classe en trapèzes plutôt que dorsaux.
-- Les tirages verticaux et tractions restent dorsaux (lats).
update public.exercises set muscle_group = 'trapèzes'
  where owner_id is null and name in ('Tirage horizontal', 'Rowing barre');
