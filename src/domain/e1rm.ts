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
 * La mesure entière d'une série : centièmes de kg × (29 + reps + RIR), soit
 * 3000 fois son e1RM. Deux séries ont le même e1RM si et seulement si elles ont
 * la même mesure.
 */
function e1rmUnits(weightKg: number, reps: number, rir: number): number {
  return Math.round(weightKg * 100) * (29 + reps + rir)
}

/**
 * La mesure entière d'un e1RM déjà calculé par `estimateE1rm`. Le produit par
 * 3000 retombe sur l'entier exact : l'erreur flottante (de l'ordre de 1e-9 à
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

// --- Charge nulle : la perf se juge aux reps (ADR 0013, amendement du 2026-11-23) ---
//
// Un exo au poids du corps saisi à 0 kg a un e1RM nul quelle que soit la perf :
// 0 × 12 et 0 × 8 « s'égalisaient ». À charge nulle, la mesure devient les REPS
// EFFECTIVES (reps + RIR, le RIR comptant 1 pour 1 comme dans l'e1RM).
//
// Une seule règle d'ordre pour la Référence, le Record et la meilleure série :
//   1. l'e1RM d'abord, exactement (`e1rmUnits`) : toute série chargée passe donc
//      devant toute série à 0 kg, et deux séries chargées de même e1RM restent à
//      égalité (87,5 × 5 et 85 × 6) ;
//   2. à 0 kg des deux côtés, et là seulement, les reps effectives départagent.
// L'ordre est total et transitif : on ne compare jamais des reps à des kilos.

/** Ce qu'il faut d'une série pour la juger. */
export interface Performance {
  weightKg: number
  reps: number
  rir: number
}

/** Reps effectives : les reps faites plus celles laissées en réserve. */
export function effectiveReps(reps: number, rir: number): number {
  return reps + rir
}

/** La charge est-elle nulle, au centième de kg (précision de la saisie) ? */
export function isZeroLoad(weightKg: number): boolean {
  return Math.round(weightKg * 100) === 0
}

/**
 * Ordre de deux perfs : négatif si `a` est en deçà de `b`, nul à égalité,
 * positif si `a` bat `b`. Cf. la règle ci-dessus.
 */
export function comparePerformance(a: Performance, b: Performance): number {
  const byE1rm = e1rmUnits(a.weightKg, a.reps, a.rir) - e1rmUnits(b.weightKg, b.reps, b.rir)
  if (byE1rm !== 0) return byE1rm
  if (isZeroLoad(a.weightKg) && isZeroLoad(b.weightKg)) {
    return effectiveReps(a.reps, a.rir) - effectiveReps(b.reps, b.rir)
  }
  return 0
}
