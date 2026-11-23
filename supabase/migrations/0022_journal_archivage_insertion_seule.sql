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
-- ORDRE, impératif (voir supabase/tests/ORDRE.md) : cette migration s'applique
-- APRÈS la 0024, APRÈS le déploiement du client qui importe par
-- `import_user_data`, et APRÈS le passage des anciens clients (PWA restées
-- ouvertes ou hors ligne). Son numéro ne dit pas son rang.
-- L'ancien import upserte les tables l'une après l'autre, journal compris. Sous
-- cette policy, il échoue sur le journal (42501) dès qu'un événement du fichier
-- existe déjà en base, APRÈS avoir écrit les six tables précédentes : un compte
-- à moitié restauré. Le nouvel import n'insère ce journal que sans réécriture
-- (`on conflict do nothing`) et tient en une transaction.
--
-- Rejouable. Aucune donnée touchée, rien à contrôler dans les lignes.
--
-- CONTRÔLE PRÉALABLE (lecture seule). Attendu : une seule policy,
-- `seance_archive_events_all`, commande ALL, rôle `{authenticated}`.
--
--   select policyname, cmd, roles, qual, with_check
--   from pg_policies where schemaname = 'public' and tablename = 'seance_archive_events';
--
-- RISQUE : faible, à condition de respecter l'ordre ci-dessus.

begin;

-- Attente bornée : un verrou pris ailleurs fait échouer la migration (à
-- relancer) au lieu de geler l'app derrière elle.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

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
