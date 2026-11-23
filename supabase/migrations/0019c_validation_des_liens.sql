-- 0019c : validation des clés composites du même compte (audit du 2026-11-22, X8).
--
-- Dernier temps de la migration 0019. 0019b a posé les huit clés composites en
-- NOT VALID : elles vérifient déjà toute nouvelle écriture. Ce fichier fait
-- parcourir les lignes EXISTANTES à la base, qui marque alors chaque clé
-- valide.
--
-- `VALIDATE CONSTRAINT` ne bloque ni les lectures ni les écritures (verrou
-- SHARE UPDATE EXCLUSIVE sur la fille, ROW SHARE sur le parent).
--
-- Lançable et RELANÇABLE seule, autant de fois qu'il faut : valider une clé
-- déjà valide ne fait rien. Aucune donnée modifiée.
--
-- CONTRÔLE PRÉALABLE : celui de 0019b (liens croisés, attendu 0 partout).
--
-- SI ELLE ÉCHOUE (23503) : une ligne existante pointe un parent d'un autre
-- compte. Les clés restent posées en NOT VALID et protègent les nouvelles
-- écritures ; rien n'est à défaire. Traiter les lignes signalées (voir « SI UN
-- COMPTE N'EST PAS À 0 » en tête de 0019b), puis relancer ce fichier seul.
--
-- RISQUE : faible.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.seances validate constraint seances_routine_id_fkey;
alter table public.routine_activations validate constraint routine_activations_routine_id_fkey;
alter table public.seance_versions validate constraint seance_versions_seance_id_fkey;
alter table public.seance_archive_events validate constraint seance_archive_events_seance_id_fkey;
alter table public.prescriptions validate constraint prescriptions_seance_version_id_fkey;
alter table public.executions validate constraint executions_seance_version_id_fkey;
alter table public.performed_sets validate constraint performed_sets_execution_id_fkey;
alter table public.dated_notes validate constraint dated_notes_execution_id_fkey;

commit;
