-- 0012 — duration_min accepte 0 (incident du 2026-07-30 : outbox bloquée).
--
-- PROBLÈME : la clôture d'une séance envoie `duration_min = round(elapsed / 60s)`.
-- Une séance clôturée moins de 30 s après son lancement (faux départ) donne 0,
-- que la contrainte `executions_duration_min_check` (`> 0`) rejetait en 400.
-- L'outbox s'arrêtant à la première op en échec (arrêt-sur-échec, cf. outbox.ts),
-- cette op de clôture EMPOISONNAIT la file : toutes les écritures suivantes
-- (la vraie séance du jour) restaient « en attente » pour toujours.
--
-- RÈGLE local-first : la base accepte tout ce que le client produit légitimement.
-- Un 0 minute est une mesure honnête (séance < 30 s), pas du bruit — c'est à
-- l'analyse de l'interpréter, pas à une contrainte de bloquer la synchro.
-- Les négatifs restent rejetés (aucun chemin client n'en produit, et le client
-- clampe désormais à 0 par ceinture-bretelles).

alter table public.executions
  drop constraint executions_duration_min_check;

alter table public.executions
  add constraint executions_duration_min_check
  check (duration_min is null or duration_min >= 0);
