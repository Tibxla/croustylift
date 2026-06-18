-- Catalogue d'exercices de base : lignes globales (owner_id null), lecture seule
-- pour les utilisateurs, modifiables seulement via service_role (cette migration).
-- Un seul groupe musculaire principal par exo (cf. CONTEXT.md).

insert into public.exercises (owner_id, name, muscle_group) values
  (null, 'Développé couché',            'pectoraux'),
  (null, 'Développé incliné haltères',  'pectoraux'),
  (null, 'Écarté à la poulie',          'pectoraux'),
  (null, 'Tirage horizontal',           'dos'),
  (null, 'Tirage vertical',             'dos'),
  (null, 'Tractions',                   'dos'),
  (null, 'Rowing barre',                'dos'),
  (null, 'Développé militaire',         'épaules'),
  (null, 'Élévations latérales',        'épaules'),
  (null, 'Curl biceps haltères',        'biceps'),
  (null, 'Curl barre',                  'biceps'),
  (null, 'Extension triceps à la poulie','triceps'),
  (null, 'Dips',                        'triceps'),
  (null, 'Squat',                       'quadriceps'),
  (null, 'Presse à cuisses',            'quadriceps'),
  (null, 'Soulevé de terre roumain',    'ischio-jambiers'),
  (null, 'Leg curl',                    'ischio-jambiers'),
  (null, 'Hip thrust',                  'fessiers'),
  (null, 'Mollets debout',              'mollets'),
  (null, 'Crunch',                      'abdominaux');
