# La Référence se dérive local-first, et ne s'inclut jamais elle-même

Le repère « dernière fois » se dérivait des seules lignes remontées au serveur (copie de
lecture, ADR 0012), jamais de l'outbox : une séance capturée hors-ligne n'existant dans
aucune des deux sources, la Référence affichait l'avant-dernière — de façon garantie, pas
par malchance de cache. Elle n'écartait pas non plus l'exécution du jour : après une
revalidation post-flush, elle pouvait donc opposer à l'utilisateur les séries qu'il venait
de saisir. On fusionne désormais les opérations en attente de l'outbox par-dessus les
lignes lues avant de dériver, et on écarte l'exécution en cours **par son id**.

Les records chargés en Capture partent du même historique d'avant : ils sont le SOCLE sur
lequel `computeRecordFlags` rejoue les séries du jour (un record « running » qui avance
série après série). Y verser déjà le jour éteindrait le badge d'une série qui vient de
battre le record, au premier remontage de l'écran — la fusion outbox aurait rendu cette
bascule systématique en salle, là où rien n'est encore remonté. Le record reste all-time au
sens du glossaire : le jour est rejoué par-dessus, pas oublié.

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

## Amendement du 2026-11-23

La fusion de l'outbox couvre une série tant qu'elle attend. Une fois acquittée, elle quitte la file, et la copie de lecture ne la contenait pas encore : la Référence retombait en retard jusqu'à la relance. La copie d'historique des exos touchés est désormais relue après tout flush qui acquitte des séries, sous gardes d'ordre (ADR 0020). La fusion ne prend que les ops du compte reconnu (ADR 0019).

## Amendement du 2026-11-23 (Lot 3)

Le même principe vaut désormais pour la note d'instructions d'un exo éditée en Capture : tant que son écriture attend, la Capture la lit dans la file, par-dessus la copie (`applyPendingExerciseNote`). À l'acquittement, son corps est posé dans la copie (`seedRead`), sous seuil et sous garde de compte. C'est la seule écriture directe d'une copie, que cet ADR écarte pour les lignes d'historique : une note est une chaîne, sa forme locale est sa forme serveur.

## Amendement du 2026-11-24 : la copie porte son estampille

La Référence applique la même règle que le tableau de la Salle (ADR 0025) : la copie d'historique, puis les écritures locales qu'elle ne contient pas. La copie garde pour cela l'estampille de la lecture qui l'a écrite. Une série acquittée après le départ de cette lecture est donc encore appliquée, alors qu'elle a quitté l'attente : le trou entre l'acquittement et la relecture de la copie est couvert pendant la rétention du registre (dix minutes), puis par la relecture elle-même (ADR 0020). Une copie écrite avant ce champ n'a pas d'estampille : seules les écritures non acquittées lui sont appliquées, comme avant. La limite « série dont l'`upsertExecution` est déjà partie » ne vaut plus que passé cette rétention.
