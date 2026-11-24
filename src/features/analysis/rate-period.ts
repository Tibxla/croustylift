// La période de la pente d'une carte, en clair (ADR 0016, amendement du
// 2026-11-23). La pente porte sur le BLOC EN COURS : on écrit depuis quand et
// sur combien de séances, et quand elle manque on dit pourquoi au lieu de
// retomber sur tout l'historique. Purs.
import { MIN_SLOPE_POINTS } from '../../domain/progression'
import type { RatePeriod } from './data'

const DAY_FORMAT = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

/**
 * 'YYYY-MM-DD' -> « 3 nov. » (« 1ᵉʳ juin » le premier du mois), avec l'année si ce n'est pas `currentYear`
 * (« 29 déc. 2025 »). Le jour est lu ET écrit en UTC : `Date.parse` d'un jour ISO
 * vaut minuit UTC, un format en heure locale rendrait la veille à l'ouest de
 * Greenwich. Renvoie l'entrée telle quelle si elle est mal formée.
 */
export function formatDay(iso: string, currentYear: number): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return iso
  // « 1ᵉʳ juin », pas « 1 juin » : le premier du mois s'écrit en ordinal.
  return DAY_FORMAT.format(t).replace(` ${currentYear}`, '').replace(/^1 /, '1ᵉʳ ')
}

/** « aucune séance », « 1 séance », « 4 séances ». */
export function sessionsLabel(count: number): string {
  if (count === 0) return 'aucune séance'
  return count === 1 ? '1 séance' : `${count} séances`
}

/** « bloc en cours depuis le 3 nov. », ou « tout l'historique » sans bloc. */
export function periodLabel(period: RatePeriod, currentYear: number): string {
  return period.since === null
    ? 'tout l’historique'
    : `bloc en cours depuis le ${formatDay(period.since, currentYear)}`
}

/**
 * La ligne sous le graphe : la période de la pente et son nombre de séances
 * (« Pente : bloc en cours depuis le 3 nov. · 4 séances »). Sans pente, la même
 * période et ce qui manque, selon le critère même de `weeklyProgressionRate`
 * (trois points, à trois jours distincts).
 */
export function rateCaption(
  period: RatePeriod,
  hasRate: boolean,
  currentYear: number,
): string {
  const scope = `${periodLabel(period, currentYear)} · ${sessionsLabel(period.sessions)}`
  return hasRate
    ? `Pente : ${scope}`
    : `Pas de pente : ${scope}, il en faut ${MIN_SLOPE_POINTS} à des jours différents.`
}
