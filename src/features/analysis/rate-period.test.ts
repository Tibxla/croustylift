import { describe, expect, it } from 'vitest'
import { formatDay, periodLabel, rateCaption } from './rate-period'

describe('formatDay', () => {
  it('jour et mois abrégé, sans zéro, sans année dans l’année en cours', () => {
    expect(formatDay('2026-11-03', 2026)).toBe('3 nov.')
    expect(formatDay('2026-05-17', 2026)).toBe('17 mai')
    expect(formatDay('2026-03-01', 2026)).toBe('1 mars')
  })

  it('l’année s’écrit quand ce n’est pas la courante', () => {
    expect(formatDay('2025-12-29', 2026)).toBe('29 déc. 2025')
  })

  it('une date mal formée ressort telle quelle', () => {
    expect(formatDay('hier', 2026)).toBe('hier')
    expect(formatDay('2026-13-01', 2026)).toBe('2026-13-01')
  })
})

describe('periodLabel', () => {
  it('nomme le bloc en cours et son début', () => {
    expect(periodLabel({ since: '2026-11-03', sessions: 4 }, 2026)).toBe(
      'bloc en cours depuis le 3 nov.',
    )
  })

  it('sans bloc, dit que la pente couvre tout l’historique', () => {
    expect(periodLabel({ since: null, sessions: 4 }, 2026)).toBe('tout l’historique')
  })
})

describe('rateCaption', () => {
  const since = '2026-11-03'

  it('avec une pente : la période et le nombre de séances', () => {
    expect(rateCaption({ since, sessions: 4 }, true, 2026)).toBe(
      'Pente : bloc en cours depuis le 3 nov. · 4 séances',
    )
  })

  it('bloc trop court : on le dit, avec ce qu’il faut, sans retomber sur l’historique', () => {
    expect(rateCaption({ since, sessions: 2 }, false, 2026)).toBe(
      'Pas de pente : bloc en cours depuis le 3 nov. · 2 séances, il en faut 3 à des jours différents.',
    )
    expect(rateCaption({ since, sessions: 1 }, false, 2026)).toBe(
      'Pas de pente : bloc en cours depuis le 3 nov. · 1 séance, il en faut 3 à des jours différents.',
    )
  })

  it('aucune séance de l’exo dans le bloc', () => {
    expect(rateCaption({ since, sessions: 0 }, false, 2026)).toBe(
      'Pas de pente : bloc en cours depuis le 3 nov. · aucune séance, il en faut 3 à des jours différents.',
    )
  })

  it('trois séances sans trois jours distincts : la phrase reste vraie', () => {
    expect(rateCaption({ since, sessions: 3 }, false, 2026)).toBe(
      'Pas de pente : bloc en cours depuis le 3 nov. · 3 séances, il en faut 3 à des jours différents.',
    )
  })

  it('sans bloc : même phrase, sur tout l’historique', () => {
    expect(rateCaption({ since: null, sessions: 5 }, true, 2026)).toBe(
      'Pente : tout l’historique · 5 séances',
    )
    expect(rateCaption({ since: null, sessions: 2 }, false, 2026)).toBe(
      'Pas de pente : tout l’historique · 2 séances, il en faut 3 à des jours différents.',
    )
  })
})
