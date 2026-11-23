// Axe X en TEMPS RÉEL des graphes de l'Analyse. Un axe catégoriel pose un pas
// par séance quel que soit l'écart de dates : huit semaines de pause y occupent
// la largeur d'une semaine, et la pente lue à l'œil est fausse. Sur un axe
// numérique, une pause se voit. Purs.
import type { E1rmPoint } from '../../domain/types'

const DAY_MS = 24 * 60 * 60 * 1000

/** Demi-largeur donnée à un graphe d'un seul jour, pour centrer son point. */
const SINGLE_DAY_PADDING_DAYS = 3

/** Nombre maximal de graduations : cinq dates « JJ/MM » tiennent à 320 px. */
const MAX_TICKS = 5

/**
 * 'YYYY-MM-DD' -> abscisse en ms. `Date.parse` lit minuit UTC : l'écart entre
 * deux jours est donc exact, sans heure d'été, et le libellé se relit en UTC.
 */
export function dayToTime(iso: string): number {
  return Date.parse(iso)
}

/**
 * 'YYYY-MM-DD' -> 'JJ/MM' (mono, court : un axe X ne doit jamais déborder).
 * Renvoie l'entrée telle quelle si elle est mal formée. Seule définition pour
 * les axes, les infobulles et le libellé d'un bloc.
 */
export function shortDay(iso: string): string {
  const [, month, day] = iso.split('-')
  if (!month || !day) return iso
  return `${day}/${month}`
}

/** Graduation d'un axe temps : abscisse en ms -> 'JJ/MM'. */
export function timeTick(t: number): string {
  return shortDay(timeToDay(t))
}

/** L'abscisse d'un axe temps -> 'YYYY-MM-DD' (inverse de `dayToTime`). */
export function timeToDay(t: number): string {
  return new Date(t).toISOString().slice(0, 10)
}

export interface TimeAxis {
  /** Bornes de l'axe, en ms. */
  domain: [number, number]
  /** Graduations, toutes sur un jour entier, premier et dernier jour compris. */
  ticks: number[]
}

/**
 * L'axe temps commun à plusieurs courbes (elles se superposent, ou s'alignent
 * l'une sous l'autre). `null` sans aucun point. Un seul jour : l'axe s'ouvre
 * autour de lui pour que le point ne colle pas au bord.
 */
export function timeAxis(curves: readonly E1rmPoint[][]): TimeAxis | null {
  const times = curves.flatMap((curve) => curve.map((p) => dayToTime(p.date)))
  if (times.length === 0) return null
  const min = Math.min(...times)
  const max = Math.max(...times)
  if (min === max) {
    const pad = SINGLE_DAY_PADDING_DAYS * DAY_MS
    return { domain: [min - pad, max + pad], ticks: [min] }
  }
  const days = Math.round((max - min) / DAY_MS)
  const count = Math.min(MAX_TICKS, days + 1)
  const ticks = Array.from(
    { length: count },
    (_, i) => min + Math.round((i * days) / (count - 1)) * DAY_MS,
  )
  return { domain: [min, max], ticks }
}
