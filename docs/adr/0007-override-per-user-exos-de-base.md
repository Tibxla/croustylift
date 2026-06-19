# Override per-user des exercices de base

Un exercice de base (`owner_id` null) est commun à tous et n'est **jamais** modifié. Pour qu'un utilisateur l'adapte à sa réalité, on stocke un **override** par couple (utilisateur, exercice) dans la table `exercise_overrides` : `user_id`, `exercise_id`, et les champs surchargeables `name`, `unilateral`, `primary_muscles`. La fusion base + override se fait **à la lecture**, **champ par champ** : un champ effectivement renseigné gagne, les autres gardent la base. La ligne de base reste intacte.

## Pourquoi

Les utilisateurs veulent renommer (« DC » → « DC haltères »), marquer un mouvement unilatéral, ou ajuster les muscles principaux d'un exo de base — sans toucher au catalogue partagé que voient les autres. Une table d'overrides scopée par RLS isole chaque personnalisation, garde le catalogue commun en lecture seule, et permet de réinitialiser (supprimer l'override) pour revenir au partagé. La fusion champ par champ évite qu'un override partiel efface les champs non touchés de la base.

## Alternatives écartées

- **Éditer l'exo de base en place** : casserait le catalogue partagé pour tout le monde.
- **Copier l'exo de base en exo perso** : duplique le catalogue, perd le lien à la source, et fait diverger les copies des mises à jour du commun.
- **Fusion en bloc (l'override remplace l'exo entier)** : un override partiel viderait les champs non renseignés ; la fusion champ par champ est la seule sûre.

## Conséquences

- Tous les chemins de lecture des champs partagés d'un exo passent par la même règle de fusion pure, jamais réimplémentée.
- Champs surchargeables limités à `name`, `unilateral`, `primary_muscles` ; `muscle_group` legacy n'est pas personnalisable.
- `upsert` par (user_id, exercise_id) : ré-éditer écrase l'unique ligne ; la supprimer réinitialise l'exo au partagé.
