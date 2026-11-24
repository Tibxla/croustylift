# Ordre de déploiement des migrations 0015 à 0027

Les numéros ne donnent pas l'ordre. Quatre migrations (0016, 0018, 0021, 0022) refuseraient des écritures que le client encore déployé produit : elles attendent le nouveau client, puis le passage des anciens. Le banc local (`banc/lancer.sh`) rejoue exactement cet ordre.

Avant chaque migration : sa requête de contrôle préalable, en commentaire en tête du fichier. Après : son test de contrôle `supabase/tests/00NN_*.sql` (lecture seule, aucune ligne `ECHEC`). Chaque migration borne son attente de verrou à 5 s : sur un échec `lock timeout`, rien n'est appliqué, il suffit de la relancer.

## Étape 1 : migrations compatibles avec le client en place

À appliquer dans cet ordre, client inchangé.

1. `0015_index_et_rls_initplan.sql`
2. `0017_muscles_principaux_non_vides.sql`
3. `0019a_index_des_liens.sql` : SANS transaction (`create index concurrently`). Si l'outil envoie le fichier comme une seule requête, lancer ses instructions une par une. Vérifier ensuite que les six index sont valides (requête « APRÈS COUP » du fichier).
4. `0019b_liens_meme_compte.sql` : hors des heures de salle. Elle prend tous ses verrous d'emblée, sans attendre : sur une erreur `55P03` (table occupée), rien n'est appliqué ni bloqué, la relancer.
5. `0019c_validation_des_liens.sql` : valide les huit clés posées par 0019b. Lançable et relançable seule ; si elle échoue (23503), les clés de 0019b restent en place et protègent déjà les nouvelles écritures, traiter les lignes signalées puis relancer ce seul fichier. Test de contrôle ensuite : `supabase/tests/0019_liens_meme_compte.sql`. Puis ouvrir l'app, lire le plan, saisir une série.
6. `0020_override_exo_de_base.sql`
7. `0023_reorder_seances.sql`
8. `0024_import_transactionnel.sql`
9. `0025_delete_execution_if_empty.sql` : la suppression conditionnelle d'une exécution ouverte et vide (« Changer de séance » dans la Salle). À appliquer AVANT le déploiement du client qui l'appelle (`deleteExecutionIfEmpty`, `src/features/capture/data.ts`) : sans elle, ce client ne supprime rien et une exécution vide reste ouverte (la prochaine ouverture l'adopte). Un repli non atomique a été retiré le 24/11 : il pouvait emporter une série acquittée par un autre appareil.

10. `0026_reorder_seances_revision.sql` : le réordonnancement sous révision (voir sa section plus bas). À appliquer AVANT le client qui l'appelle.
11. `0027_creer_seance.sql` : la création d'une séance et de sa version 1 en une transaction (voir sa section plus bas). Après 0026, AVANT le client qui l'appelle.

Effet visible sur le client en place : aucun.

`0021_routine_courante_non_archivable.sql` n'est PAS de cette étape, malgré son numéro : voir l'étape 4. `import_user_data` (0024) marche avant comme après elle.

## Étape 2 : déploiement du client

Le client déployé doit porter, ensemble :

- l'import par `import_user_data` (lot 3C, `src/features/export/`) ;
- le réordonnancement par `reorder_seances` (`src/features/authoring/data.ts`) ;
- l'id déterministe des notes datées : UUID v5 du couple `execution_id:exercise_id`, espace de noms `6f1d7c52-9a3e-4b8f-8d21-5c0e7a94b3d6` ;
- le premier lancement qui valide ses deux noms (80 caractères au plus) avant toute écriture.

Ce client ne dépend pas de 0021 : `archiveRoutine` relit la routine courante avant d'archiver, et `getCurrentRoutineId` ignore les routines archivées. Sans elle, ses gestes tiennent déjà la règle ; elle ferme les courses entre appareils et les appels directs à l'API.

Après le déploiement : restaurer un vrai export depuis l'app, pour constater la taille de requête et le délai d'instruction en conditions réelles.

## Étape 3 : attendre le passage des anciens clients

Une PWA restée ouverte ou hors ligne garde l'ancien code et, dans sa file, des écritures à l'ancienne forme. Avant l'étape 4, chaque appareil du cercle doit avoir rechargé l'app en ligne après le déploiement (nouveau service worker actif) et vidé sa file (bannière « Synchronisé »). Le cercle est petit : le vérifier avec chaque personne plutôt que d'attendre un délai.

## Vérification avant l'étape 4

À cocher une par une. Tant qu'une ligne manque, 0016, 0018, 0021 et 0022 attendent.

- **Version servie** : le site de production sert bien le client de l'étape 2. Dans le bundle servi, on trouve `import_user_data`, `reorder_seances` et l'espace de noms `6f1d7c52-9a3e-4b8f-8d21-5c0e7a94b3d6` ; le premier lancement refuse un nom de plus de 80 caractères avant toute écriture.
- **Appareils à jour** : chaque appareil du cercle a rechargé l'app en ligne depuis ce déploiement.
- **Files vidées** : sur chacun, la bannière dit « Synchronisé », sans saisie en attente ni saisie refusée.
- **Notes à id historique** : sur le nouveau client, rouvrir une séance du jour qui porte une note datée écrite par l'ancien client, la modifier, la vider, la réécrire. Tant qu'elle n'est pas vidée, la note garde son id d'origine ; il n'y a jamais plus d'une ligne en base pour le couple, et rien ne part en quarantaine. Le client résout la note par son couple à chaque écriture, y compris quand la base a répondu trop tard pour qu'il la connaisse (réseau lent) : refaire l'essai en bridant le réseau. Requête de contrôle, attendue vide :
  `select execution_id, exercise_id, count(*) from dated_notes group by 1, 2 having count(*) > 1;`
- **Plus d'ancien import** : aucun appareil ne tourne encore sur un client qui importe table par table (c'est la ligne « Appareils à jour », relue pour 0021 et 0022 : un import de l'ancien client refusé en cours de route laisse un compte à moitié restauré).
- **Routine courante valide** : le contrôle préalable de 0021 (en tête du fichier) ne rend aucune ligne.
- **Rejeu d'une file ancienne** : un appareil resté hors ligne avec des notes en file sous l'ancien client les remonte sans erreur une fois revenu en ligne (c'est le cas tant que 0018 n'est pas appliquée).

## Étape 4 : migrations qui exigent le nouveau client

1. `0016_bornes_de_taille.sql` : l'ancien premier lancement, sans plafond de saisie, pouvait laisser une routine courante vide sur un nom refusé.
2. `0018_note_datee_unique.sql` : un ancien client écrit une seconde note du même couple sous un id aléatoire, que l'index refuserait (saisie en quarantaine).
3. `0021_routine_courante_non_archivable.sql` : l'ancien import, sans transaction, serait refusé en réarchivant une routine redevenue courante (sauvegarde « A archivée, B courante », puis A désarchivée et B supprimée), après avoir écrit les tables précédentes. Effet visible ensuite, à un geste près : supprimer la routine courante quand celle qui redeviendrait courante est archivée est refusé, avec le message de la base.
4. `0022_journal_archivage_insertion_seule.sql` : l'ancien import upserte le journal table par table et s'arrêterait dessus après avoir écrit les six tables précédentes.

## Après coup

Toutes appliquées en prod : étape 1 le 2026-11-23 au soir (0024 le 24 au matin), client déployé le 2026-11-24, étape 4 le 2026-11-24, chaque fois avec contrôle préalable vide et test de contrôle sans `ECHEC`. La table `exercise_overrides` de la prod venait d'une version antérieure de 0007 (policies `_own`, index et trigger absents) : 0015 la réaligne avant tout. L'étape 3 n'a pas attendu une confirmation appareil par appareil : 0016, 0021 et 0022 ne gênent que l'inscription et l'import de l'ancien client, 0018 ne pouvait refuser qu'une seconde note du même couple, envoyée en quarantaine et renvoyable.

`0025_delete_execution_if_empty.sql` est postérieure à ce déploiement : passée au banc local, appliquée en prod le 2026-11-24 vers 17 h (contrôle préalable vide, test de contrôle sans `ECHEC`), AVANT la fusion du client de la refonte E qui l'appelle.

## 0026 : réordonnancement sous révision

`0026_reorder_seances_revision.sql` ajoute `reorder_seances_revision(p_routine_id, p_expected_ids, p_seance_ids)` : la base verrouille les séances de la routine, compare l'ordre courant à l'ordre affiché par le client, puis écrit, ou refuse (PT409, « l'ordre a changé depuis sa lecture ») sans rien toucher. Elle ferme la course où un appareil réécrivait toutes les positions depuis un ordre dépassé et annulait en silence un déplacement fait ailleurs. Elle pose aussi le trigger `seances_en_fin` : une séance ajoutée ou désarchivée va en fin de routine, position calculée par la base sous un verrou de la routine commun avec le réordonnancement (un ajout concurrent attend, puis se place après ; l'import garde ses positions). `reorder_seances` (0023) reste en base : l'ancien client l'appelle encore.

Elle passe AVANT le déploiement du client qui l'appelle (`reorderSeances`, `src/features/authoring/data.ts`). Ce client marche aussi sans elle : la fonction absente (PGRST202), il revient à `reorder_seances`, sans contrôle de révision, comme le client d'avant.

1. Contrôle préalable (en tête du fichier) : une seule ligne, `reorder_seances(uuid,uuid[])`, et aucun trigger `seances_en_fin`.
2. Appliquer la migration (attente de verrou bornée à 5 s, rejouable).
3. Test de contrôle `supabase/tests/0026_reorder_seances_revision.sql` : aucune ligne `ECHEC`.
4. Déployer le client.

Passée au banc local le 2026-11-24 (succès sur ordre à jour ; refus sur ordre dépassé, appel sans compte, autre compte ; deux appareils en même temps : le second attend puis est refusé ; ajout pendant un réordonnancement : attend puis va en fin ; trois séances en position 0 puis un ajout : en fin, et le réordonnancement d'avant l'ajout est refusé ; désarchivage en fin). PAS encore appliquée en prod.

## 0027 : créer une séance en une transaction

`0027_creer_seance.sql` ajoute `create_seance(p_seance_id, p_routine_id, p_name, p_prescriptions)` : la séance, sa version 1 et, pour une copie, ses prescriptions, d'un seul tenant. Le client créait la séance puis sa version en deux requêtes : une coupure entre les deux laissait une séance que la Salle refuse de lancer, et le nouvel essai butait sur l'unicité du nom. L'id vient du client : une demande rejouée parce que sa réponse s'est perdue rend la séance déjà créée, sans doublon. La position est posée en fin de routine, puis recalculée par le trigger `seances_en_fin` de 0026 : 0027 passe APRÈS 0026.

Elle passe AVANT le déploiement du client qui l'appelle (`createSeance` et `duplicateSeance`, `src/features/authoring/data.ts`). Ce client marche aussi sans elle : la fonction absente (PGRST202), il revient aux requêtes séparées, comme le client d'avant.

1. Contrôle préalable (en tête du fichier) : aucune ligne.
2. Appliquer la migration (attente de verrou bornée à 5 s, rejouable).
3. Test de contrôle `supabase/tests/0027_creer_seance.sql` : aucune ligne `ECHEC`.
4. Déployer le client (après 0026 et 0027).

Passée au banc local le 2026-11-24 (création avec sa version et ses prescriptions, en fin de routine ; rejeu du même id sans doublon ; même id pour une autre séance refusé ; autre compte refusé, rien de créé ; nom en double refusé en 23505, ni séance ni version orpheline ; appel sans compte refusé). PAS encore appliquée en prod.
