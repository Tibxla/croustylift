# L'appartenance des liens est tenue par la base, pas par la RLS seule

Une ligne ne se rattache qu'à un parent du même compte, et c'est le schéma qui le garantit. Entre tables possédées (routine, séance, version, exécution et leurs filles), la clé étrangère est composite : `(parent_id, owner_id)` vers `(id, owner_id)`. Vers `exercises`, dont le parent peut être un exo de base sans propriétaire, un trigger refuse tout exo qui n'est ni de base ni au compte de la ligne. Les unicités qui portaient sur un parent (nom de séance dans sa routine, numéro de version dans sa séance, note datée dans son exécution) incluent `owner_id` (migrations 0018, 0019a et 0019b).

## Pourquoi

Les policies RLS ne regardaient que le `owner_id` de la ligne écrite, jamais celui de son parent, et ni les clés étrangères ni les index uniques ne passent par la RLS. Un compte qui connaissait un UUID d'un autre (ils figurent tous dans une sauvegarde partagée) pouvait y accrocher ses propres lignes. Invisibles pour la victime, elles bloquaient la suppression de sa séance, de sa routine et de son compte, lui prenaient un nom de séance, ou gelaient l'édition d'une séance.

L'index unique est vérifié avant la clé étrangère. Sans `owner_id` dans l'index, une écriture étrangère recevait une erreur d'unicité quand le nom existait et une erreur de clé sinon : le refus lui-même renseignait sur le plan d'autrui.

## Alternatives écartées

- **`WITH CHECK ... exists (parent du même compte)` dans les policies** : même effet tant que les policies sont justes, mais la règle dépend alors de chaque policy future, ne vaut pas pour le rôle de service, et coûte une sous-requête par ligne écrite. La clé composite est vérifiée par la base quelle que soit la policy.
- **Garder une clé simple et ajouter la composite à côté** : deux clés entre les mêmes tables rendent ambiguës les jointures PostgREST du client. Chaque clé est remplacée, sous le même nom et avec la même action à la suppression.
- **Clé composite vers `exercises`** : impossible, un exo de base a un `owner_id` nul et sert à tous les comptes.

## Conséquences

- Chaque table parente porte un index unique `(id, owner_id)`, cible des clés composites.
- Toute nouvelle table fille d'une table possédée reprend le motif : clé composite avec `owner_id`, et `owner_id` dans ses index uniques.
- Les refus sortent en classe 23 (23503 pour les liens) : une écriture de l'outbox qui les rencontrerait part en quarantaine (ADR 0018) sans bloquer la file.
- `executions.seance_version_id` reste nullable : une exécution sans séance n'a pas de parent à vérifier.
- `exercise_overrides` suit une règle plus stricte, l'exo doit être de base (ADR 0007, migration 0020).
