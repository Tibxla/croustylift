# Un registre unique des écritures de l'appareil, lu par estampille

Tout ce que l'appareil a écrit et que la base n'a pas encore, ou vient juste de recevoir, tient dans **un seul enregistrement local**, écrit d'un coup. Chaque écriture y porte un **numéro** croissant, son **sort** (en attente, refusée, acquittée récente) et sa **parenté**, posée à l'enfilement. La file et la quarantaine, deux clés écrites l'une après l'autre, n'existent plus (amende l'ADR 0018).

Qui lit des séries (le tableau de la Salle au montage, la réponse tardive de la base, la Référence) applique **une seule règle** : une lecture, puis chaque écriture locale que cette lecture ne contient pas, colonne par colonne (amende l'ADR 0003). Une lecture porte pour cela l'**estampille** du registre, relevée à son départ.

## Ce qui est décidé

- **Stockage.** `localStorage`, une clé (`croustylift:registre`), format `{ v: 1, seq, entries }`. Chaque transition est une lecture-modification-écriture synchrone de l'enregistrement entier : il n'existe pas d'état intermédiaire où une écriture serait à deux endroits, ou nulle part.
- **Verrou.** L'enregistrement n'est réécrit que sous le verrou du navigateur (`navigator.locks`, même nom qu'avant : un onglet resté sur l'ancienne version l'attend aussi) : passe d'envoi, renvoi, abandon, reprise de l'ancien format. Aucune lecture-modification-écriture n'a lieu hors de lui. La passe relit l'enregistrement avant chacune de ses écritures.
- **Boîte d'entrée.** L'enfilement n'attend jamais le verrou : une passe le tient le temps de ses requêtes, et une série doit être durable dès le geste. Chaque geste écrit donc ses écritures, d'un coup, dans une clé à lui (`croustylift:registre:in:<id>`), que personne d'autre ne réécrit. Le registre les fait entrer sous le verrou, au début de chaque passe et à chaque renvoi ou abandon, puis efface la clé ; d'ici là toute lecture les voit déjà, avec le numéro pris à l'enfilement. Les gestes synchrones qui retirent des écritures (« Annuler la séance », Déconnexion, conversion de démarrage) valent tout de suite pour la page et sont écrits sous le verrou au tour suivant.
- **Numéro.** Pris à chaque enfilement et à chaque acquittement, par `max(dernier + 1, horloge)`. Il croît même si l'horloge recule, et ne repart pas de zéro après une purge ou un enregistrement illisible.
- **Sort.** En attente, refusée (rejet définitif de la base, ADR 0018), acquittée récente. « Retenue » n'est pas stocké : une écriture l'est tant que la création de son exécution est refusée, ce qui se lit dans sa parenté.
- **Parenté.** Une écriture qui a besoin de son exécution pointe sa création ; une écriture partielle pointe l'insertion de sa série. Trois règles en découlent, à un seul endroit (`registry-record.ts`) : une écriture retenue n'est pas envoyée ; une correction dont l'insertion est refusée part comme la série entière ; abandonner une écriture emporte ce qui en dépend.
- **Lignée d'une série.** Une suppression enfilée efface les anciens refus de la même série ; une écriture refusée alors qu'une réécriture ou une suppression la suit n'est pas gardée ; une écriture acquittée efface les anciens refus (pour une écriture partielle : sur les colonnes qu'elle vient d'écrire). L'écriture écartée laisse son identité à sa remplaçante : son sort se lit encore.
- **Renvoyer** remet une saisie refusée en attente à sa place d'origine, pas en fin de liste. Une correction ou une suppression plus récente de la même série passe donc toujours après elle.
- **Estampille.** Le numéro du registre au départ d'une lecture. À l'arrivée, on applique les écritures en attente, les refusées, et celles **acquittées après** l'estampille. La comparaison porte sur l'acquittement, pas sur l'enfilement : une écriture enfilée avant le départ et acquittée après n'est pas dans la réponse.
- **Rétention.** Une écriture acquittée reste dix minutes au registre, cinq cents au plus. Sur un appareil plein, elles cèdent la place en premier. Passé ce délai elle n'est plus appliquée à aucune lecture, même si rien ne l'a encore retirée.
- **Version.** Un enregistrement de version supérieure arrête tout envoi, n'est jamais modifié, et la ligne de synchro demande de recharger.
- **Ancien format.** À la première ouverture, la file et la quarantaine sont converties : le registre est écrit, puis les anciennes clés effacées. Si l'app s'arrête entre les deux, le registre fait foi et rien n'entre deux fois (identité d'enfilement). Tant qu'un onglet de l'ancienne version peut encore écrire dans ces clés, leur contenu est repris au début de chaque passe, sous le verrou. L'ancienne file garde en tête une écriture d'un type que l'ancienne version ne sait pas jouer, une par compte que l'appareil a reconnu (complétée à chaque passe, donc dès celle qui suit une connexion) : sa passe s'arrête dessus, elle n'envoie plus rien elle-même, et ce qu'elle enfile part d'ici, à sa place dans l'ordre. Son écriture dans l'ancienne clé réveille la passe de l'onglet à jour (événement `storage`). Sous stockage plein, ce verrou est posé en tête sans rien retirer. Sans cela elle pouvait envoyer une correction récente avant qu'une plus ancienne ne parte du registre. Sous stockage plein, les anciennes clés ne sont pas vidées tant que le registre n'est pas écrit en entier : elles ne perdent que ce qui est réglé. Ce code est à retirer après le 2026-12-31.

## Pourquoi

Les résiduels du moteur de la Salle (relectures des 24 et 25/11) tenaient tous à la même jonction. Sept endroits recalculaient « qui dépend de qui », jusque dans la feuille des saisies refusées, qui cherchait un identifiant dans le texte d'un motif. La quarantaine bougeait en deux écritures, hors du verrou : un stockage plein entre les deux rendait renvoyable une insertion dont la suppression venait d'être acquittée. Et quatre fonctions interprétaient les mêmes écritures, composées de deux façons différentes selon qu'on montait le tableau ou qu'une réponse arrivait en retard, avec un paramètre de course ajouté à chaque bug (file relevée avant et après la lecture, état local du départ, suivi des gestes faits pendant le trajet).

Un seul enregistrement rend les transitions atomiques sans transaction. Le sort gardé avec l'écriture permet au flush de dire ce qu'il a fait au lieu de le laisser deviner. Et les écritures acquittées gardées un moment remplacent tous les paramètres de course par une question : cette lecture est-elle partie avant ou après l'acquittement ?

L'estampille se compare à l'acquittement parce que c'est lui qui dit si la base portait l'écriture quand la lecture est partie. La rétention est un temps, pas « jusqu'à la fin des lectures en vol » : un onglet ne connaît pas les lectures d'un autre, alors qu'une requête est bornée à vingt secondes.

Le numéro suit l'horloge pour deux raisons. Une estampille gardée avec une copie de lecture ou un état de séance survit à une purge du registre : un compteur reparti de zéro passerait dessous, et des écritures acquittées seraient tenues pour déjà lues. Et l'instant d'enfilement de l'ancien format est comparable à ce numéro : une écriture reprise d'un ancien onglet prend sa place dans l'ordre d'envoi, avant la correction faite ensuite ailleurs.

## Alternatives écartées

- **IndexedDB.** Ses transactions sont réelles, mais asynchrones : une série ne serait plus durable au retour du geste, et tous les lecteurs synchrones (ligne de synchro, gardes de compte, montage du tableau) changeraient de forme. L'enregistrement unique donne l'atomicité qui manquait sans cela.
- **Garder deux clés et écrire sous le verrou.** Le verrou ordonne les onglets, il ne rend pas deux écritures atomiques face à un stockage plein ou à une app tuée.
- **Estampiller par numéro d'enfilement.** Simple, et faux : une écriture enfilée avant le départ d'une lecture, encore en attente, serait tenue pour lue.
- **Mettre l'enfilement sous le verrou.** La passe tient le verrou le temps de ses requêtes : une série attendrait la fin d'un envoi pour être durable.
- **Laisser l'enfilement réécrire l'enregistrement** (première version de cet ADR). `localStorage` n'a pas de verrou entre onglets : un acquittement fait au même instant dans un autre onglet réécrivait un brouillon d'avant la saisie, qui disparaissait sans avoir été envoyée. La boîte d'entrée ferme ce cas sans changer de stockage.
- **Stocker « retenue » comme un sort.** Il faudrait le défaire à chaque renvoi, abandon ou réaffirmation réussie de l'exécution. Déduit de la parenté, il est juste par construction.
- **Bloquer l'abandon d'un refus dont dépend une correction.** L'utilisateur resterait devant une saisie qu'il ne peut ni renvoyer ni retirer. La correction part avec, et la confirmation le dit.

## Conséquences

- La feuille des saisies refusées ne fait qu'afficher : qui retient une saisie et ce qui partira avec elle viennent du registre (`heldBy`, `dependents`). Les messages « une suppression attend déjà », « une correction attend déjà » et « stockage plein » d'un renvoi sans effet disparaissent avec les cas qu'ils décrivaient.
- Une saisie retenue par sa séance repart seule quand sa séance est recréée avec succès. Avant, elle restait en quarantaine, ni renvoyable ni utile.
- Une série dont l'insertion est refusée reste au tableau de la Salle, d'où elle peut être corrigée ou supprimée. Avant, elle le quittait à la reprise suivante.
- Une clôture ou une suppression d'exécution refusée ne retire pas l'exécution : elle attend un geste dans la feuille.
- `flush` rend le sort de chaque écriture traitée. La relecture des copies d'historique (ADR 0020) et le résultat rendu à l'éditeur de séance passée s'en servent.
- Sous une version inconnue, ce qui est saisi ne tient qu'en mémoire et n'empêche pas le rechargement, puisque recharger est la seule issue : la ligne de synchro le dit.
- La fusion « la liste la plus longue gagne » entre l'état local et la base n'existe plus. Sans réponse de la base, l'état gardé par l'appareil tient lieu de lecture, avec l'estampille de son enregistrement.

## Limites connues

- Un geste synchrone qui RETIRE des écritures (« Annuler la séance », Déconnexion) n'est écrit sur l'appareil qu'au tour suivant, sous le verrou. Page fermée dans cet intervalle, ces écritures reviennent ; la suppression de l'exécution, enfilée dans la foulée, part alors après elles. Le forçage de purge, lui, n'attend pas : il ne relit rien pour le garder.
- Stockage plein : ce qui ne tient qu'en mémoire est perdu si la page se ferme. L'enregistrement resté sur l'appareil est en retard d'un seul tenant, et ce qui y attend encore repart sans effet.
- Une écriture acquittée, réappliquée parce que son onglet avait une vue en retard, peut masquer dix minutes une correction faite depuis sur un autre appareil. Rien n'est écrit en base.
- Passé dix minutes, c'est la relecture après acquittement (ADR 0020) qui tient la Référence à jour, pas le registre.
- Abandonner une série refusée la retire du registre, pas du tableau déjà affiché ni de l'état gardé par l'appareil : hors ligne, elle peut y rester jusqu'à la prochaine réponse de la base.
