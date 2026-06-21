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
