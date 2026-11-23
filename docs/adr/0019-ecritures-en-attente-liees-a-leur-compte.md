# Les écritures en attente appartiennent à un compte, et ne partent que sous lui

La file d'écritures est commune à l'appareil, mais chaque op porte désormais le compte qui l'a saisie : `enqueue` y pose `_owner`, l'id du compte reconnu sur l'appareil à cet instant. Le flush reçoit un lecteur de la session vérifiée et applique deux règles. Sans session vérifiée, rien n'est tenté : la passe s'arrête comme hors ligne. Sous une session, seules les ops du compte connecté sont jouées ; celles d'un autre compte restent en file, à leur place.

L'état de capture persisté porte lui aussi son compte (`ownerId`) et n'est pas restauré sous un autre. La Référence ne fusionne que les séries en attente du compte reconnu (ADR 0014). Quand une session validée arrive pour un compte différent de celui que l'appareil reconnaissait, les copies de lecture et l'état de capture du précédent sont purgés, sauf s'il lui reste des écritures retenues (file ou quarantaine) : dans ce cas rien n'est purgé. L'inscription reçoit la même garde que la Connexion : un autre compte ne s'installe pas par-dessus des écritures retenues.

## Pourquoi

Rien ne liait une saisie à son auteur. Après une révocation, un autre compte arrivé par inscription ou par lien de récupération voyait les saisies du premier remonter sous son identité (audit sécurité, constat 1). Les copies de lecture et l'état de capture de l'ancien compte restaient aussi en clair dans le stockage pendant toute l'utilisation par le nouveau (constat 3).

Sans session, supabase-js n'échoue pas : il envoie la requête sous la clé publique. La RLS fait alors toucher zéro ligne à un `update` ou un `delete`, sans erreur, et l'op était retirée comme acquittée. Une clôture, une annulation ou une suppression pouvaient se perdre ainsi en silence (audit sync, constat 4). La session est donc lue avant chaque op, puis de nouveau après son succès : si elle est tombée pendant la requête, l'op n'est pas acquittée. La rejouer ne coûte rien, elle est idempotente par id.

La purge à l'arrivée d'un autre compte s'arrête devant des écritures retenues parce que la règle de l'ADR 0012 prime : rien ne se perd sans geste explicite.

## Alternatives écartées

- **Purger la file à l'arrivée d'un autre compte** : c'est perdre des saisies sans geste de leur auteur.
- **Attribuer les ops sans compte au moment du flush** : les ops d'un bundle antérieur iraient au compte connecté à ce moment-là, qui peut être le second. `adoptLegacyOps` les attribue au compte reconnu au chargement, avant tout événement d'auth. Sans marqueur, elles ne sont attribuées à personne et ne partent pas.
- **Laisser la garde sur la seule Connexion** : sans confirmation d'e-mail, l'inscription ouvre une session sur-le-champ et contournait la garde (audit sync, constat 12).

## Conséquences

- L'ordre FIFO de l'ADR 0003 vaut désormais entre les ops d'un même compte. D'un compte à l'autre il n'y a aucune dépendance, donc le flush peut sauter les ops d'un autre compte sans rien casser.
- Les ops d'un compte absent restent en file tant qu'il ne revient pas. Elles ne retiennent pas le compte présent et sa Déconnexion ne les jette pas (amendement du 2026-11-23, « Par compte »).
- La garde d'arrivée couvre la Connexion et toute session qui arrive sans passer par elle : lien de récupération, lien d'invitation, session restaurée (amendement du 2026-11-23, « Arrivée par lien »).
- Le lecteur de session vit dans `lib/session-identity`, posé par la couche d'auth. La pagination s'en sert aussi (ADR 0022). Le cache de lecture, lui, garde ses copies sur le marqueur local, pas sur la session. Sans lecteur posé (tests de la file seule), rien n'est vérifié.
- Amende l'ADR 0012 : le forçage reste la seule porte par laquelle des écritures non synchronisées disparaissent, mais les copies de lecture et l'état de capture d'un compte partent aussi quand un autre compte est reconnu et que le premier n'a plus rien de retenu.

## Amendements du 2026-11-23 (Lot 3)

- **Inscription fermée.** L'app n'a plus d'écran ni de lien « Créer un compte » : l'inscription est désactivée dans le projet Supabase et les comptes viennent par invitation. La garde d'arrivée n'a donc plus à couvrir l'inscription, et les passages ci-dessus qui la citent décrivent l'état d'avant. Un lien d'invitation ouvre une session sans mot de passe : l'invité est envoyé sur l'écran de mot de passe, le même que pour un lien de récupération (`auth/arrival-link`). Cette obligation est écrite sur l'appareil, par compte, dès l'arrivée, relue à chaque session restaurée et levée seulement après le succès de l'enregistrement du mot de passe : recharger l'écran avant de l'avoir défini ne fait pas entrer sans mot de passe.
- **Op enfilée sans marqueur.** Une op n'était enfilée sans compte que si le marqueur n'avait pas pu être écrit à la Connexion (stockage plein) ; elle ne partait alors jamais. Le marqueur tient désormais en mémoire quand le stockage le refuse (`lib/local-account`) : sous une session ouverte, toute op porte son compte. On ne devine toujours pas l'auteur d'une op : aucune op sans compte n'est attribuée après coup à un compte reconnu plus tard.
- **Par compte.** Les gardes comptent désormais par compte (`heldCounts`). La Déconnexion n'est retenue que par les écritures du compte qui part, et elle ne purge que ce qui est à lui (`clearOwnQueue`, `clearOwnCaptureState`), forcée ou non : les écritures et la capture d'un autre compte restent sur l'appareil pour son retour. Seul le forçage de purge (écran de connexion, garde d'arrivée) jette tout. L'écran de connexion dit à qui sont les saisies retenues : celles du compte reconnu, nommé, et celles d'un autre compte, dont l'appareil ne connaît que l'identifiant.
- **Arrivée par lien.** La garde est aussi appliquée dans l'événement d'auth (`arrivalBlockedBy`). Une session ouverte pour un autre compte que celui dont l'appareil retient des saisies n'est ni reconnue ni montrée à l'app : un écran propose de revenir à la connexion (la session arrivée est fermée sur l'appareil, rien n'est purgé) ou de forcer en deux gestes (les saisies retenues sont purgées, puis le compte entre). Le marqueur ne passe donc plus à un autre compte par-dessus des saisies en attente.
- **Limite connue de l'invitation (fin du lot 3).** La phrase « recharger l'écran avant de l'avoir défini ne fait pas entrer sans mot de passe » est vraie pour ce parcours, pas pour tous : le forçage de la garde d'arrivée sur un appareil qui retient les saisies d'un autre compte, un stockage plein à l'arrivée et le démarrage en session locale peuvent encore laisser entrer un invité sans mot de passe. L'obligation n'est tenue que sur l'appareil (docs/future-improvements.md, « Comptes »).
