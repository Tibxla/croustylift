// kg soulevés : la charge totale déplacée, Σ (poids × reps) sur chaque LIGNE
// loggée. Une série unilatérale tient sur deux lignes (un côté chacune, ADR
// 0005) : les deux côtés comptent, chaque bras a bien soulevé sa charge. Le RIR
// n'entre pas dans le calcul (des reps non faites ne soulèvent rien), et une
// série au poids du corps saisie à 0 kg vaut 0.
//
// On dit « kg soulevés », jamais « volume » (GLOSSARY.md).
import type { PerformedSet } from './types'

/** kg soulevés par ces séries (les deux côtés d'une série unilatérale compris). */
export function liftedKg(sets: readonly Pick<PerformedSet, 'weightKg' | 'reps'>[]): number {
  return sets.reduce((total, set) => total + set.weightKg * set.reps, 0)
}
