# Templates versionnés, blocs dérivés automatiquement

Les séances et leurs prescriptions sont **versionnées** : éditer une prescription crée une nouvelle version, et chaque exécution reste rattachée à la version active au moment où elle a eu lieu. Un **bloc** (l'unité de comparaison de la progression) n'est jamais déclaré à la main — il est dérivé automatiquement comme la période continue durant laquelle la configuration du template (routine courante + ses séances) n'a pas changé. Les déviations d'exécution (série annulée/ajoutée, exo skippé/remplacé) ne créent ni version ni bloc.

## Pourquoi

Le but produit est de comparer des configurations d'entraînement stables (« triceps 2 séries vs 4 séries ») par vitesse de progression. Ça n'a de sens que si (a) on sait précisément sous quelle prescription chaque perf a été réalisée, et (b) les frontières de blocs suivent les changements *de plan*, pas le bruit des séances individuelles.

## Alternatives écartées

- **Templates mutables (édition en place)** : casse l'auditabilité — une perf passée ne saurait plus dire sous quelle prescription elle a eu lieu, et l'attribution aux blocs devient fausse.
- **Blocs déclarés manuellement** : friction et oublis ; l'utilisateur a explicitement refusé de déclarer les blocs à l'avance.

## Conséquences

- Toute lecture du template vise une version précise (celle active à une date donnée).
- Les déviations sont stockées au niveau exécution, séparées du template versionné.
