-- 0019a : index uniques préparés pour les liens du même compte (audit du 2026-11-22, X8).
--
-- Premier temps de la migration 0019 (voir 0019b pour le sens d'ensemble) : les
-- index dont les clés composites et les unicités par compte ont besoin sont
-- construits ICI, avec `CONCURRENTLY`, pour que 0019b n'ait plus qu'à basculer
-- les contraintes dans une transaction courte. Construits dans 0019b, ils
-- tiendraient un verrou exclusif sur chaque table parente pendant toute la
-- construction, lectures comprises.
--
-- CE FICHIER N'A PAS DE TRANSACTION, et ne doit pas en recevoir : `create index
-- concurrently` est refusé dans un bloc de transaction. Si l'outil qui l'applique
-- envoie le fichier comme une seule requête (transaction implicite), lancer les
-- six instructions une par une.
--
-- Rejouable : `if not exists`. Aucune ligne modifiée, aucune écriture bloquée.
-- Tant que 0019b n'est pas appliquée, ces index ne changent aucune règle (deux
-- d'entre eux doublent une unicité existante, plus large).
--
-- CONTRÔLE PRÉALABLE (lecture seule). Attendu : aucune ligne (pas de nom de
-- séance en double dans une routine ; l'index de la migration 0013 le garantit
-- déjà, sauf dérive).
--
--   select routine_id, lower(btrim(regexp_replace(name, '\s+', ' ', 'g'))), count(*)
--   from seances group by 1, 2 having count(*) > 1;
--
-- APRÈS COUP (lecture seule). Attendu : six lignes, toutes `indisvalid = true`.
-- Une construction interrompue laisse un index INVALIDE que `if not exists`
-- ne refait pas : le supprimer (`drop index concurrently public.<nom>`), puis
-- relancer ce fichier. 0019b refuse de toute façon de s'appliquer sans les six.
--
--   select c.relname, i.indisvalid, i.indisunique
--   from pg_index i join pg_class c on c.oid = i.indexrelid
--   where c.relname in (
--     'routines_id_owner_id_key', 'seances_id_owner_id_key',
--     'seance_versions_id_owner_id_key', 'executions_id_owner_id_key',
--     'seances_owner_routine_name_unique', 'seance_versions_owner_seance_version_key');
--
-- RISQUE : faible. Pas de verrou bloquant ; la construction attend seulement
-- la fin des transactions en cours.

set lock_timeout = '5s';

-- Cibles `(id, owner_id)` des clés composites.
create unique index concurrently if not exists routines_id_owner_id_key
  on public.routines (id, owner_id);
create unique index concurrently if not exists seances_id_owner_id_key
  on public.seances (id, owner_id);
create unique index concurrently if not exists seance_versions_id_owner_id_key
  on public.seance_versions (id, owner_id);
create unique index concurrently if not exists executions_id_owner_id_key
  on public.executions (id, owner_id);

-- Unicités par compte : `owner_id` en tête (voir 0019b, point 2).
create unique index concurrently if not exists seances_owner_routine_name_unique
  on public.seances (owner_id, routine_id, lower(btrim(regexp_replace(name, '\s+', ' ', 'g'))));
create unique index concurrently if not exists seance_versions_owner_seance_version_key
  on public.seance_versions (owner_id, seance_id, version);

reset lock_timeout;
