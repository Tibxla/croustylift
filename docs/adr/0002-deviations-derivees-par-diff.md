# Déviations dérivées par diff, pas d'event-sourcing

Une exécution stocke (a) la version de séance active ce jour-là et (b) les séries réellement faites. Les déviations (séries en moins ou en plus, exo skippé, exo remplacé, ordre changé) ne sont **pas** enregistrées comme événements explicites : elles sont **dérivées** en comparant le réel à la prescription.

## Pourquoi

Le brainstorm parlait de « déviation = événement loggé », ce qui suggère de l'event-sourcing. On choisit volontairement le diff : le résultat auditable est identique (on sait toujours prévu vs fait) pour un modèle bien plus simple, et la capture « 1 tap, zéro menu » n'a de toute façon pas de place pour des gestes d'annulation explicites.

## Conséquences

- Pas de journal d'événements à maintenir ni à rejouer.
- Le motif d'une déviation (fatigue, blessure) n'est pas typé : il vit en texte libre dans la **note datée**.
- Corriger un mis-tap = éditer/supprimer une série (une correction de saisie, pas un événement métier).
