-- 0018 : une seule note datée par exercice et par exécution (audit du 2026-11-22, X15).
--
-- GLOSSARY.md « Note datée » : une note par (exécution, exercice). Le client
-- n'en crée qu'une, mais rien ne l'imposait : deux appareils, ou une Capture
-- remontée hors ligne sans son état local, écrivaient une seconde ligne sous un
-- autre id. La lecture gardait la plus récente et l'autre restait en base.
--
-- 1. Index unique `(execution_id, exercise_id, owner_id)`. Il remplace l'index
--    simple sur `execution_id` (migration 0008), dont il est un préfixe.
--    `owner_id` ne change rien à la règle (une exécution n'a qu'un compte,
--    migration 0019) : il empêche qu'un autre compte, en tentant d'écrire dans
--    cette exécution, apprenne par l'erreur d'unicité qu'une note y existe.
--
-- 2. Pas de trigger de remplacement, et pas d'upsert par le couple : c'est
--    l'ID de la note qui devient DÉTERMINISTE côté client (arbitrage du
--    2026-11-23). L'id d'une note datée est l'UUID v5 de son couple
--    (`execution_id:exercise_id`, espace de noms fixe) : deux appareils qui
--    notent le même exo de la même exécution écrivent le même id, et l'upsert
--    par `id` converge sans jamais heurter cet index. Les suppressions en
--    attente, qui visent l'id, restent justes.
--
-- ORDRE, impératif (voir supabase/tests/ORDRE.md) : cette migration s'applique
-- APRÈS le déploiement du client à id déterministe ET après le passage des
-- anciens clients (PWA restées ouvertes ou hors ligne, dont l'outbox porte
-- encore des notes à id aléatoire). Avant, un ancien client qui écrit une
-- seconde note du même couple sous un autre id recevrait 23505, et sa saisie
-- partirait en quarantaine (ADR 0018). Son numéro ne dit pas son rang.
--
-- Les notes déjà en base gardent leur id aléatoire. Le client les reprend par
-- leur id (réhydratation) ; une note réécrite sans avoir été relue arrive sous
-- l'id déterministe et serait refusée (23505) : cas limité aux exécutions
-- antérieures au nouveau client, que la Capture ne rouvre pas.
--
-- Rejouable. Aucune donnée modifiée : des doublons existants font échouer la
-- migration entière, ils ne sont jamais supprimés d'office.
--
-- CONTRÔLE PRÉALABLE (lecture seule). Attendu : aucune ligne.
--
--   select d.execution_id, d.exercise_id, d.id, d.owner_id, d.created_at, d.updated_at, d.body
--   from dated_notes d
--   join (
--     select execution_id, exercise_id from dated_notes
--     group by 1, 2 having count(*) > 1
--   ) dup using (execution_id, exercise_id)
--   order by d.execution_id, d.exercise_id, d.created_at desc;
--
-- SI DES LIGNES SORTENT : pour chaque couple, la première ligne (la plus récente
-- par `created_at`) est celle que l'app affiche déjà (`loadDatedNote`). Relire
-- les textes des autres avec le propriétaire du compte ; si l'un doit être
-- gardé, le recopier dans la première (`update dated_notes set body = '...'
-- where id = '...'`). Puis retirer les autres, et seulement alors appliquer :
--
--   delete from dated_notes d using (
--     select id, row_number() over (
--       partition by execution_id, exercise_id order by created_at desc, id desc
--     ) as rang from dated_notes
--   ) r where r.id = d.id and r.rang > 1;
--
-- RISQUE : faible sans doublon et dans l'ordre ci-dessus.

begin;

-- Attente bornée : un verrou pris ailleurs fait échouer la migration (à
-- relancer) au lieu de geler l'app derrière elle.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Garde : des doublons existants arrêtent la migration avec un message lisible.
do $$
declare
  v_couples int;
begin
  select count(*) into v_couples from (
    select 1 from public.dated_notes group by execution_id, exercise_id having count(*) > 1
  ) dup;
  if v_couples > 0 then
    raise exception
      '0018 : % couple(s) (exécution, exercice) portent plusieurs notes datées. Voir le contrôle préalable en tête de fichier.',
      v_couples;
  end if;
end;
$$;

create unique index if not exists dated_notes_execution_exercise_unique
  on public.dated_notes (execution_id, exercise_id, owner_id);

drop index if exists public.dated_notes_execution_id_idx;

commit;
