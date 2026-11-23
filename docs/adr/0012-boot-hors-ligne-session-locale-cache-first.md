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

- **Autre compte.** « Un autre compte doit passer par le forçage » est maintenant tenu par le code pour la Connexion (l'inscription, d'abord gardée de la même façon, a été retirée de l'app : comptes sur invitation, ADR 0019), et les écritures en attente ne partent que sous le compte qui les a saisies (ADR 0019).
- **Purge.** Le forçage reste la seule porte par laquelle des écritures non synchronisées disparaissent. Les copies de lecture et l'état de capture, eux, partent aussi quand une session validée arrive pour un autre compte et que le précédent n'a plus aucune écriture retenue (ADR 0019).
- **Saisies refusées.** La Déconnexion est refusée tant que l'appareil retient des écritures, en file ou en quarantaine (ADR 0018).
- **Copie de lecture.** Plusieurs lectures d'une même clé peuvent être en vol : la copie n'est écrite que sous gardes d'ordre, et l'historique d'un exo est relu après tout flush qui acquitte ses séries (ADR 0020).

## Amendements du 2026-11-23 (Lot 3)

- **Ouverture d'une séance bornée.** La seule lecture sans copie du chemin d'ouverture, l'exécution du jour, est bornée à 3 s (`loadTodayExecutionWithin`) : hors ligne avec un jeton expiré elle tenait l'écran une vingtaine de secondes, et sans fin sur un wifi zombie. Un délai dépassé n'est pas une absence : sans état local, la réponse tardive est appliquée si rien n'a encore été saisi sous l'id provisoire. Avec un état local, la réponse tardive qui concerne son exécution est remise au tableau monté, qui réconcilie son réalisé par identifiant sans se remonter (ADR 0021). Sans état local, l'adoption n'a lieu que si le tableau provisoire est intact : dès que l'utilisateur a ouvert, ajouté, remplacé ou passé un exo, il garde son exécution provisoire, comme hors ligne. Toute requête du client a par ailleurs un délai maximal de 20 s (`lib/fetch-timeout`).
- **Copies périmées par une écriture locale.** Une écriture du plan faite depuis l'app marque ses copies périmées (`invalidateReads`) : la lecture suivante passe par le réseau, borné à 3 s, la copie restant le secours hors ligne.
- **Stockage plein.** Quand le stockage refuse une écriture, les copies de lecture non essentielles cèdent la place à la file et à la séance en cours ; celles du chemin d'ouverture de la Capture ne sont jamais évincées, pour qu'elle se rouvre hors ligne. Si cela ne suffit pas, les saisies tiennent en mémoire et la bannière le dit (ADR 0018).

## Amendements du 2026-11-23 (fin du lot 3)

- **Délai d'une requête.** Le délai de 20 s court jusqu'à la fin du corps de la réponse, plus seulement jusqu'à ses en-têtes : un corps bloqué laissait l'appelant attendre sans fin. La phrase « toute requête du client a un délai maximal de 20 s » ne vaut que pour une tentative : `postgrest-js` rejoue de lui-même une lecture échouée, trois fois, une lecture qui pend peut donc mettre environ 87 s à échouer. Les écritures ne sont pas rejouées.
- **Réponse tardive : les notes aussi.** La réponse tardive remise au tableau monté réconcilie son réalisé et, désormais, ses notes datées : une note que l'état local ignorait est adoptée, une note locale ou en attente d'envoi n'est pas touchée (`reconcileDatedNotes`).
- **Limites connues.** L'adoption tardive juge le tableau sur sa copie enregistrée, que le stockage plein peut avoir refusée ; une réponse tardive peut réafficher une note effacée par un autre onglet ; l'éviction ne protège pas un exo ajouté à la séance en cours. Détail et pistes dans docs/future-improvements.md, « Résiduels connus du lot 3 ».
