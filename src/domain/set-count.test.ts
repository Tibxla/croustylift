import { describe, it, expect } from 'vitest'
import {
  countLogicalSetsDone,
  countSetsByMuscle,
  countPlannedSets,
  countPerformedSets,
} from './set-count'
import type { PerformedSet } from './types'

// Fabrique : une série bilatérale (un côté, side absent).
function bi(order: number): PerformedSet {
  return { weightKg: 50, reps: 10, rir: 2, order }
}
// Fabrique : un côté d'une série unilatérale (left/right au même order).
function uni(order: number, side: 'left' | 'right'): PerformedSet {
  return { weightKg: 30, reps: 10, rir: 2, order, side }
}

describe('countLogicalSetsDone', () => {
  it('aucune série -> 0', () => {
    expect(countLogicalSetsDone([])).toBe(0)
  })

  it('bilatéral : une ligne = une série logique', () => {
    expect(countLogicalSetsDone([bi(1), bi(2), bi(3)])).toBe(3)
  })

  it('unilatéral : G+D au même order = une série logique', () => {
    expect(countLogicalSetsDone([uni(1, 'left'), uni(1, 'right')])).toBe(1)
  })

  it('unilatéral : deux séries complètes (2 orders) = 2 séries logiques', () => {
    expect(
      countLogicalSetsDone([
        uni(1, 'left'),
        uni(1, 'right'),
        uni(2, 'left'),
        uni(2, 'right'),
      ]),
    ).toBe(2)
  })

  it('unilatéral incomplet : un seul côté loggé compte quand même la série entamée', () => {
    expect(countLogicalSetsDone([uni(1, 'left')])).toBe(1)
  })
})

describe('countSetsByMuscle (réel, dérivé des séries loggées)', () => {
  it('cas vide : total 0, aucun muscle', () => {
    expect(countPerformedSets([])).toEqual({ total: 0, byMuscle: {} })
  })

  it('exo bilatéral mono-muscle : +1 total, +1 muscle par série logique', () => {
    const result = countPerformedSets([
      { unilateral: false, primaryMuscles: ['pectoraux'], sets: [bi(1), bi(2), bi(3)] },
    ])
    expect(result.total).toBe(3)
    expect(result.byMuscle).toEqual({ pectoraux: 3 })
  })

  it('exo unilatéral mono-muscle : +2 total mais +1 muscle par série logique', () => {
    const result = countPerformedSets([
      {
        unilateral: true,
        primaryMuscles: ['quadriceps'],
        sets: [uni(1, 'left'), uni(1, 'right'), uni(2, 'left'), uni(2, 'right')],
      },
    ])
    expect(result.total).toBe(4) // 2 séries logiques × 2
    expect(result.byMuscle).toEqual({ quadriceps: 2 }) // 2 séries logiques × 1
  })

  it('exo multi-muscles bilatéral : +1 par muscle principal, +1 total par série logique', () => {
    const result = countPerformedSets([
      {
        unilateral: false,
        primaryMuscles: ['pectoraux', 'triceps'],
        sets: [bi(1), bi(2)],
      },
    ])
    expect(result.total).toBe(2)
    expect(result.byMuscle).toEqual({ pectoraux: 2, triceps: 2 })
  })

  it('exo multi-muscles unilatéral : muscle +1 par série logique (pas +2), total +2', () => {
    const result = countPerformedSets([
      {
        unilateral: true,
        primaryMuscles: ['fessiers', 'quadriceps'],
        sets: [uni(1, 'left'), uni(1, 'right')],
      },
    ])
    expect(result.total).toBe(2) // 1 série logique × 2
    expect(result.byMuscle).toEqual({ fessiers: 1, quadriceps: 1 })
  })

  it('plusieurs exos : cumule par muscle et au total', () => {
    const result = countPerformedSets([
      { unilateral: false, primaryMuscles: ['pectoraux'], sets: [bi(1), bi(2), bi(3)] },
      { unilateral: false, primaryMuscles: ['dorsaux'], sets: [bi(1), bi(2)] },
      {
        unilateral: true,
        primaryMuscles: ['quadriceps'],
        sets: [uni(1, 'left'), uni(1, 'right'), uni(2, 'left'), uni(2, 'right')],
      },
    ])
    // total = 3 (pecs) + 2 (dorsaux) + 4 (quads unilatéral) = 9
    expect(result.total).toBe(9)
    expect(result.byMuscle).toEqual({ pectoraux: 3, dorsaux: 2, quadriceps: 2 })
  })

  it('muscles partagés entre exos : les comptes s\'additionnent', () => {
    const result = countPerformedSets([
      { unilateral: false, primaryMuscles: ['pectoraux', 'triceps'], sets: [bi(1), bi(2)] },
      { unilateral: false, primaryMuscles: ['triceps'], sets: [bi(1)] },
    ])
    expect(result.byMuscle).toEqual({ pectoraux: 2, triceps: 3 })
    expect(result.total).toBe(3)
  })

  it('exo sans série loggée n\'apporte rien', () => {
    const result = countPerformedSets([
      { unilateral: false, primaryMuscles: ['pectoraux'], sets: [] },
    ])
    expect(result).toEqual({ total: 0, byMuscle: {} })
  })
})

describe('countPlannedSets (prévu, dérivé des prescriptions)', () => {
  it('cas vide : fourchette 0..0, aucun muscle', () => {
    expect(countPlannedSets([])).toEqual({
      total: { min: 0, max: 0 },
      byMuscle: {},
    })
  })

  it('séries fixes (min === max) : fourchette dégénérée, valeur unique', () => {
    const result = countPlannedSets([
      { unilateral: false, primaryMuscles: ['pectoraux'], sets: { min: 3, max: 3 } },
    ])
    expect(result.total).toEqual({ min: 3, max: 3 })
    expect(result.byMuscle).toEqual({ pectoraux: { min: 3, max: 3 } })
  })

  it('fourchette de séries : compte en fourchette, bilatéral +1/série au total et au muscle', () => {
    const result = countPlannedSets([
      { unilateral: false, primaryMuscles: ['pectoraux'], sets: { min: 3, max: 4 } },
    ])
    expect(result.total).toEqual({ min: 3, max: 4 })
    expect(result.byMuscle).toEqual({ pectoraux: { min: 3, max: 4 } })
  })

  it('unilatéral : total ×2 (la série compte double), muscle ×1', () => {
    const result = countPlannedSets([
      { unilateral: true, primaryMuscles: ['quadriceps'], sets: { min: 3, max: 4 } },
    ])
    expect(result.total).toEqual({ min: 6, max: 8 }) // ×2
    expect(result.byMuscle).toEqual({ quadriceps: { min: 3, max: 4 } }) // ×1
  })

  it('multi-muscles : +1 par muscle principal et par série prescrite', () => {
    const result = countPlannedSets([
      { unilateral: false, primaryMuscles: ['pectoraux', 'triceps'], sets: { min: 3, max: 3 } },
    ])
    expect(result.total).toEqual({ min: 3, max: 3 })
    expect(result.byMuscle).toEqual({
      pectoraux: { min: 3, max: 3 },
      triceps: { min: 3, max: 3 },
    })
  })

  it('plusieurs exos : cumule les fourchettes par muscle et au total', () => {
    const result = countPlannedSets([
      { unilateral: false, primaryMuscles: ['pectoraux'], sets: { min: 3, max: 4 } },
      { unilateral: true, primaryMuscles: ['quadriceps', 'fessiers'], sets: { min: 2, max: 3 } },
    ])
    // total = pecs (3..4) + quads unilatéral (2..3 ×2 = 4..6) = 7..10
    expect(result.total).toEqual({ min: 7, max: 10 })
    expect(result.byMuscle).toEqual({
      pectoraux: { min: 3, max: 4 },
      quadriceps: { min: 2, max: 3 },
      fessiers: { min: 2, max: 3 },
    })
  })
})

// countSetsByMuscle est le cœur partagé : on vérifie qu'il applique la règle de
// poids (unilatéral ×2 au total, ×1 au muscle) sur un nombre de séries logiques
// déjà calculé, sans connaître la provenance (prévu ou réel).
describe('countSetsByMuscle (cœur paramétré par séries logiques)', () => {
  it('applique +1 par muscle et le poids unilatéral au total', () => {
    const result = countSetsByMuscle([
      { unilateral: false, primaryMuscles: ['pectoraux', 'triceps'], logicalSets: 3 },
      { unilateral: true, primaryMuscles: ['quadriceps'], logicalSets: 2 },
    ])
    // total = pecs/triceps exo (3 ×1) + quads (2 ×2 = 4) = 7
    expect(result.total).toBe(7)
    expect(result.byMuscle).toEqual({ pectoraux: 3, triceps: 3, quadriceps: 2 })
  })
})
