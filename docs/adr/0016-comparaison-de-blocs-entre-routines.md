# Comparaison de blocs entre routines : chaque bloc lu dans une seule séance

Sur la carte d'un exercice, la comparaison porte sur deux options choisies librement, chacune un couple **bloc + séance** : deux blocs de routines différentes, deux blocs de la même routine, ou deux séances d'un même bloc. Chaque pente se calcule sur les exécutions d'une seule séance pendant un seul bloc. Cet ADR revient sur la portée fixée par l'issue #67, où la comparaison suivait la séance en accent de la carte.

## Pourquoi

Le but produit est de comparer des routines, volume et fréquence ensemble (`brainstorm-intent.md`). Scopée à la séance en accent, la comparaison devenait impossible au premier changement de routine : une séance appartient à une seule routine, les blocs d'avant n'avaient aucun point dans la nouvelle séance et sortaient du menu. Même la comparaison des variantes de l'ancienne séance devenait inaccessible dès qu'une séance de la nouvelle routine prenait l'accent.

La fréquence se règle au niveau de la routine. Aucune édition sur place ne la teste.

L'argument de fatigue de #67 interdit de mêler deux séances dans une même pente. Il n'interdit pas de comparer deux pentes lues chacune dans sa séance. On compare des vitesses de progression en %/semaine, pas des niveaux : qu'une séance parte plus haut qu'une autre ne fausse rien. Deux séances d'un même bloc se comparent pour la même raison : même période, même configuration, deux contextes, et rien ne se mélange.

## Alternatives écartées

- **Garder la portée séance en accent et corriger la spec** : plus aucune réponse à « cette routine me fait-elle progresser plus vite ? », et la fréquence n'est jamais testable.
- **Un menu bloc puis un menu séance** : double les réglages d'un panneau qu'on ouvre rarement.
- **Règle automatique** (la séance où l'exercice revient le plus dans le bloc) : une pente dont on ne sait pas d'où elle vient.
- **L'exercice toutes séances confondues dans chaque bloc** : le mélange que #67 a supprimé.
- **Plus de deux options superposées** : illisible sur téléphone, et plus de verdict à rendre.

## Conséquences

- Une option se lit « séance · routine · début · fin ». Les deux menus ne tiennent plus côte à côte à 400 px : ils s'empilent.
- Comparer deux routines reste une lecture de pentes, pas une preuve : séances, ordre, fréquence et période de l'année changent ensemble. Tester une variante précise passe toujours par l'édition sur place (ADR 0001, ADR 0015).
- Le nom d'une séance est unique dans sa routine et celui d'une routine unique dans le compte, archivées comprises (ADR 0017), casse et espaces en trop ignorés, pour que « séance · routine » désigne une seule séance. La contrainte se pose sans reprise de données : aucun doublon en base au 2026-09-13.
- La séance en accent pilote toujours le chiffre héros, la pente et « Séries 2+ » de la carte, mais ne décide plus de la comparaison. La légende des courbes permet de masquer des séances ; l'accent revient à la plus récente des séances affichées.
- L'argument de l'ADR 0015 contre la duplication de routine (« sans comparaison possible ») ne tient plus. L'interdiction reste, pour d'autres raisons, réécrites dans l'ADR 0015.

## Amendement du 2026-11-23

**La pente de la carte porte sur le bloc en cours.** « La séance en accent pilote toujours le chiffre héros, la pente et "Séries 2+" de la carte » reste vrai, mais la pente se calculait sur tout l'historique de cette séance. Le chiffre le plus visible de l'écran ne suivait donc pas l'unité de comparaison du produit : vingt semaines à plat puis six semaines d'un nouveau plan à +2 kg par semaine s'affichaient « +0,3 %/sem, stagnation », et une reprise après huit semaines de pause s'affichait en régression. La pente de la carte est désormais celle d'une option de comparaison comme les autres : **la séance en accent, lue dans le bloc en cours**.

- Le bloc en cours est celui du glossaire et de l'ADR 0001 (`detectBlocks`, bloc dont la fin est ouverte), pas une période propre à la séance. Les exécutions y sont rattachées par leur instant de lancement, avec la même fonction que la comparaison (`executionsInBlock`) : on filtre les exécutions, jamais les points d'une courbe par date.
- La période est écrite sous le graphe : « Pente : bloc en cours depuis le 3 nov. · 4 séances ». Quand des points précèdent le bloc, un trait vertical marque son début sur la courbe.
- Un bloc trop court n'a pas de pente, et la carte dit ce qui manque avec le critère même du calcul (trois séances, sur trois jours distincts) : « Pas de pente : bloc en cours depuis le 3 nov. · 2 séances, il en faut 3 à des jours différents. » Jamais de repli sur tout l'historique, qui rendrait le chiffre ininterprétable.
- Seule exception : un compte sans aucun bloc (ni routine activée ni séance rattachée à une routine). La pente couvre alors tout l'historique, et la carte l'écrit.
- La courbe garde tout l'historique de la séance. Son axe horizontal est en temps réel pour une courbe seule comme pour une superposition : l'axe catégoriel d'origine posait un pas par séance, et huit semaines de pause y occupaient la largeur d'une semaine. Le graphe des séries 2+ partage le même axe.

### Alternatives écartées

- **Les N dernières semaines** : une fenêtre glissante mêle deux plans dès qu'un changement tombe dedans, et ne correspond à aucune option de la comparaison.
- **Une période par séance** (depuis la dernière retouche de cette séance seulement) : plus stable pour les cartes des séances non retouchées, mais ce serait une seconde définition du bloc, et la pente de la carte ne correspondrait plus à celle que le panneau de comparaison affiche pour la même période.
- **Garder la pente longue en second plan** : deux pourcentages sur une carte, dont un que le produit ne sait pas interpréter.

### Conséquence assumée

Toute retouche de la routine courante ouvre un bloc pour toutes ses séances (ADR 0001) : après une édition, chaque carte de la routine reste sans pente le temps de refaire trois séances. C'est le prix d'une seule définition du bloc.
