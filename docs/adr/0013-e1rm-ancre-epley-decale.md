# e1RM ancré sur le réel : Epley décalé d'une rep

Un maximal réel (140 kg × 1 rep à RIR 0) rendait un e1RM de 144,7 : l'Epley classique
`poids × (1 + reps/30)` ne vaut la charge pour aucune valeur de reps, donc l'estimation
contredisait la seule perf où le 1RM est connu sans estimer quoi que ce soit. On applique
désormais `poids × (1 + (reps + rir − 1) / 30)`, qui vaut exactement la charge à une rep
effective et reste linéaire sur tout le domaine.

## Alternatives écartées

- **Brzycki** (`poids × 36 / (37 − reps_eff)`) : ancrée elle aussi, et à moins de 1 %
  d'Epley décalé sur 3–8 reps — la plage réelle d'usage. Mais le RIR gonfle les reps
  effectives (8 reps @ RIR 3 = 11) : elle décroche alors de 4 à 5 %, puis diverge vers son
  pôle à 37. La zone instable est atteignable, Epley ne l'a pas.
- **Cas spécial « 1 rep à RIR 0 → la charge »** greffé sur l'Epley classique : crée une
  discontinuité (140×1 → 140 mais 140×2 → 149,3) pour un cas que le décalage traite sans
  exception. C'est précisément ce que `e1rm.test.ts` refusait, à raison.

## Conséquences

- Le RIR reste compté **1 pour 1** comme une rep (100×5 @ RIR 2 = 100×7 @ RIR 0) : l'e1RM
  dépend donc de l'auto-évaluation autant que de la perf. Assumé — la calibration d'un même
  utilisateur est stable dans le temps, donc la pente reste lisible même si le niveau bouge.
- Rien n'est stocké (l'e1RM se calcule à la lecture) : aucune migration, mais **toutes les
  courbes historiques descendent**. Le facteur de correction `(29+n)/(30+n)` pénalise plus
  les séries courtes que les longues, avec 0,8 % d'écart maximal entre deux séries : un
  record ne peut donc changer de titulaire qu'entre deux perfs déjà à moins de 0,8 % l'une
  de l'autre.

## Amendement du 2026-11-23

**À 0 kg, la perf se juge aux reps effectives.** La formule vaut `0 × (…) = 0` pour toute série saisie sans charge. Un exo au poids du corps (tractions, dips, crunch) saisi à 0 kg ressortait donc « égalisé » quelle que soit la perf (9 reps après 12 comme 11 après 8), avec un record « e1RM 0 », une courbe plate à 0 et le message « Pas assez de séances pour la pente » sur cinq séances. La décision est de juger ces séries sur leurs **reps effectives** (`reps + RIR`), la quantité même que la formule multiplie par la charge, et de dire « reps » à l'écran, jamais « e1RM ».

Une seule règle d'ordre, pour la Référence, le Record et la meilleure série du jour (`comparePerformance`, `src/domain/e1rm.ts`) :

1. l'e1RM d'abord, exactement (ADR 0010) : toute série chargée passe devant toute série à 0 kg ;
2. entre deux séries à 0 kg, et entre elles seulement, les reps effectives départagent.

L'ordre est total et transitif, et deux séries chargées de même e1RM restent à égalité : on ne compare jamais des reps à des kilos.

En analyse, l'unité se décide **une fois par exercice**, sur tout son historique (`curveUnit`, `src/domain/primary-curve.ts`) : `reps` tant qu'aucune de ses séries n'a été chargée, `kg` dès qu'une charge apparaît. Elle vaut pour toutes les courbes de l'exercice (par séance, séries 2+, comparaison de blocs), qui se superposent et se comparent donc toujours dans la même unité. Sur une courbe en kilos, une exécution dont la première série est à 0 kg ne fait pas de point : un trou, pas un zéro, compté sous le graphe (« 2 séances à 0 kg hors courbe »). Un zéro plongerait la courbe et fausserait la pente du passage au lesté.

La courbe et le chiffre héros sont en reps effectives, mais **la pente (%/semaine) se calcule sur `29 + reps effectives`** (`weeklyProgressionRate`, `src/domain/progression.ts`). C'est exactement la pente de l'e1RM à poids du corps constant : dans `charge × (29 + reps effectives) / 30`, la charge se simplifie d'un taux relatif, quel que soit le poids de la personne. Une rep de plus pèse donc environ +2,5 %, comme sur une barre chargée, et la pente se compare aux autres cartes et au seuil de stagnation (0,5 %/sem). En pourcentage brut de reps, la même rep sur douze pesait +8 % et le seuil ne voulait plus rien dire. Le pourcentage du badge n'est donc pas celui qu'on lirait sur la courbe en reps : la carte et le panneau de comparaison l'écrivent (« %/sem en force estimée, à poids du corps constant : une rep de plus vaut environ +2,5 %. »).

### Alternatives écartées

- **Demander le poids du corps** : rendrait l'e1RM exact, lesté compris, mais ajoute une saisie et une donnée à tenir à jour pour quelques exercices. Écarté par le demandeur.
- **Un message « charge nulle » sans juger** : honnête, mais l'exercice reste sans Référence, sans record et sans courbe.
- **Une pente en pourcentage brut de reps** : fidèle à la courbe affichée, mais trois fois plus forte que celle d'un exercice chargé pour le même gain, donc incomparable d'une carte à l'autre et hors d'échelle pour le seuil de stagnation.
- **Une unité par séance ou par bloc** : une carte superposerait une courbe en reps et une courbe en kilos, et une comparaison de blocs opposerait deux pentes d'unités différentes.
- **Garder les points à zéro sur une courbe en kilos** : la pente du bloc où l'on passe au lesté devient absurde.

### Limites assumées

- Un exercice lesté garde un e1RM calculé sur le seul lest (5 kg × 8 puis 10 kg × 8 se lit « +100 % »). Seul le poids du corps le corrigerait.
- Une seule série saisie avec une charge par erreur fait basculer tout l'exercice en kilos ; la corriger dans le journal le ramène en reps.
