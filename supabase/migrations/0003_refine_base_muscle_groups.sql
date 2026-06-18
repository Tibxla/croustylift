-- Affine le vocabulaire des groupes musculaires du catalogue de base vers la
-- granularité voulue (15 muscles canoniques). Additif et non destructif :
-- UPDATE en place (ids/names stables) + INSERT des exos couvrant les nouveaux muscles.

-- Renommage : 'dos' -> 'dorsaux'
update public.exercises set muscle_group = 'dorsaux'
  where owner_id is null and muscle_group = 'dos';

-- Éclatement des épaules
update public.exercises set muscle_group = 'avant épaule'
  where owner_id is null and name = 'Développé militaire';
update public.exercises set muscle_group = 'milieu épaule'
  where owner_id is null and name = 'Élévations latérales';

-- Nouveaux exos de base couvrant les muscles non encore représentés
insert into public.exercises (owner_id, name, muscle_group) values
  (null, 'Oiseau haltères',        'arrière épaule'),
  (null, 'Haussements d''épaules', 'trapèzes'),
  (null, 'Curl marteau',           'brachioradial'),
  (null, 'Machine adducteurs',     'adducteurs');
