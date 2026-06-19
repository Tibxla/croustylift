import { describe, it, expect } from 'vitest'
import {
  contribution,
  countLogicalSetsDone,
  countSetsByMuscle,
  countPlannedSets,
  countPerformedSets,
} from './set-count'
import type { PerformedSet } from './types'

// Fabrique : une série bilatérale (un côté, side absent).
function bi(order: number, reps = 10): PerformedSet {
  return { weightKg: 50, reps, rir: 2, order }
}
// Fabrique : un côté d'une série unilatérale (left/right au même order).
function uni(order: number, side: 'left' | 'right', reps = 10): PerformedSet {
  return { weightKg: 30, reps, rir: 2, order, side }
}

// =====================================================================
// contribution — la brique de pondération par reps (issue #60).
// =====================================================================

describe('contribution (min(reps, 5) / 5)', () => {
  it('reps >= 5 : plafonné à 1', () => {
    expect(contribution(5)).toBe(1)
    expect(contribution(10)).toBe(1)
    expect(contribution(100)).toBe(1)
  })

  it('reps < 5 : crédit partiel reps / 5', () => {
    expect(contribution(3)).toBeCloseTo(0.6)
    expect(contribution(1)).toBeCloseTo(0.2)
    expect(contribution(4)).toBeCloseTo(0.8)
  })

  it('0 reps : 0', () => {
    expect(contribution(0)).toBe(0)
  })

  it('reps négatif (cas dégénéré) : 0, jamais de crédit négatif', () => {
    expect(contribution(-3)).toBe(0)
  })
})

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

// =====================================================================
// Décompte RÉEL pondéré par reps (issue #60).
// =====================================================================

describe('countPerformedSets (réel, pondéré par reps)', () => {
  it('cas vide : total 0, aucun muscle', () => {
    expect(countPerformedSets([])).toEqual({ total: 0, byMuscle: {} })
  })

  it('exo bilatéral reps >= 5 : chaque série vaut 1 (plafonné)', () => {
    const result = countPerformedSets([
      { unilateral: false, primaryMuscles: ['pectoraux'], sets: [bi(1), bi(2), bi(3)] },
    ])
    expect(result.total).toBeCloseTo(3)
    expect(result.byMuscle.pectoraux).toBeCloseTo(3)
  })

  it('exo bilatéral 3 séries de 3 reps : 3 × 0.6 = 1.8 au total et au muscle', () => {
    const result = countPerformedSets([
      {
        unilateral: false,
        primaryMuscles: ['pectoraux'],
        sets: [bi(1, 3), bi(2, 3), bi(3, 3)],
      },
    ])
    expect(result.total).toBeCloseTo(1.8)
    expect(result.byMuscle.pectoraux).toBeCloseTo(1.8)
  })

  it('exo bilatéral 1 série de 10 reps : 1 (plafonné, pas 2)', () => {
    const result = countPerformedSets([
      { unilateral: false, primaryMuscles: ['pectoraux'], sets: [bi(1, 10)] },
    ])
    expect(result.total).toBeCloseTo(1)
    expect(result.byMuscle.pectoraux).toBeCloseTo(1)
  })

  it('exo unilatéral reps >= 5 des deux côtés : total = 2 (somme des côtés), muscle = 1 (côté faible)', () => {
    const result = countPerformedSets([
      {
        unilateral: true,
        primaryMuscles: ['quadriceps'],
        sets: [uni(1, 'left', 10), uni(1, 'right', 10)],
      },
    ])
    expect(result.total).toBeCloseTo(2)
    expect(result.byMuscle.quadriceps).toBeCloseTo(1)
  })

  it('exo unilatéral reps différents : total = somme des 2 côtés, muscle = côté FAIBLE (reps le plus bas)', () => {
    // gauche 5 reps -> c=1 ; droite 3 reps -> c=0.6
    const result = countPerformedSets([
      {
        unilateral: true,
        primaryMuscles: ['quadriceps'],
        sets: [uni(1, 'left', 5), uni(1, 'right', 3)],
      },
    ])
    // total = 1 + 0.6 = 1.6 ; muscle = côté faible (3 reps) = 0.6
    expect(result.total).toBeCloseTo(1.6)
    expect(result.byMuscle.quadriceps).toBeCloseTo(0.6)
  })

  it('exo unilatéral incomplet (un seul côté loggé) : total et muscle = ce côté seul', () => {
    const result = countPerformedSets([
      {
        unilateral: true,
        primaryMuscles: ['quadriceps'],
        sets: [uni(1, 'left', 4)],
      },
    ])
    // un côté de 4 reps : c = 0.8 ; total = 0.8 ; muscle = 0.8 (le seul côté présent)
    expect(result.total).toBeCloseTo(0.8)
    expect(result.byMuscle.quadriceps).toBeCloseTo(0.8)
  })

  it('exo multi-muscles bilatéral : la contribution s\'applique à CHAQUE muscle principal', () => {
    const result = countPerformedSets([
      {
        unilateral: false,
        primaryMuscles: ['pectoraux', 'triceps'],
        sets: [bi(1, 10), bi(2, 10)],
      },
    ])
    expect(result.total).toBeCloseTo(2)
    expect(result.byMuscle.pectoraux).toBeCloseTo(2)
    expect(result.byMuscle.triceps).toBeCloseTo(2)
  })

  it('exo multi-muscles unilatéral : côté faible appliqué à chaque muscle, total = somme des côtés', () => {
    const result = countPerformedSets([
      {
        unilateral: true,
        primaryMuscles: ['fessiers', 'quadriceps'],
        sets: [uni(1, 'left', 5), uni(1, 'right', 5)],
      },
    ])
    expect(result.total).toBeCloseTo(2) // 1 + 1
    expect(result.byMuscle.fessiers).toBeCloseTo(1)
    expect(result.byMuscle.quadriceps).toBeCloseTo(1)
  })

  it('plusieurs exos : cumule par muscle et au total', () => {
    const result = countPerformedSets([
      { unilateral: false, primaryMuscles: ['pectoraux'], sets: [bi(1, 10), bi(2, 10), bi(3, 10)] },
      { unilateral: false, primaryMuscles: ['dorsaux'], sets: [bi(1, 10), bi(2, 10)] },
      {
        unilateral: true,
        primaryMuscles: ['quadriceps'],
        sets: [uni(1, 'left', 10), uni(1, 'right', 10), uni(2, 'left', 10), uni(2, 'right', 10)],
      },
    ])
    // total = 3 (pecs) + 2 (dorsaux) + 4 (quads : 2 séries × 2 côtés) = 9
    expect(result.total).toBeCloseTo(9)
    expect(result.byMuscle.pectoraux).toBeCloseTo(3)
    expect(result.byMuscle.dorsaux).toBeCloseTo(2)
    expect(result.byMuscle.quadriceps).toBeCloseTo(2) // 2 séries × côté faible (1)
  })

  it('muscles partagés entre exos : les contributions s\'additionnent', () => {
    const result = countPerformedSets([
      { unilateral: false, primaryMuscles: ['pectoraux', 'triceps'], sets: [bi(1, 10), bi(2, 10)] },
      { unilateral: false, primaryMuscles: ['triceps'], sets: [bi(1, 10)] },
    ])
    expect(result.byMuscle.pectoraux).toBeCloseTo(2)
    expect(result.byMuscle.triceps).toBeCloseTo(3)
    expect(result.total).toBeCloseTo(3)
  })

  it('exo sans série loggée n\'apporte rien', () => {
    const result = countPerformedSets([
      { unilateral: false, primaryMuscles: ['pectoraux'], sets: [] },
    ])
    expect(result).toEqual({ total: 0, byMuscle: {} })
  })
})

// =====================================================================
// Décompte PRÉVU pondéré par reps_min (issue #60).
// =====================================================================

describe('countPlannedSets (prévu, pondéré par reps_min)', () => {
  it('cas vide : fourchette 0..0, aucun muscle', () => {
    expect(countPlannedSets([])).toEqual({
      total: { min: 0, max: 0 },
      byMuscle: {},
    })
  })

  it('séries fixes, reps >= 5 : chaque série vaut 1', () => {
    const result = countPlannedSets([
      { unilateral: false, primaryMuscles: ['pectoraux'], sets: { min: 3, max: 3 }, reps: { min: 8, max: 12 } },
    ])
    expect(result.total).toEqual({ min: 3, max: 3 })
    expect(result.byMuscle.pectoraux).toEqual({ min: 3, max: 3 })
  })

  it('pondère par reps_min : 3 séries de reps_min=3 -> 3 × 0.6 = 1.8', () => {
    const result = countPlannedSets([
      { unilateral: false, primaryMuscles: ['pectoraux'], sets: { min: 3, max: 3 }, reps: { min: 3, max: 3 } },
    ])
    expect(result.total.min).toBeCloseTo(1.8)
    expect(result.total.max).toBeCloseTo(1.8)
    expect(result.byMuscle.pectoraux.min).toBeCloseTo(1.8)
  })

  it('fourchette de séries : la fourchette de décompte suit les séries, reps figés à reps_min', () => {
    // reps_min = 3 -> c = 0.6 ; séries 3..4 -> 1.8 .. 2.4
    const result = countPlannedSets([
      { unilateral: false, primaryMuscles: ['pectoraux'], sets: { min: 3, max: 4 }, reps: { min: 3, max: 5 } },
    ])
    expect(result.total.min).toBeCloseTo(1.8)
    expect(result.total.max).toBeCloseTo(2.4)
    expect(result.byMuscle.pectoraux.min).toBeCloseTo(1.8)
    expect(result.byMuscle.pectoraux.max).toBeCloseTo(2.4)
  })

  it('unilatéral : total = 2 côtés (les deux à reps_min), muscle = côté faible (= reps_min)', () => {
    // reps_min = 5 -> c = 1 ; 3 séries
    const result = countPlannedSets([
      { unilateral: true, primaryMuscles: ['quadriceps'], sets: { min: 3, max: 4 }, reps: { min: 5, max: 8 } },
    ])
    // total = séries × 2 × c(5) = 3..4 × 2 = 6..8 ; muscle = séries × c(5) = 3..4
    expect(result.total).toEqual({ min: 6, max: 8 })
    expect(result.byMuscle.quadriceps).toEqual({ min: 3, max: 4 })
  })

  it('multi-muscles : la contribution s\'applique à chaque muscle principal', () => {
    const result = countPlannedSets([
      { unilateral: false, primaryMuscles: ['pectoraux', 'triceps'], sets: { min: 3, max: 3 }, reps: { min: 8, max: 8 } },
    ])
    expect(result.total).toEqual({ min: 3, max: 3 })
    expect(result.byMuscle.pectoraux).toEqual({ min: 3, max: 3 })
    expect(result.byMuscle.triceps).toEqual({ min: 3, max: 3 })
  })

  it('plusieurs exos : cumule les fourchettes par muscle et au total', () => {
    const result = countPlannedSets([
      { unilateral: false, primaryMuscles: ['pectoraux'], sets: { min: 3, max: 4 }, reps: { min: 8, max: 12 } },
      { unilateral: true, primaryMuscles: ['quadriceps', 'fessiers'], sets: { min: 2, max: 3 }, reps: { min: 8, max: 10 } },
    ])
    // pecs : c(8)=1, séries 3..4 -> 3..4
    // quads/fessiers unilatéral : total 2..3 × 2 = 4..6 ; muscle 2..3
    expect(result.total).toEqual({ min: 7, max: 10 })
    expect(result.byMuscle.pectoraux).toEqual({ min: 3, max: 4 })
    expect(result.byMuscle.quadriceps).toEqual({ min: 2, max: 3 })
    expect(result.byMuscle.fessiers).toEqual({ min: 2, max: 3 })
  })
})

// =====================================================================
// countSetsByMuscle : le cœur partagé prévu/réel. On lui passe, par exo,
// la contribution déjà pondérée de chaque série logique (total + par muscle),
// et il somme au global et par muscle principal.
// =====================================================================

describe('countSetsByMuscle (cœur paramétré par contributions de séries)', () => {
  it('somme la contribution au total et l\'applique à chaque muscle', () => {
    const result = countSetsByMuscle([
      {
        primaryMuscles: ['pectoraux', 'triceps'],
        logicalSets: [
          { total: 1, perMuscle: 1 },
          { total: 0.6, perMuscle: 0.6 },
        ],
      },
      {
        primaryMuscles: ['quadriceps'],
        logicalSets: [{ total: 2, perMuscle: 1 }],
      },
    ])
    // total = (1 + 0.6) + 2 = 3.6
    expect(result.total).toBeCloseTo(3.6)
    expect(result.byMuscle.pectoraux).toBeCloseTo(1.6)
    expect(result.byMuscle.triceps).toBeCloseTo(1.6)
    expect(result.byMuscle.quadriceps).toBeCloseTo(1)
  })

  it('exo sans série logique n\'apporte rien', () => {
    const result = countSetsByMuscle([
      { primaryMuscles: ['pectoraux'], logicalSets: [] },
    ])
    expect(result).toEqual({ total: 0, byMuscle: {} })
  })
})
