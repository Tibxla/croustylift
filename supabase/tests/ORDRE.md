# Ordre de déploiement des migrations 0015 à 0024

Les numéros ne donnent pas l'ordre. Trois migrations (0016, 0018, 0022) refuseraient des écritures que le client encore déployé produit : elles attendent le nouveau client, puis le passage des anciens. Le banc local (`banc/lancer.sh`) rejoue exactement cet ordre.

Avant chaque migration : sa requête de contrôle préalable, en commentaire en tête du fichier. Après : son test de contrôle `supabase/tests/00NN_*.sql` (lecture seule, aucune ligne `ECHEC`). Chaque migration borne son attente de verrou à 5 s : sur un échec `lock timeout`, rien n'est appliqué, il suffit de la relancer.

## Étape 1 : migrations compatibles avec le client en place

À appliquer dans cet ordre, client inchangé.

1. `0015_index_et_rls_initplan.sql`
2. `0017_muscles_principaux_non_vides.sql`
3. `0019a_index_des_liens.sql` : SANS transaction (`create index concurrently`). Si l'outil envoie le fichier comme une seule requête, lancer ses instructions une par une. Vérifier ensuite que les six index sont valides (requête « APRÈS COUP » du fichier).
4. `0019b_liens_meme_compte.sql` : hors des heures de salle. Test de contrôle : `supabase/tests/0019_liens_meme_compte.sql`. Puis ouvrir l'app, lire le plan, saisir une série.
5. `0020_override_exo_de_base.sql`
6. `0021_routine_courante_non_archivable.sql`
7. `0023_reorder_seances.sql`
8. `0024_import_transactionnel.sql`

Effet visible sur le client en place : aucun, à un geste près. Supprimer la routine courante quand la précédente est archivée est refusé par 0021, avec le message de la base.

## Étape 2 : déploiement du client

Le client déployé doit porter, ensemble :

- l'import par `import_user_data` (lot 3C, `src/features/export/`) ;
- le réordonnancement par `reorder_seances` (`src/features/authoring/data.ts`) ;
- l'id déterministe des notes datées : UUID v5 du couple `execution_id:exercise_id`, espace de noms `6f1d7c52-9a3e-4b8f-8d21-5c0e7a94b3d6` ;
- le premier lancement qui valide ses deux noms (80 caractères au plus) avant toute écriture.

Après le déploiement : restaurer un vrai export depuis l'app, pour constater la taille de requête et le délai d'instruction en conditions réelles.

## Étape 3 : attendre le passage des anciens clients

Une PWA restée ouverte ou hors ligne garde l'ancien code et, dans sa file, des écritures à l'ancienne forme. Avant l'étape 4, chaque appareil du cercle doit avoir rechargé l'app en ligne après le déploiement (nouveau service worker actif) et vidé sa file (bannière « Synchronisé »). Le cercle est petit : le vérifier avec chaque personne plutôt que d'attendre un délai.

## Étape 4 : migrations qui exigent le nouveau client

1. `0016_bornes_de_taille.sql` : l'ancien premier lancement, sans plafond de saisie, pouvait laisser une routine courante vide sur un nom refusé.
2. `0018_note_datee_unique.sql` : un ancien client écrit une seconde note du même couple sous un id aléatoire, que l'index refuserait (saisie en quarantaine).
3. `0022_journal_archivage_insertion_seule.sql` : l'ancien import upserte le journal table par table et s'arrêterait dessus après avoir écrit les six tables précédentes.

## Après coup

`README.md` annonce 14 migrations : à porter à 25 fichiers (0019 en deux temps) une fois tout appliqué.
