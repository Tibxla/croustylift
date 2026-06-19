// Tests de la logique unilatérale (issue #46) : appariement gauche/droite par
// `order` et sélection du CÔTÉ FAIBLE (e1RM le plus bas) pour la courbe primaire.
// Logique PURE, aucun Supabase.
import { describe, it, expect } from 'vitest'
import { pairSidesByOrder, weakSideE1rm } from './unilateral'
import { estimateE1rm } from './e1rm'
import type { PerformedSet } from './types'

describe('pairSidesByOrder', () => {
  it('apparie gauche et droite d’un même order en une paire', () => {
    const sets: PerformedSet[] = [
      { weightKg: 30, reps: 10, rir: 2, order: 1, side: 'left' },
      { weightKg: 32, reps: 10, rir: 2, order: 1, side: 'right' },
    ]

    const pairs = pairSidesByOrder(sets)

    expect(pairs).toHaveLength(1)
    expect(pairs[0].order).toBe(1)
    expect(pairs[0].left).toMatchObject({ weightKg: 30, side: 'left' })
    expect(pairs[0].right).toMatchObject({ weightKg: 32, side: 'right' })
  })

  it('renvoie les paires triées par order, plusieurs séries appariées', () => {
    const sets: PerformedSet[] = [
      { weightKg: 32, reps: 10, rir: 2, order: 2, side: 'right' },
      { weightKg: 30, reps: 10, rir: 2, order: 1, side: 'left' },
      { weightKg: 30, reps: 9, rir: 1, order: 2, side: 'left' },
      { weightKg: 32, reps: 11, rir: 2, order: 1, side: 'right' },
    ]

    const pairs = pairSidesByOrder(sets)

    expect(pairs.map((p) => p.order)).toEqual([1, 2])
  })

  it('tolère un côté manquant (paire incomplète) sans le fabriquer', () => {
    const sets: PerformedSet[] = [
      { weightKg: 30, reps: 10, rir: 2, order: 1, side: 'left' },
    ]

    const pairs = pairSidesByOrder(sets)

    expect(pairs).toHaveLength(1)
    expect(pairs[0].left).toMatchObject({ side: 'left' })
    expect(pairs[0].right).toBeNull()
  })

  it('renvoie [] pour une entrée vide', () => {
    expect(pairSidesByOrder([])).toEqual([])
  })
})

describe('weakSideE1rm', () => {
  it('bilatéral (aucun side) : e1RM de la 1ʳᵉ série, inchangé', () => {
    const sets: PerformedSet[] = [
      { weightKg: 100, reps: 5, rir: 2, order: 1 },
      { weightKg: 95, reps: 6, rir: 1, order: 2 },
    ]

    expect(weakSideE1rm(sets)).toBeCloseTo(estimateE1rm(100, 5, 2))
  })

  it('unilatéral : prend le côté FAIBLE (e1RM le plus bas) de la 1ʳᵉ série', () => {
    // Gauche plus faible que droite à la 1ʳᵉ série -> c'est gauche qui compte.
    const sets: PerformedSet[] = [
      { weightKg: 28, reps: 10, rir: 2, order: 1, side: 'left' },
      { weightKg: 32, reps: 10, rir: 2, order: 1, side: 'right' },
    ]

    const left = estimateE1rm(28, 10, 2)
    const right = estimateE1rm(32, 10, 2)
    expect(weakSideE1rm(sets)).toBeCloseTo(Math.min(left, right))
    expect(weakSideE1rm(sets)).toBeCloseTo(left)
  })

  it('unilatéral : le côté faible n’est pas toujours le plus léger (reps/RIR comptent)', () => {
    // Droite plus lourde mais à RIR plus haut/reps plus hautes -> e1RM peut basculer.
    const sets: PerformedSet[] = [
      { weightKg: 30, reps: 8, rir: 0, order: 1, side: 'left' },
      { weightKg: 30, reps: 12, rir: 3, order: 1, side: 'right' },
    ]

    const left = estimateE1rm(30, 8, 0)
    const right = estimateE1rm(30, 12, 3)
    // gauche (moins de reps/RIR) a l'e1RM le plus bas -> côté faible
    expect(left).toBeLessThan(right)
    expect(weakSideE1rm(sets)).toBeCloseTo(left)
  })

  it('unilatéral : ne regarde QUE la 1ʳᵉ série (order min), pas les suivantes', () => {
    const sets: PerformedSet[] = [
      // 1ʳᵉ série
      { weightKg: 30, reps: 10, rir: 2, order: 1, side: 'left' },
      { weightKg: 31, reps: 10, rir: 2, order: 1, side: 'right' },
      // 2ᵉ série (plus faible) : ne doit PAS influencer le point
      { weightKg: 20, reps: 6, rir: 0, order: 2, side: 'left' },
      { weightKg: 21, reps: 6, rir: 0, order: 2, side: 'right' },
    ]

    const left1 = estimateE1rm(30, 10, 2)
    const right1 = estimateE1rm(31, 10, 2)
    expect(weakSideE1rm(sets)).toBeCloseTo(Math.min(left1, right1))
  })

  it('unilatéral incomplet (un seul côté loggé) : utilise le côté présent', () => {
    const sets: PerformedSet[] = [
      { weightKg: 28, reps: 10, rir: 2, order: 1, side: 'left' },
    ]

    expect(weakSideE1rm(sets)).toBeCloseTo(estimateE1rm(28, 10, 2))
  })

  it('renvoie null pour une exécution sans série', () => {
    expect(weakSideE1rm([])).toBeNull()
  })
})
