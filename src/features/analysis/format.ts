// Formatage des chiffres de l'Analyse, en français : virgule décimale et vrai
// signe moins (U+2212), comme le reste de l'app. Purs.
import { roundRate } from '../../domain/progression'

/** Le signe moins typographique, jamais le trait d'union. */
const MINUS = '\u2212'

/**
 * Une pente en %/semaine, à une décimale et signée : « +3,2 », « −1,0 », « 0,0 ».
 * L'arrondi est celui du verdict de comparaison (`roundRate`) : deux pentes qui
 * s'affichent pareil sont à égalité. Un zéro arrondi n'a pas de signe.
 */
export function formatRate(rate: number): string {
  const rounded = roundRate(rate)
  const digits = Math.abs(rounded).toFixed(1).replace('.', ',')
  if (rounded > 0) return `+${digits}`
  if (rounded < 0) return `${MINUS}${digits}`
  return digits
}

/**
 * Un décompte de séries fractionnaire (ADR 0006) : une décimale, virgule. Même
 * forme que la fin de séance (« Séries loggées 5,8 »).
 */
export function formatCount(value: number): string {
  return value.toFixed(1).replace('.', ',')
}
