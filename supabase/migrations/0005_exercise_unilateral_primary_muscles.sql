-- Modèle d'exercice étendu (issue #33) : un exo porte désormais
--   - `unilateral` : booléen (mouvement exécuté un côté à la fois) ;
--   - `primary_muscles` : LISTE de muscles principaux (>= 1), vocabulaire canonique
--     CONTEXT.md. PAS de muscle secondaire.
--
-- ADDITIF et NON destructif :
--   - on AJOUTE les deux colonnes (defaults sûrs) ;
--   - on BACKFILL primary_muscles à partir du muscle_group unique existant, pour
--     les exos de base ET perso déjà en table ;
--   - on GARDE muscle_group : d'autres modules (analyse, picker, affichage) le
--     lisent encore. Pour un exo créé via l'UI, muscle_group = primary_muscles[0]
--     (compat legacy assurée côté client, cf. exercise-input.ts).

-- =====================================================================
-- 1. Nouvelles colonnes (defaults => pas de réécriture des lignes existantes)
-- =====================================================================
alter table public.exercises
  add column if not exists unilateral boolean not null default false;

alter table public.exercises
  add column if not exists primary_muscles text[] not null default '{}';

-- =====================================================================
-- 2. Backfill : muscle unique -> liste à un élément, pour tout exo non encore migré
-- =====================================================================
update public.exercises
  set primary_muscles = array[muscle_group]
  where primary_muscles = '{}'
    and muscle_group is not null
    and muscle_group <> '';
