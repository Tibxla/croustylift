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
- Une saisie refusée ne sort de la quarantaine que par le forçage de purge, ou par l'annulation de sa séance (« Annuler la séance » retire de la file et de la quarantaine les ops de l'exécution abandonnée). Il n'y a ni rejeu manuel ni écran de détail : l'utilisateur voit un compte, la raison reste dans le stockage et la console.
- `flushOps` compte comme non remontée une op partie en quarantaine : l'éditeur de séance passée ne se ferme pas sur une correction que la base a refusée.
- Quand l'exécution refusée est réaffirmée avec succès plus tard, son entrée est marquée `superseded` : elle reste conservée, mais ne retient plus ses ops filles.
- Avant de mettre une op en quarantaine sous une session vérifiée, le flush revérifie la session : un refus RLS reçu juste après la chute du jeton ne dit rien de l'op, qui reste en file (ADR 0019).
