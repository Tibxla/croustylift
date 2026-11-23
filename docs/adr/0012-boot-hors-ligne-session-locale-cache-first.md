# Boot hors-ligne : la session locale fait foi, lecture cache-first

La salle n'a pas de réseau fiable ; le boot ne doit dépendre d'aucun appel serveur. L'app tient son propre **marqueur d'identité** (posé à la Connexion, retiré à la Déconnexion) : si Supabase est injoignable au démarrage, le marqueur suffit à ouvrir la Capture — la revalidation du jeton attend le retour du réseau. Les données de Capture (routines, séances, exercices, Références/Records) sont servies **cache d'abord** depuis une copie locale étiquetée par utilisateur, rafraîchie en arrière-plan. L'attente du boot est bornée à **3 secondes** (wifi zombie : portail captif, DNS qui pend) ; au-delà, la décision est locale.

## Pourquoi

- Le login à froid hors-ligne (vérifier un mot de passe sans serveur) exigerait un vérificateur local : sur-ingénierie risquée pour un scénario qui n'existe pas. Le vrai besoin est « déjà connecté, cave sans 4G ».
- Le jeton Supabase expire en 1 h : « réseau d'abord » renvoyait l'utilisateur au login alors que sa session était toujours dans le storage. Allonger le JWT ne fait que déplacer la fenêtre.
- Le marqueur propre (plutôt que lire la clé interne `sb-*` de supabase-js) découple la garde de route des internals de la lib et distingue « jamais connecté » de « invérifiable faute de réseau ».
- « Cache d'abord » est le même compromis de fraîcheur que le last-write-wins déjà accepté (ADR 0003) ; « réseau d'abord » ferait payer un timeout à chaque écran sur réseau pourri.

## Périmètre

Capture seule (choisir sa séance, saisir avec Références, clôturer). Le journal et l'Analyse exigent le réseau — l'analyse se fait « au calme », pas en salle.

## Conséquences

- La Déconnexion est **refusée** tant que des écritures locales attendent la synchro ; un forçage explicite qui nomme la perte est la **seule porte de purge** de l'app.
- Une révocation côté serveur n'est pas une Déconnexion : elle retire la session (retour au login) mais ne purge rien. Le même compte reprend son flush à la re-Connexion ; un autre compte doit passer par le forçage.
- Une session révoquée reste ouverte localement jusqu'au retour du réseau : accepté (app perso, données non sensibles), la revalidation tourne en continu en arrière-plan.
- Le cache est semé à la Connexion (en ligne par définition) : « reconnu mais cache vide » n'existe pas, hors purge navigateur (→ inviter à repasser en ligne, pas un écran d'erreur).

## Amendements du 2026-11-23

- **Autre compte.** « Un autre compte doit passer par le forçage » est maintenant tenu par le code pour la Connexion comme pour l'inscription, et les écritures en attente ne partent que sous le compte qui les a saisies (ADR 0019).
- **Purge.** Le forçage reste la seule porte par laquelle des écritures non synchronisées disparaissent. Les copies de lecture et l'état de capture, eux, partent aussi quand une session validée arrive pour un autre compte et que le précédent n'a plus aucune écriture retenue (ADR 0019).
- **Saisies refusées.** La Déconnexion est refusée tant que l'appareil retient des écritures, en file ou en quarantaine (ADR 0018).
- **Copie de lecture.** Plusieurs lectures d'une même clé peuvent être en vol : la copie n'est écrite que sous gardes d'ordre, et l'historique d'un exo est relu après tout flush qui acquitte ses séries (ADR 0020).
