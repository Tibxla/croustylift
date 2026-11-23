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

/**
 * e1RM arrondi à 0,01 kg, la précision à laquelle deux e1RM se COMPARENT. Deux
 * couples poids/reps différents peuvent valoir le même e1RM en rationnels
 * (87,5 × 5 et 85 × 6 : 99,1666… kg) tout en sortant deux flottants distincts à
 * un bit près ; comparés bruts, l'un « battait » l'autre.
 */
export function roundE1rm(e1rm: number): number {
  return Math.round(e1rm * 100) / 100
}

/**
 * `candidate` bat-il STRICTEMENT `best` ? Comparaison au centième : une égalité
 * mathématique n'est jamais un dépassement (Référence comme Record, ADR 0010).
 * Toute comparaison d'e1RM du dépôt passe par ici.
 */
export function e1rmBeats(candidate: number, best: number): boolean {
  return roundE1rm(candidate) > roundE1rm(best)
}
