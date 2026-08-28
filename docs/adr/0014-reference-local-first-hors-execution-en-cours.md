# La Référence se dérive local-first, et ne s'inclut jamais elle-même

Le repère « dernière fois » se dérivait des seules lignes remontées au serveur (copie de
lecture, ADR 0012), jamais de l'outbox : une séance capturée hors-ligne n'existant dans
aucune des deux sources, la Référence affichait l'avant-dernière — de façon garantie, pas
par malchance de cache. Elle n'écartait pas non plus l'exécution du jour : après une
revalidation post-flush, elle pouvait donc opposer à l'utilisateur les séries qu'il venait
de saisir. On fusionne désormais les opérations en attente de l'outbox par-dessus les
lignes lues avant de dériver, et on écarte l'exécution en cours **par son id**.

## Alternatives écartées

- **Write-through** (l'outbox écrit aussi dans la copie de lecture) : corrige le retard,
  mais duplique la forme des lignes serveur côté écriture — deux endroits qui doivent
  rester d'accord sur ce qu'est un `performed_set`, et une copie empoisonnée si l'un dérive.
  Ne corrige pas non plus le cas où la revalidation part avant que la clé soit au registre.
- **Écarter toute exécution portant la date du jour** plutôt que la seule en cours : plus
  simple (la date est connue avant les lectures), mais après une Clôture une seconde
  exécution le même jour repart vierge (ADR 0009) — le repère sauterait alors à la semaine
  précédente au moment précis où les séries du matin ne sont plus visibles nulle part.
- **Revalider avant de dériver** : remet une lecture réseau sur le chemin d'ouverture d'une
  séance, contre l'ADR 0012, et sans effet là où le besoin existe — au sous-sol.

## Conséquences

- L'id de l'exécution du jour n'est pas connu quand l'historique se charge (les deux
  lectures partent en parallèle). Les lignes plates sont donc conservées dans l'état et la
  Référence dérivée une fois l'id connu, plutôt que de séquencer les requêtes.
- La dérivation reste pure et testable sans réseau : la fusion produit des lignes de la
  même forme que celles du serveur, `deriveExerciseHistory` ne change pas de signature.
- Supersède la limite assumée de l'ADR 0012 sur la « Référence en retard d'une exécution ».
