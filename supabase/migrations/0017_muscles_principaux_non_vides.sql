-- 0017 : un exercice a au moins un muscle principal (audit du 2026-11-22, X13).
--
-- GLOSSARY.md « Muscles principaux » : au moins un. Le client le garantit à la
-- saisie (`validatePersonalExercise`) ; la base l'ignorait, et un appel direct à
-- l'API pouvait créer un exo sans muscle, compté dans aucun décompte de séries.
--
-- Le VOCABULAIRE reste libre en base, par choix : la liste canonique vit dans le
-- client (`isMuscleGroup`, src/features/authoring/exercise-input.ts), et la figer ici obligerait à migrer la base
-- avant tout ajout de muscle, au risque de refuser une saisie légitime (règle de
-- la migration 0012). La borne de taille de la migration 0016 suffit à contenir
-- l'abus.
--
-- `exercise_overrides.primary_muscles` n'est pas contraint : null ou vide y
-- veulent dire « pas d'override sur ce champ » (`hasMuscles`, ADR 0007).
--
-- Rejouable. Sans perte : les lignes vides sont d'abord remplies depuis
-- `muscle_group`, comme la migration 0005 l'avait fait une première fois.
--
-- CONTRÔLE PRÉALABLE (lecture seule). Attendu : aucune ligne.
--
--   select id, owner_id, name, muscle_group, primary_muscles
--   from exercises where cardinality(primary_muscles) = 0;
--
-- SI DES LIGNES SORTENT : celles dont `muscle_group` est renseigné sont reprises
-- par le remplissage ci-dessous (muscle unique = l'ancien groupe). Celles dont
-- `muscle_group` est vide font échouer la migration entière : leur donner un
-- muscle à la main (`update exercises set muscle_group = '...',
-- primary_muscles = array['...'] where id = '...'`), puis appliquer.
--
-- RISQUE : faible. Le client n'écrit jamais de liste vide.

begin;

-- Attente bornée : un verrou pris ailleurs fait échouer la migration (à
-- relancer) au lieu de geler l'app derrière elle.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

update public.exercises
  set primary_muscles = array[muscle_group]
  where cardinality(primary_muscles) = 0
    and btrim(muscle_group) <> '';

alter table public.exercises drop constraint if exists exercises_primary_muscles_non_vide_check;
alter table public.exercises add constraint exercises_primary_muscles_non_vide_check
  check (cardinality(primary_muscles) >= 1);

commit;
