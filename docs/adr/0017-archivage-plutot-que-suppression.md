# Archivage des routines et séances exécutées, suppression réservée au jamais-exécuté

Une routine ou une séance qui compte au moins une exécution ne se supprime plus : elle s'archive. Archivée, elle sort du plan (on ne peut plus la définir comme routine courante ni la choisir en salle), mais son historique reste entier : activations, versions, exécutions et nom. Le désarchivage la rend au plan ; sa Référence et sa courbe reprennent là où elles s'étaient arrêtées. Son nom reste réservé pendant l'archivage. Seul ce qui n'a jamais été exécuté se supprime.

## Pourquoi

Supprimer effaçait l'historique sans le dire. `routine_activations` et `seance_versions` partent en cascade, et les exécutions perdent leur séance (`on delete set null`). Les blocs se recalculaient sans la routine supprimée : sa période était rattachée au bloc d'avant, et ses exécutions tombaient dans un groupe « Hors séance » qui mêlait toutes les séances disparues, avec les dents de scie que l'issue #67 avait supprimées. La confirmation demandait seulement « Supprimer cette routine et ses séances ? ».

Depuis l'ADR 0016, une ancienne routine est l'un des deux termes d'une comparaison de blocs. Le geste le plus naturel après un changement de routine, ranger l'ancienne, détruisait précisément la comparaison qu'on venait de rendre possible.

Revenir à une ancienne routine arrive souvent. Désarchiver garde la Référence et la courbe ; recréer la routine par duplication les perdrait (ADR 0015).

Le nom reste réservé parce que l'analyse désigne une séance par « séance · routine ». Une routine active et une routine archivée du même nom rendraient ce libellé ambigu.

## Alternatives écartées

- **Supprimer en cascade jusqu'aux exécutions**, sur le modèle de l'ADR 0008 : plus d'orphelines, mais on détruit des semaines de mesures pour faire de la place. Le rangement a déjà deux réponses qui ne détruisent rien : l'archivage dans le plan, le masquage des courbes dans l'analyse.
- **Garder la suppression avec une confirmation qui annonce les dégâts** : le piège reste, et le mélange « Hors séance » avec.
- **Archivage sans retour** : revenir à une routine obligerait à la dupliquer, donc à repartir sans Référence.
- **Libérer le nom pendant l'archivage** : casse l'unicité de « séance · routine » dans l'analyse.

## Conséquences

- La routine courante ne s'archive pas : il faut d'abord en définir une autre.
- Archiver ou désarchiver une séance de la routine courante change la configuration du template et coupe un bloc. La timeline des blocs doit donc lire ces gestes comme des événements datés, conservés tous les deux : une simple date d'archivage effacée au désarchivage réécrirait les blocs passés.
- Aucune exécution ne peut plus perdre sa séance par suppression. Au 2026-09-13, la base n'en compte aucune (0 sur 79) : le groupe « Hors séance » de l'analyse n'a plus de source.
