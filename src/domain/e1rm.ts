// e1RM : Epley DÉCALÉ d'une rep (ADR 0013).
//
// L'Epley classique `w * (1 + reps/30)` ne vaut la charge pour aucune valeur de
// reps : un maximal réel (140x1 à RIR 0) rendait 144,7 — l'estimation contredisait
// la seule perf où le 1RM est connu sans estimer. Le `- 1` ancre la formule sur ce
// point : à UNE rep effective, l'estimation vaut exactement la charge.
//
// Le RIR compte 1 pour 1 comme une rep (100x5 @ RIR 2 == 100x7 @ RIR 0) : l'e1RM
// dépend donc de l'auto-évaluation autant que de la perf. Assumé — la calibration
// d'un même utilisateur est stable, donc la PENTE reste lisible (ADR 0013).
export function estimateE1rm(weightKg: number, reps: number, rir: number): number {
  if (weightKg < 0) {
    throw new Error(`weightKg must not be negative, received ${weightKg}`)
  }
  if (!Number.isInteger(reps)) {
    throw new Error(`reps must be an integer, received ${reps}`)
  }
  if (reps < 1) {
    throw new Error(`reps must be at least 1, received ${reps}`)
  }
  if (!Number.isInteger(rir)) {
    throw new Error(`rir must be an integer, received ${rir}`)
  }
  if (rir < 0) {
    throw new Error(`rir must not be negative, received ${rir}`)
  }
  return weightKg * (1 + (reps + rir - 1) / 30)
}

// --- Comparaison EXACTE de deux e1RM -------------------------------------------
//
// e1RM = poids × (29 + reps + RIR) / 30. Avec le poids en centièmes de kg, la
// quantité `centièmes × (29 + reps + RIR)` est un ENTIER, et deux e1RM se
// comparent en comparant ces entiers : ni flottant, ni arrondi.
//
// À ne pas refaire :
//   - comparer les flottants bruts : 87,5 × 5 et 85 × 6 valent le même e1RM
//     (99,1666… kg) mais deux flottants distincts à un bit près, et le second
//     « battait » le premier ;
//   - arrondir au centième avant de comparer : 28,75 × 9 (36,4166…) et
//     23,25 × 18 (36,425) retombaient sur 36,42, et un vrai record disparaissait.
// L'arrondi reste l'affaire de l'affichage, jamais de la comparaison.

/**
 * La mesure entière d'un e1RM déjà calculé par `estimateE1rm` : centièmes de
 * kg × (29 + reps + RIR), soit 3000 fois l'e1RM. Deux séries ont le même e1RM
 * si et seulement si elles ont la même mesure. Le produit par 3000 retombe sur
 * l'entier exact : l'erreur flottante (de l'ordre de 1e-9 à
 * cette échelle) est très loin du demi qu'il faudrait pour changer d'entier.
 * Ce n'est pas un arrondi de la valeur, c'est la relecture de l'entier d'origine.
 */
function unitsOf(e1rm: number): number {
  return Math.round(e1rm * 3000)
}

/**
 * `candidate` bat-il STRICTEMENT `best` ? Comparaison exacte : une égalité
 * mathématique n'est jamais un dépassement, et un dépassement réel, même sous le
 * centième de kg, en est un (Référence comme Record, ADR 0010). Les deux
 * arguments sont des e1RM rendus par `estimateE1rm`.
 */
export function e1rmBeats(candidate: number, best: number): boolean {
  return unitsOf(candidate) > unitsOf(best)
}

/** Deux e1RM rendus par `estimateE1rm` sont-ils mathématiquement égaux ? */
export function e1rmEquals(a: number, b: number): boolean {
  return unitsOf(a) === unitsOf(b)
}
