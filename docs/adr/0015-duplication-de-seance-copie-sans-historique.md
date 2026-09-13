# Duplication de séance : copie franche, sans historique ni provenance

Créer une séance peut partir d'une séance existante — n'importe laquelle, toutes routines confondues. Le geste **copie** le contenu de la version courante de la source (exercices et prescriptions) dans une séance neuve, dans la routine où l'on se trouve. Les deux séances sont indépendantes dès la copie ; une séance appartient toujours à une seule routine.

La séance née d'une duplication n'hérite d'**aucun historique** : ni Référence, ni note datée en repère, ni courbe, tant qu'elle n'a pas été exécutée. Seuls les Records personnels, qui ignorent la séance, restent visibles. Aucun lien de provenance n'est stocké. Il n'existe **pas** de duplication de routine.

## Pourquoi

Le besoin est la page blanche : on crée une séance en repartant d'une autre pour la modifier, pas pour la partager. Une copie qui ferait suivre la Référence serait un partage déguisé — un lien invisible, non déclaré, impossible à auditer.

Le repère par séance existe parce que le contexte de fatigue diffère d'une séance à l'autre. Une séance dupliquée puis modifiée est précisément un autre contexte : lui prêter le repère de sa source serait malhonnête, pas serviable. Le trou dure une exécution.

Dupliquer une **routine** entière servirait surtout à tester une variante du plan (« 4 séries de triceps au lieu de 2 »). Toutes les séances copiées repartiraient sans Référence en salle, et la courbe de chaque exercice se couperait en deux sur la carte. La bonne façon de tester une variante reste d'éditer la prescription en place : nouvelle version, bloc coupé, Référence et courbe continues (ADR 0001). Offrir ce bouton, c'est offrir le piège : il ressemble à la bonne action et casse les repères qui servent à la juger.

_Révisé le 2026-09-13_ : l'argument d'origine, « de nouvelles séances repartent sans historique, donc sans comparaison possible », est tombé avec l'ADR 0016, qui compare des blocs de routines différentes. L'interdiction tient pour les raisons ci-dessus.

## Alternatives écartées

- **Séance partagée entre deux routines** (relation plusieurs-à-plusieurs) : casse « une séance appartient à une seule routine », et une édition depuis une routine couperait un bloc dans l'autre.
- **Copie qui hérite de la Référence** : rétablit un lien caché entre deux séances déclarées indépendantes, et ment sur le contexte de la perf.
- **Duplication de routine** : efface la Référence et coupe la courbe de chaque séance copiée, pour un raccourci de deux à quatre gestes.
- **Colonne de provenance** (`derived_from_seance_id`) : un lien qui n'autorise rien crée l'attente qu'il autorise quelque chose, et pourrit dès que les deux séances divergent.
- **Exposer le modèle de départ livré dans le même sélecteur** : mélange deux natures de sources ; ce modèle sert à amorcer un compte vide, pas à alimenter une duplication.

## Conséquences

- Aucune migration : la duplication réutilise `createSeance` puis `saveSeanceVersion`, comme le premier lancement le fait déjà avec le modèle de départ.
- Le sélecteur liste toutes les séances de l'utilisateur, groupées par routine, la routine courante en tête ; une séance sans exercice y reste visible plutôt que filtrée en silence.
- Dupliquer vers la routine courante change la configuration du template et coupe donc un bloc, comme toute édition de plan. Vers une autre routine, aucun bloc n'est touché.
- La duplication est hors ligne indisponible, comme le reste de l'authoring (écriture directe, pas d'outbox).
