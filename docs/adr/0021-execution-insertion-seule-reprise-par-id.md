# Exécution créée en insertion seule, reprise par son id

L'op `upsertExecution` ne fait plus que créer. En base c'est un `insert ... on conflict (id) do nothing` (`ignoreDuplicates`) : rejouer l'op, ou la réaffirmer à chaque remontage de la Capture, ne touche jamais une ligne existante. Une exécution garde donc la version de séance, la date et le lancement sous lesquels elle est née. Clôture et métriques de fin passent par `updateExecution`, seule op qui modifie une exécution.

En conséquence, l'appareil qui tient une séance en cours la relit **par son id** (celui de son état de capture restauré), quelle que soit la version de séance courante. Sans état local, la recherche reste « l'exécution ouverte du jour pour la version courante ». Dans les deux cas, une exécution que la file clôt ou supprime n'est pas adoptée, même si la base la montre encore ouverte.

## Pourquoi

La Capture réenfile l'exécution avant la première série de chaque montage, avec la version de séance qu'elle vient de charger. Tant que l'upsert réécrivait la ligne, une séance retouchée en plein entraînement faisait basculer l'exécution entamée, et toutes ses séries avec elle, sur la nouvelle version : l'Analyse rangeait la séance du jour sous un plan qu'elle n'avait pas suivi. Le même chemin réécrivait `started_at`, et une séance d'1 h 30 pouvait ressortir à 25 min. Aucun chemin n'a besoin de modifier ces trois colonnes après coup.

Une fois l'exécution figée sur sa version de naissance, la chercher par version courante ne la retrouve plus après une retouche du plan. La Capture ne reprenait alors que son état local, sans les séries écrites ailleurs (depuis le journal), et réutilisait un rang déjà pris (1, 2, 3, 3). L'id est la seule clé qui ne bouge pas.

La garde sur la file répond à un décalage : Clôture, Annulation et suppression effacent l'état local dès le geste, alors que leur écriture attend peut-être encore. Capture rouverte avant l'envoi, la base montrait l'exécution ouverte ; elle était adoptée, et la série suivante rouvrait la séance close ou recréait l'exécution supprimée.

## Alternatives écartées

- **Upsert qui réécrit** (comportement d'origine) : c'est le bug, version et lancement suivent le dernier montage.
- **Garder la seule recherche par version courante** : après une retouche du plan, l'appareil ne retrouve plus l'exécution qu'il tient lui-même.
- **Adopter toute exécution que la base montre ouverte** : la base est en retard sur les gestes de Clôture, d'Annulation et de suppression tant que leur écriture attend.

## Conséquences

- Séance retouchée pendant l'entraînement : la Capture remontée affiche le template de la nouvelle version pour la fin de la séance, la base la range sous l'ancienne. Écart d'affichage accepté, l'Analyse reste juste.
- Sans état local (autre appareil, stockage vidé) et plan retouché entre-temps, l'exécution entamée n'est pas retrouvée : la suite ouvre une seconde exécution.
- Un lancement réancré hors ligne sur une exécution déjà en base n'atteint plus `started_at`. Le réancrage (ADR 0011) ne vise de toute façon qu'une exécution pas encore née.
- La garde sur la file lit la file, avant et après la lecture réseau, dont la réponse est figée à son départ.
- La suppression d'une exécution depuis le journal efface l'état de capture local qui la porte (`clearPersistedExecution`), comme la Clôture et l'Annulation : cet état prime à la réhydratation, et la série suivante recréait l'exécution supprimée sous le même id.
- Précise l'ADR 0003 : pour la version, la date et le lancement d'une exécution, la règle est « la première écriture gagne ». Clôture et métriques de fin restent en last-write-wins.

## Amendements du 2026-11-23 (Lot 3)

- **Clôture sortie de la file sans effet.** La limite « une clôture sortie de la file sans avoir été appliquée en base ne serait plus vue » est levée. `update` et `delete` relèvent désormais les lignes qu'ils touchent. Une clôture à zéro ligne ne peut vouloir dire que « l'exécution n'existe pas en base » : la session est vérifiée avant et après chaque op (ADR 0019), la création précède dans la file, et une création refusée emmène ses ops filles en quarantaine (ADR 0018). Une exécution absente ne peut pas être reprise, la garde n'a donc rien à voir. Le cas reste un succès (c'est celui, voulu, d'une clôture sans série envoyée) et il est tracé en console. Une suppression à zéro ligne est un succès idempotent.
- **Série annulée en attente.** La même garde vaut pour une série : tant que son `deleteSet` attend en file, la base la porte encore et la fusion, qui garde la liste la plus longue, la ramenait à l'écran au remontage. Le réalisé relu est désormais purgé des séries que la file supprime, avec les mêmes deux lectures de la file (avant et après la lecture réseau).
