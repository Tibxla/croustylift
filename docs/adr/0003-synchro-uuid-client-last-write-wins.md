# Synchro local-first : UUID client + last-write-wins, pas de moteur de merge

La capture fonctionne offline (cache local + file d'écritures) puis synchronise vers Supabase. Les identifiants sont **générés côté client (UUID)** pour que les lignes créées hors-ligne remontent sans collision. Les conflits sont résolus en **last-write-wins par ligne** (sur `updated_at`). Pas de CRDT ni de moteur de merge.

## Pourquoi

Le modèle élimine déjà presque tout conflit : templates versionnés (jamais mutés, ADR 0001), exécutions et séries quasi append-only, un seul utilisateur par compte (pas d'écriture simultanée sur deux appareils). Un moteur de merge serait de la sur-ingénierie pour ce profil d'usage.

## Conséquences

- Cas résiduel (même ligne éditée sur deux appareils offline) : perte silencieuse de la version perdante. Accepté car quasi impossible en solo.
- Chaque table porte un `id` UUID généré client et un `updated_at`.
