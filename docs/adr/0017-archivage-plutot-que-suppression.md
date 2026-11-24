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

- La routine courante ne s'archive pas : il faut d'abord en définir une autre. La base refuse les écritures qui la violeraient (migration 0021) : archiver la routine courante, définir comme courante une routine archivée, et supprimer la routine courante quand la précédente est archivée.
- Archiver ou désarchiver une séance de la routine courante change la configuration du template et coupe un bloc. La timeline des blocs doit donc lire ces gestes comme des événements datés, conservés tous les deux : une simple date d'archivage effacée au désarchivage réécrirait les blocs passés.
- Aucune exécution ne peut plus perdre sa séance par suppression. Au 2026-09-13, la base n'en compte aucune (0 sur 79) : le groupe « Hors séance » de l'analyse n'a plus de source.

## Amendement du 2026-11-23

Le journal des archivages de séance ne se réécrit plus : son propriétaire peut le lire et y insérer, plus le modifier ni le vider (migration 0022). L'insertion reste ouverte parce que deux écrivains en ont besoin, le trigger d'archivage et la restauration d'une sauvegarde, qui rend au journal ses dates d'origine. Pendant une restauration, le trigger n'écrit rien : l'état et le journal viennent du fichier. Un événement daté de l'import n'est ajouté que si le journal fusionné contredit l'état restauré (migration 0024).

## Amendement du 2026-11-23 (fin du lot 3)

La conséquence « la base refuse les écritures qui la violeraient (migration 0021) » ne vaut qu'une fois cette migration appliquée, et elle passe APRÈS le déploiement du client et le passage des anciens (`supabase/tests/ORDRE.md`) : l'ancien import, sans transaction, aurait pu être refusé à mi-chemin et laisser un compte à moitié restauré. D'ici là, seul le client tient la règle dans ses propres gestes (`archiveRoutine` relit la routine courante).

La restauration d'une sauvegarde est jugée sur son état final : les routines sont écrites, puis leurs activations, et seulement ensuite les archivages nouveaux, sous le verrou du compte (migration 0024). Une sauvegarde « A archivée, B courante » se restaure donc dans un compte où A est redevenue courante. Reste refusée, en entier : une sauvegarde dont une routine archivée a été réactivée après la date de la sauvegarde. Limite connue : l'import et un archivage simultané prennent leurs verrous en ordre inverse et peuvent s'interbloquer, Postgres annulant l'un des deux (docs/future-improvements.md, « Base et import »).

## Amendement du 2026-11-24 (second tour du lot 3)

Les deux limites de l'amendement précédent sont levées.

La routine courante du compte ne s'archive pas, même par une restauration : une sauvegarde dont une routine archivée a été réactivée depuis se restaure en entier, sauf cet archivage. L'import fusionne sans retirer d'activation ; celle du compte, plus récente que le fichier, reste la dernière et suppose un désarchivage postérieur, qui l'emporte. L'import tient la règle lui-même, que la migration 0021 soit appliquée ou non. Seul un fichier invalide par lui-même reste refusé en entier : il crée une routine déjà archivée et en fait la courante.

Ordre des verrous : le verrou du compte d'abord, les verrous de ligne ensuite, pour l'import comme pour toute écriture de l'API qui participe à la règle (archivage, suppression de routine, écriture d'activation), par un trigger de début d'instruction (migration 0021). Un import croisé avec l'un de ces gestes ne s'interbloque plus. Sans appelant (`service_role`), l'ancien ordre demeure.
