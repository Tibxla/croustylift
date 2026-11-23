# Quarantaine des écritures que la base rejette définitivement

Quand la base refuse une écriture de l'outbox pour une raison qui ne changera pas au prochain essai, l'op quitte la file et part en **quarantaine** : conservée telle quelle sous une clé locale dédiée, avec la raison du rejet et sa date, jamais rejouée automatiquement. La file continue derrière elle. Un rejet est tenu pour définitif sur une liste blanche de codes SQLSTATE : classe 22 (donnée invalide), classe 23 (violation de contrainte : clé étrangère, unicité, check, not null) et 42501 (refus RLS). Toute autre erreur (réseau, jeton, 5xx, 408, 429) garde l'arrêt de la passe et le nouvel essai de l'ADR 0003.

Les ops filles d'une exécution dont la création est en quarantaine (ses séries, ses notes datées, sa clôture) la rejoignent sans être envoyées. Côté utilisateur, la quarantaine se lit comme des **saisies refusées** : la bannière de synchro passe à l'ambre et affiche « n saisie(s) refusée(s) par le serveur, non envoyée(s) » tant qu'il en reste.

## Pourquoi

Une op rejetée par une contrainte échoue à l'identique à chaque passe. Laissée en tête, elle bloquait tout ce qui la suivait, et la seule issue était la purge totale de la file. C'est l'incident du 2026-07-30 : une clôture à durée nulle, refusée par un check (levé depuis par la migration 0012), a tenu la file entière.

On conserve l'op au lieu de la jeter parce que la règle de l'ADR 0012 tient toujours : rien ne se perd sans geste explicite. La raison du rejet est gardée avec elle pour le diagnostic.

Les ops filles suivent leur parent parce qu'envoyées, elles échoueraient à leur tour sur la clé étrangère, ou pire « réussiraient » à vide : la clôture d'une exécution absente touche zéro ligne sans erreur.

La liste est blanche parce que l'erreur inverse coûte plus cher. Tenir une coupure réseau pour un rejet sortirait de la file une saisie valide ; tenir un rejet pour une coupure ne fait que ramener le blocage d'avant.

## Alternatives écartées

- **Laisser l'op en tête et arrêter la passe** (comportement d'origine) : une seule op fautive retient toutes les saisies suivantes, sans autre sortie que la purge.
- **Jeter l'op rejetée** : la file se débloque, mais une saisie disparaît sans que l'utilisateur l'ait décidé, contre l'ADR 0012.
- **Se fier au statut HTTP** : les fonctions de sync relancent l'objet d'erreur de PostgREST, qui n'en porte pas. Seul son `code` est fiable.

## Conséquences

- Clé locale `croustylift:outbox:quarantine`, distincte de `croustylift:outbox:corrupt` (blob de file illisible mis de côté). Dans les docs, « quarantaine » désigne les ops rejetées.
- L'indicateur de synchro reste sur la file (`pendingCount`), mais il ne dit plus « Synchronisé » quand la quarantaine n'est pas vide. Les gardes de compte (Déconnexion, arrivée d'un autre compte) comptent file et quarantaine (`heldCount`) : une saisie refusée bloque la Déconnexion comme une saisie en attente, et le message de refus sépare ce qui attend encore l'envoi de ce que le serveur a refusé.
- Une saisie refusée ne sort de la quarantaine que par un geste : le forçage de purge, l'annulation de sa séance (« Annuler la séance » retire de la file et de la quarantaine les ops de l'exécution abandonnée), ou son renvoi ou son abandon un par un (voir l'amendement du 2026-11-23).
- `flushOps` compte comme non remontée une op partie en quarantaine : l'éditeur de séance passée ne se ferme pas sur une correction que la base a refusée.
- Quand l'exécution refusée est réaffirmée avec succès plus tard, son entrée est marquée `superseded` : elle reste conservée, mais ne retient plus ses ops filles.
- Avant de mettre une op en quarantaine sous une session vérifiée, le flush revérifie la session : un refus RLS reçu juste après la chute du jeton ne dit rien de l'op, qui reste en file (ADR 0019).

## Amendements du 2026-11-23 (Lot 3)

- **Identité d'enfilement.** Chaque op reçoit à l'enfilement un UUID (`_uid`), qui remplace le compteur `_seq` comme identité de file. `flushOps` retrouve ses ops par cette identité, en file comme en quarantaine, au lieu de les repérer par leur position dans la quarantaine : avec deux onglets, une purge concurrente pouvait faire passer une correction refusée pour une sauvegarde réussie. `flushOps` rend à part ce qui attend (`pending`) et ce que la base a refusé (`refused`), et l'éditeur de séance passée ne dit plus « pas de réseau » pour un refus.
- **Un onglet flushe à la fois.** Le flush se fait sous un verrou du navigateur (`navigator.locks`), jamais attendu : verrou pris, la passe ne fait rien, l'autre onglet vide la même file. Le verrou n'est jamais repris à un autre onglet, même après un long refus : deux onglets n'écrivent jamais en même temps (un onglet figé en pleine passe le garde jusqu'à son réveil). Tant que le verrou a été refusé et que la file n'est pas vide, un nouvel essai est reprogrammé (0,5 s, puis le double, plafonné à 30 s), pour qu'une passe arrêtée sur un échec transitoire dans l'autre onglet ne laisse pas la file sans réveil.
- **Lister, renvoyer, abandonner.** La file expose les saisies refusées du compte reconnu avec leur raison (`listRefused`), le renvoi d'une saisie en fin de file (`retryRefused`, qui emmène avec la création d'une exécution les saisies qui en dépendaient) et son abandon (`abandonRefused`). La limite « ni rejeu manuel ni écran de détail » est levée côté logique ; l'écran de détail, dans le bloc Compte, se pose avec la refonte visuelle. D'ici là l'utilisateur voit toujours un compte.
- **Stockage plein.** Quand le stockage refuse l'écriture de la file, les copies de lecture non essentielles cèdent d'abord la place, par paliers (repères et catalogue, puis historique des exos hors plan), jamais celles du chemin d'ouverture de la Capture (`cache-eviction`). Si cela ne suffit pas, l'écart entre la file voulue et la file persistée est tenu en mémoire, par identité d'enfilement, et rejoué sur la file relue à chaque lecture : ce qu'un autre onglet y écrit n'est jamais effacé. Le flush envoie le tout, chaque écriture retente le stockage, et la bannière passe à l'ambre : « Stockage de l'appareil plein ». Avant, l'op enfilée était perdue sur-le-champ et la bannière disait « Synchronisé ». Limite : ce qui n'a pas pu être écrit est perdu si la page se ferme, et la file persistée, en retard, peut rejouer après rechargement une insertion dont la suppression n'existait qu'en mémoire.

## Amendement du 2026-11-23 (fin du lot 3)

- **Stockage plein et mise à jour de l'app.** La limite « ce qui n'a pas pu être écrit est perdu si la page se ferme » ne vaut plus pour un rechargement décidé par l'app : tant que des écritures enfilées ne tiennent qu'en mémoire, aucun rechargement automatique n'a lieu, séance close comprise (`hasUnpersistedOps`, `pwa/reload-guards.ts`). Le refus tombe dès qu'elles sont écrites sur l'appareil ou acquittées par la base. Fermer la page à la main les perd toujours. Limites connues : après le retour du stockage, la mise à jour reste retenue jusqu'à la prochaine écriture de la file ; et sous repli mémoire, une écriture ancienne d'un onglet peut partir après la correction d'un autre (docs/future-improvements.md, « File d'écritures et stockage plein »).
- **Second tour (2026-11-23).** La limite « après le retour du stockage, la mise à jour reste retenue jusqu'à la prochaine écriture de la file » est levée : chaque demande de rechargement retente d'abord d'écrire la file sur l'appareil (`retryPersistQueue`), puis réévalue.
