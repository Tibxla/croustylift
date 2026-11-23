# Synchro local-first : UUID client + last-write-wins, pas de moteur de merge

La capture fonctionne offline (cache local + file d'écritures) puis synchronise vers Supabase. Les identifiants sont **générés côté client (UUID)** pour que les lignes créées hors-ligne remontent sans collision. Les conflits sont résolus en **last-write-wins par ligne** (sur `updated_at`). Pas de CRDT ni de moteur de merge.

## Pourquoi

Le modèle élimine déjà presque tout conflit : templates versionnés (jamais mutés, ADR 0001), exécutions et séries quasi append-only, un seul utilisateur par compte (pas d'écriture simultanée sur deux appareils). Un moteur de merge serait de la sur-ingénierie pour ce profil d'usage.

## Conséquences

- Cas résiduel (même ligne éditée sur deux appareils offline) : perte silencieuse de la version perdante. Accepté car quasi impossible en solo.
- Chaque table porte un `id` UUID généré client et un `updated_at`.

## Amendements du 2026-11-23

- **Rejet définitif.** La file ne s'arrête plus sur une op que la base refuse pour de bon (contrainte, RLS) : l'op part en quarantaine et la file continue (ADR 0018). L'arrêt à la première op en échec reste la règle pour tout le reste.
- **Compte.** Chaque op porte le compte qui l'a saisie ; le flush ne tente rien sans session vérifiée et ne rejoue que les ops du compte connecté. L'ordre FIFO vaut entre les ops d'un même compte (ADR 0019).
- **Exécution.** La version de séance, la date et le lancement d'une exécution font exception au last-write-wins : la ligne est créée en insertion seule et sa réaffirmation ne les réécrit pas (ADR 0021). Clôture et métriques de fin restent en last-write-wins.
- **Lectures.** Les lectures d'historique sont paginées au curseur sur `id` (ADR 0022).
- **Note datée (fin du lot 3).** Pour une note datée, l'`id` généré côté client n'est pas l'identité de la ligne : c'est son couple (exécution, exercice). L'id est déterministe (UUID v5 du couple) et ne sert qu'à créer la ligne ; l'écriture relit d'abord la note du couple et réécrit sa ligne, l'effacement vise le couple (`features/notes/data.ts`). Une note écrite par un ancien client, sous un id aléatoire, n'est donc ni doublée ni refusée par l'unicité de la migration 0018. Limite connue : une file enfilée avant ce changement peut acquitter un effacement sans l'appliquer (docs/future-improvements.md, « Notes datées »).
