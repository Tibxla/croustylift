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
