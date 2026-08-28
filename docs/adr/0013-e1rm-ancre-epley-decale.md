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
