-- 0022 : le journal des archivages ne se réécrit plus (audit du 2026-11-22, X14).
--
-- `seance_archive_events` est rejoué par la timeline des blocs (ADR 0017) : le
-- modifier ou en retirer une ligne redécoupe les blocs passés. Sa policy
-- `for all` laissait pourtant son propriétaire le modifier et le vider.
--
-- La policy unique devient deux policies : LECTURE et INSERTION. Sans policy de
-- modification ni de suppression, la RLS refuse les deux (zéro ligne touchée).
-- L'insertion reste ouverte pour deux écrivains :
--   - le trigger `log_seance_archive`, qui écrit sous le compte de l'appelant ;
--   - l'import d'une sauvegarde, qui restaure le journal avec ses dates
--     d'origine. La restauration étant par nature une écriture du propriétaire,
--     « le trigger seule source » ne peut pas être tenu sans y renoncer.
-- Le journal continue de partir avec sa séance ou son compte : les cascades de
-- clé étrangère ne passent pas par la RLS.
--
-- DÉPENDANCE : l'import du client doit insérer ce journal sans le réécrire
-- (`on conflict do nothing`), ce que fait la fonction `import_user_data` de la
-- migration 0024. L'ancien import (upsert table par table) échoue sur ce journal
-- dès qu'une ligne du fichier existe déjà en base : appliquer 0022 et 0024
-- ensemble, juste avant de déployer le client qui appelle la fonction.
--
-- Rejouable. Aucune donnée touchée, rien à contrôler dans les lignes.
--
-- CONTRÔLE PRÉALABLE (lecture seule). Attendu : une seule policy,
-- `seance_archive_events_all`, commande ALL, rôle `{authenticated}`.
--
--   select policyname, cmd, roles, qual, with_check
--   from pg_policies where schemaname = 'public' and tablename = 'seance_archive_events';
--
-- RISQUE : faible, à condition de respecter la dépendance ci-dessus.

begin;

drop policy if exists seance_archive_events_all on public.seance_archive_events;

drop policy if exists seance_archive_events_select on public.seance_archive_events;
create policy seance_archive_events_select on public.seance_archive_events
  for select to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists seance_archive_events_insert on public.seance_archive_events;
create policy seance_archive_events_insert on public.seance_archive_events
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

commit;
