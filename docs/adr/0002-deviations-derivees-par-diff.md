# Déviations dérivées par diff, pas d'event-sourcing

Une exécution stocke (a) la version de séance active ce jour-là et (b) les séries réellement faites. Les déviations (séries en moins ou en plus, exo skippé, exo remplacé, ordre changé) ne sont **pas** enregistrées comme événements explicites : elles sont **dérivées** en comparant le réel à la prescription.

## Pourquoi

Le brainstorm parlait de « déviation = événement loggé », ce qui suggère de l'event-sourcing. On choisit volontairement le diff : le résultat auditable est identique (on sait toujours prévu vs fait) pour un modèle bien plus simple, et la capture « 1 tap, zéro menu » n'a de toute façon pas de place pour des gestes d'annulation explicites.

## Conséquences

- Pas de journal d'événements à maintenir ni à rejouer.
- Le motif d'une déviation (fatigue, blessure) n'est pas typé : il vit en texte libre dans la **note datée**.
- Corriger un mis-tap = éditer/supprimer une série (une correction de saisie, pas un événement métier).

## Amendement du 2026-11-23 (Lot 3)

Les déviations d'exo restent dérivées par diff, sans écriture en base. Mais la liste réelle ne vivait que dans l'état de l'écran : un exo ajouté ou remplacé disparaissait au changement d'onglet ou au rechargement, et ses séries sortaient du récap. Les gestes d'ajout et de remplacement sont désormais journalisés dans l'état de capture persisté (`layout`), donc liés à l'id de l'exécution, et rejoués sur le template au remontage (`replayLayout`). Portée : le téléphone qui a fait les gestes. Un autre appareil qui reprend la séance ne voit que le template ; la disposition n'est pas reconstruite depuis les séries en base.

## Amendement du 2026-11-25 (refonte, moteur de la Salle)

Remplacer un exo déjà commencé (machine prise) ne lui retire plus ses séries de l'écran. L'exo remplacé reste à sa place dans la séance, « en cours », et le remplaçant s'insère juste après lui, marqué « remplacé ». La déviation dérivée est toujours celle du remplaçant (`swapped`, avec l'exo qu'il remplace) ; l'exo d'origine, resté dans la séance, n'en est pas une. « Commencé » est inscrit dans le geste de la disposition (`keepsReplaced`) au moment où il est fait, et n'est pas redérivé au rechargement (`replaceExercise`, `features/capture/exercise-gestures.ts`). Un exo sans série est remplacé en place, comme avant.
