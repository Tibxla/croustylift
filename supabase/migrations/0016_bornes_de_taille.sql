-- 0016 : bornes de taille sur les textes saisis (audit du 2026-11-22, X10).
--
-- Seconde protection derrière la fermeture de l'inscription : sans borne, un
-- compte pouvait écrire par l'API des lignes de plusieurs mégaoctets et saturer
-- les 500 Mo du free tier (base en lecture seule pour tout le monde).
--
-- RÈGLE (migration 0012, incident du 2026-07-30) : la base accepte tout ce que
-- le client produit légitimement. Les bornes sont donc très au-dessus de ce que
-- l'interface laisse saisir :
--
--   colonne                              client              base
--   name (exercises, overrides,          80 (maxLength),     200
--         routines, seances)             + « 2 » à la copie
--   body (exercise_notes, dated_notes)   500 (NoteField)     5000
--   muscle_group                         vocabulaire de 15   80
--   primary_muscles                      15 muscles au plus  30 éléments,
--                                                            1500 caractères
--
-- Le premier lancement (`FirstLaunchScreen`) est le seul écran dont les champs
-- de nom n'ont pas de `maxLength` : un nom de plus de 200 caractères y serait
-- refusé par la base (23514). Aucun nom réel n'approche cette longueur.
--
-- `char_length` compte des caractères, `maxLength` des unités UTF-16 : un texte
-- accepté par le navigateur ne dépasse jamais sa borne en caractères.
--
-- Rejouable : chaque contrainte est retirée si elle existe, puis reposée. Aucune
-- donnée modifiée. Une ligne existante hors borne fait échouer la migration
-- entière (rien n'est appliqué).
--
-- CONTRÔLE PRÉALABLE (lecture seule). Attendu : chaque maximum sous sa borne.
--
--   select 'exercises.name' as colonne, max(char_length(name)) as maximum, 200 as borne from exercises
--   union all select 'exercises.muscle_group', max(char_length(muscle_group)), 80 from exercises
--   union all select 'exercises.primary_muscles (éléments)', max(cardinality(primary_muscles)), 30 from exercises
--   union all select 'exercises.primary_muscles (caractères)', max(char_length(array_to_string(primary_muscles, ''))), 1500 from exercises
--   union all select 'exercise_overrides.name', max(char_length(name)), 200 from exercise_overrides
--   union all select 'exercise_overrides.primary_muscles (éléments)', max(cardinality(primary_muscles)), 30 from exercise_overrides
--   union all select 'exercise_overrides.primary_muscles (caractères)', max(char_length(array_to_string(primary_muscles, ''))), 1500 from exercise_overrides
--   union all select 'exercise_notes.body', max(char_length(body)), 5000 from exercise_notes
--   union all select 'dated_notes.body', max(char_length(body)), 5000 from dated_notes
--   union all select 'routines.name', max(char_length(name)), 200 from routines
--   union all select 'seances.name', max(char_length(name)), 200 from seances;
--
-- SI UN MAXIMUM DÉPASSE : ne rien tronquer. Lire la ligne (même requête sans
-- `max`, triée par longueur). Saisie légitime : relever la borne dans ce fichier
-- au-dessus du maximum mesuré, puis appliquer. Abus : le traiter à la main avec
-- le propriétaire du compte, puis appliquer.
--
-- RISQUE : faible si le contrôle est sous les bornes. Une op de l'outbox hors
-- borne partirait en quarantaine (classe 23, ADR 0018) sans bloquer la file.

begin;

alter table public.exercises drop constraint if exists exercises_name_taille_check;
alter table public.exercises add constraint exercises_name_taille_check
  check (char_length(name) <= 200);

alter table public.exercises drop constraint if exists exercises_muscle_group_taille_check;
alter table public.exercises add constraint exercises_muscle_group_taille_check
  check (char_length(muscle_group) <= 80);

alter table public.exercises drop constraint if exists exercises_primary_muscles_taille_check;
alter table public.exercises add constraint exercises_primary_muscles_taille_check
  check (
    cardinality(primary_muscles) <= 30
    and char_length(array_to_string(primary_muscles, '')) <= 1500
  );

alter table public.exercise_overrides drop constraint if exists exercise_overrides_name_taille_check;
alter table public.exercise_overrides add constraint exercise_overrides_name_taille_check
  check (name is null or char_length(name) <= 200);

alter table public.exercise_overrides drop constraint if exists exercise_overrides_primary_muscles_taille_check;
alter table public.exercise_overrides add constraint exercise_overrides_primary_muscles_taille_check
  check (
    primary_muscles is null
    or (
      cardinality(primary_muscles) <= 30
      and char_length(array_to_string(primary_muscles, '')) <= 1500
    )
  );

alter table public.exercise_notes drop constraint if exists exercise_notes_body_taille_check;
alter table public.exercise_notes add constraint exercise_notes_body_taille_check
  check (char_length(body) <= 5000);

alter table public.dated_notes drop constraint if exists dated_notes_body_taille_check;
alter table public.dated_notes add constraint dated_notes_body_taille_check
  check (char_length(body) <= 5000);

alter table public.routines drop constraint if exists routines_name_taille_check;
alter table public.routines add constraint routines_name_taille_check
  check (char_length(name) <= 200);

alter table public.seances drop constraint if exists seances_name_taille_check;
alter table public.seances add constraint seances_name_taille_check
  check (char_length(name) <= 200);

commit;
