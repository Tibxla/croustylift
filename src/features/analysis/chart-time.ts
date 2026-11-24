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

/**
 * L'axe temps d'une carte : celui de ses courbes AFFICHÉES (l'accent en tête) et
 * du graphe des séries 2+ de l'accent, dessiné dessous. Le secondaire compte : une
 * séance dont la 1ʳᵉ série est à 0 kg et la 2ᵉ lestée n'a de point que chez lui,
 * et un axe borné aux seules primaires laissait Recharts élargir le sien, la même
 * date tombant alors à deux abscisses.
 */
export function cardTimeAxis(
  shown: readonly { curve: E1rmPoint[]; secondaryCurve: E1rmPoint[] }[],
): TimeAxis | null {
  return timeAxis([...shown.map((sc) => sc.curve), shown[0]?.secondaryCurve ?? []])
}

/**
 * Le dernier point d'une courbe bat-il le précédent ? C'est le seul point que
 * le signal marque (« mieux que la dernière fois »), sur le graphe comme dans le
 * relevé de la page d'un exo.
 */
export function lastBeatsPrevious(curve: readonly E1rmPoint[]): boolean {
  const n = curve.length
  return n > 1 && curve[n - 1]!.e1rm > curve[n - 2]!.e1rm
}

const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']

/**
 * Graduations au 1er du mois dans `domain` (en ms), un mois sur 1, 2, 3, 6 ou
 * 12 : le plus petit pas qui tient en `maxTicks` étiquettes. Libellé : le mois
 * court (« juin », « juil. ») ; au passage d'une année, l'année seule (« 2027 »).
 * Moins de deux graduations : `[]`, l'appelant garde ses dates.
 */
export function monthTicks(domain: readonly [number, number], maxTicks: number): { x: number; label: string }[] {
  const [from, to] = domain
  if (!(to > from) || maxTicks < 2) return []
  const start = new Date(from)
  // Premier 1er du mois dans le domaine (le jour même s'il tombe un 1er).
  let y = start.getUTCFullYear()
  let m = start.getUTCMonth() + (start.getUTCDate() === 1 && start.getUTCHours() === 0 ? 0 : 1)
  const firsts: number[] = []
  for (;;) {
    y += Math.floor(m / 12)
    m %= 12
    const t = Date.UTC(y, m, 1)
    if (t > to) break
    firsts.push(t)
    m += 1
  }
  for (const step of [1, 2, 3, 6, 12]) {
    // Pas de 2, 3, 6 ou 12 : calé sur les mois qui divisent l'année (janv., mars…).
    const kept = firsts.filter((t) => new Date(t).getUTCMonth() % step === 0)
    if (kept.length <= maxTicks) {
      if (kept.length < 2) return []
      return kept.map((t, i) => {
        const d = new Date(t)
        const prev = i > 0 ? new Date(kept[i - 1]!).getUTCFullYear() : d.getUTCFullYear()
        return { x: t, label: i > 0 && d.getUTCFullYear() !== prev ? String(d.getUTCFullYear()) : MONTHS_SHORT[d.getUTCMonth()]! }
      })
    }
  }
  return []
}
