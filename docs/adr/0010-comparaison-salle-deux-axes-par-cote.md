# Comparaison en salle : deux axes, trois états, par côté en unilatéral

En Capture, une série loggée se compare sur **deux axes distincts**, jamais confondus :

- **Référence** (« dernière fois ») — la même position de série lors de la dernière exécution. Juge = **e1RM**, seuils **stricts** : e1RM strictement supérieur → **battu** ; e1RM strictement égal → **égalisé** ; inférieur → rien.
- **Record personnel** (all-time) — le meilleur e1RM (1ʳᵉ série de chaque exécution) et la charge la plus lourde, tous jours confondus.

Un seul badge par ligne, hiérarchie **Record > battu > égalisé**.

Sur un exo **unilatéral**, ces deux axes sont rétablis **par côté** : chaque ligne (gauche, droite) se compare à l'historique **de ce côté** — sa propre « dernière fois » et son propre record. La convention **côté faible** reste réservée à l'**analyse** (courbe e1RM, ADR 0005). Un Record sur le bras fort en salle peut donc ne pas faire bouger la courbe d'analyse.

## Pourquoi

- **Deux questions différentes.** « Ai-je fait mieux qu'à la dernière séance ? » (Référence, par position) et « est-ce mon meilleur de tous les temps ? » (Record) sont deux lectures distinctes. Les mélanger (un Record masquant un « battu », un `>=` traitant une égalité comme un dépassement) brouillait le signal : l'utilisateur voyait « battu » sans y croire.
- **e1RM comme juge unique de battu/égalisé.** C'est la seule mesure qui plie poids + reps + RIR en un nombre comparable et monotone — la même qui pilote la courbe. « Plus lourd » seul casserait dès qu'on monte les reps à charge égale ; l'axe charge n'est pas perdu pour autant, il vit dans le Record.
- **Par côté en salle = ce qu'on fait vraiment.** On pousse chaque bras contre son propre historique. Afficher un repère et un verdict par côté est plus actionnable qu'un verdict unique au côté faible, et cohérent avec « une série tient sur deux lignes, valeurs par côté » (ADR 0005). L'ADR 0005 avait écarté la comparaison par côté **du périmètre initial** (issue #46) ; cet ADR la rétablit, pour le repère et les badges de Capture uniquement.

## Alternatives écartées

- **Un seul axe à l'écran** (juste le Record, ou juste « dernière fois ») : perd l'autre lecture. L'utilisateur veut les deux, distinctement.
- **`>=` pour « battu »** (comportement d'origine) : compte une égalité comme un dépassement, d'où la défiance (« marqué battu mais pas sûr »). Trois états stricts lèvent l'ambiguïté.
- **Comparaison au côté faible seul en unilatéral** (cohérent analyse) : le badge n'apparaît qu'une fois les deux côtés saisis et ne « tient » sur aucune ligne franche. UX bancale ; on garde le côté faible pour l'analyse, pas pour le repère de salle.
- **« Plus lourd » comme juge de battu** : casse dès qu'on troque charge contre reps. La charge reste portée par le Record de charge.

## Conséquences

- Le Record personnel se calcule **par côté** pour la Capture (un best e1RM et un best charge pour le gauche, idem pour le droit), en plus du record côté faible que l'analyse continue d'utiliser. Deux lentilles assumées : célébration par bras en salle, progression au côté faible en analyse.
- La Référence (« dernière fois ») se résout **par (position, côté)** en unilatéral : le repère affiché suit le côté choisi au sélecteur.
- Le mini-récap de fin d'exo distingue toujours les deux axes (« battues/égalisées » d'un côté, « Record » de l'autre) et résume **par côté** en unilatéral.
- L'ADR 0005 reste la référence pour le stockage (deux lignes par série, même `set_order`) et pour la convention **côté faible en analyse** — seul son périmètre « pas de comparaison par côté » est amendé ici, et uniquement pour la Capture.

## Amendements du 2026-11-23

- **Record e1RM : toutes les séries, pas seulement la première.** Le texte ci-dessus dit que le meilleur e1RM est pris sur la « 1ʳᵉ série de chaque exécution ». Ce n'est plus la règle : le Record personnel e1RM est pris sur **toutes les séries** de chaque exécution, quel que soit leur rang, et par côté en unilatéral (`src/domain/pr.ts`, GLOSSARY.md, « Record personnel »). Un record est une performance démontrée : une deuxième série meilleure que la première compte. La restriction à la 1ʳᵉ série ne vaut que pour la courbe e1RM de l'Analyse, où elle garantit la comparabilité d'un jour à l'autre (`src/domain/primary-curve.ts`).
- **« Strict » se lit exactement, charges au centième de kg.** Les seuils « strictement supérieur » et « strictement égal » ne comparent ni des flottants ni des e1RM arrondis : la charge est lue au centième de kg, et la comparaison porte sur l'entier `centièmes de kg × (29 + reps + RIR)`, qui vaut 3000 fois l'e1RM. Deux couples poids/reps différents de même e1RM (87,5 × 5 et 85 × 6) sont donc égalisés, jamais battus, et un dépassement réel est battu même s'il tient sous le centième de kg d'e1RM. Une seule paire de fonctions porte la règle, pour la Référence comme pour le Record : `e1rmBeats` et `e1rmEquals` (`src/domain/e1rm.ts`). L'arrondi reste l'affaire de l'affichage.
- **À 0 kg, le juge est les reps effectives.** « e1RM comme juge unique » ne tient pas pour une série saisie sans charge, dont l'e1RM est nul : deux séries à 0 kg se comparent sur `reps + RIR`, pour la Référence comme pour le Record, et l'écran dit « reps ». Règle et alternatives : ADR 0013, amendement du 2026-11-23.

## Amendement du 2026-11-25

- **Le brouillon se situe en direct, avant le log, sur les deux axes.** Sous « Dernière fois » (la Référence du même rang et du même côté) et sous « Record » (le record e1RM **courant** : l'historique du côté visé, avancé par les séries du jour ; au premier passage, aucun, comme les badges, qui n'en donnent pas la première fois), l'instrument de la Salle dit où se tient la série qu'on règle : « ▲ +3,2 au-dessus », « ▬ à égalité » ou « ▼ −6,3 en dessous ». Même juge que les badges, `comparePerformance` : e1RM exact, seuils stricts, reps effectives à 0 kg des deux côtés. L'écart est signé dans la mesure du juge ; il ne s'écrit pas à égalité, quand il s'arrondit à zéro sans l'être, ni entre une série chargée et une série à 0 kg (`draftScore`, `src/features/capture/draft-score.ts`).
- **▲ au signal, par choix de l'utilisateur.** Jusqu'ici, la mesure du brouillon était un chiffre seul, sans signe ni couleur, parce qu'un ▲ qui s'allume à +1 de RIR peut pousser à gonfler l'auto-évaluation, donc à fausser les pentes d'analyse (le RIR compte comme des reps, ADR 0013). L'utilisateur a choisi le ▲ au signal en connaissance de ce risque, sur prototype (variante A4 de la saisie : « je préfère le jaune »). ▬ reste en blanc cassé, ▼ en gris.
- **« battue », « égalée » et « record » restent réservés aux séries faites.** Le brouillon reçoit des mots de position, jamais un verdict ; les badges, le bilan de l'exo et le récap ne changent pas. Les deux axes restent distincts à l'écran : deux colonnes, deux indicateurs.
- Alternative écartée : le ▲ du brouillon en blanc cassé (sobre), proposée sur le même prototype ; l'utilisateur a préféré le signal.
