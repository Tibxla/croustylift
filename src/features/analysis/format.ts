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

/** Une durée de séance : « 58 min » sous l'heure, « 1 h 05 » au-delà. */
export function formatDuration(min: number): string {
  if (min < 60) return `${min} min`
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`
}

/** Un entier à la française, milliers séparés d'une espace insécable : « 3 420 ». */
export function formatInt(n: number): string {
  return Math.round(n).toLocaleString('fr-FR')
}

/**
 * 'YYYY-MM-DD' -> « mardi 17 novembre », avec l'année hors de `currentYear`
 * (« lundi 29 décembre 2025 »). Lu en heure locale, comme le jour de la séance.
 * Renvoie l'entrée telle quelle si elle est mal formée.
 */
export function formatDateLong(iso: string, currentYear: number): string {
  const date = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(date.getFullYear() === currentYear ? {} : { year: 'numeric' }),
  })
}

/** 'YYYY-MM-DD' -> « Novembre 2026 », titre d'un mois du journal. */
export function formatMonthTitle(iso: string): string {
  const date = new Date(`${iso.slice(0, 7)}-01T00:00:00`)
  if (Number.isNaN(date.getTime())) return iso
  const s = date.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// Le décompte de séries fractionnaire (« Séries loggées 5,8 ») a une seule
// définition, partagée avec la fin de séance : features/capture/format.ts.
export { formatCount } from '../capture/format'
