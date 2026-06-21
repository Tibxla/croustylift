import { describe, it, expect } from 'vitest'
import type { ExerciseExecution, PerformedSet, Side } from './types'
import {
  personalRecord,
  personalRecordBySide,
  isE1rmRecord,
  isWeightRepsRecord,
  type PersonalRecord,
} from './pr'

// Helpers de lisibilité des cas.
const set = (weightKg: number, reps: number, rir: number, order = 1): PerformedSet => ({
  weightKg,
  reps,
  rir,
  order,
})

// Série unilatérale : porte un `side` (les deux côtés d'une série partagent l'order).
const sideSet = (
  side: Side,
  weightKg: number,
  reps: number,
  rir: number,
  order = 1,
): PerformedSet => ({ weightKg, reps, rir, order, side })

describe('personalRecord', () => {
  it('renvoie un record nul (les deux à null) sans aucun historique', () => {
    expect(personalRecord([], 'squat')).toEqual({
      bestE1rm: null,
      bestWeightReps: null,
    })
  })

  it('renvoie un record nul si l’exo n’a que des exécutions vides (trous, pas des zéros)', () => {
    const onlyHoles: ExerciseExecution[] = [
      { date: '2026-01-10', exerciseId: 'squat', sets: [] },
      { date: '2026-01-17', exerciseId: 'squat', sets: [] },
    ]
    expect(personalRecord(onlyHoles, 'squat')).toEqual({
      bestE1rm: null,
      bestWeightReps: null,
    })
  })

  it('filtre par exerciseId : ignore les séries des autres exos', () => {
    const executions: ExerciseExecution[] = [
      { date: '2026-01-10', exerciseId: 'squat', sets: [set(100, 5, 1)] },
      { date: '2026-01-10', exerciseId: 'bench', sets: [set(200, 5, 0)] },
    ]
    const pr = personalRecord(executions, 'squat')
    // 100 * (1 + (5+1)/30) = 120
    expect(pr.bestE1rm).toBeCloseTo(120, 6)
    expect(pr.bestWeightReps).toEqual({ weightKg: 100, reps: 5 })
  })

  it('e1RM : ne retient QUE la 1ʳᵉ série de chaque exécution, prend le meilleur', () => {
    const executions: ExerciseExecution[] = [
      {
        // 1ʳᵉ série faible, 2ᵉ série plus forte : seule la 1ʳᵉ compte pour l'e1RM.
        date: '2026-01-10',
        exerciseId: 'squat',
        sets: [set(100, 5, 1, 1), set(120, 5, 1, 2)],
      },
      {
        date: '2026-01-17',
        exerciseId: 'squat',
        sets: [set(105, 5, 1, 1)],
      },
    ]
    const pr = personalRecord(executions, 'squat')
    // meilleur des 1ʳᵉˢ séries : 105x5@1 = 105 * (1 + 6/30) = 126
    expect(pr.bestE1rm).toBeCloseTo(126, 6)
  })

  it('e1RM unilatéral : le record suit le CÔTÉ FAIBLE de la 1ʳᵉ série (pas le côté fort)', () => {
    const executions: ExerciseExecution[] = [
      {
        // 1ʳᵉ série déséquilibrée : G fort (120), D faible (96). Les deux côtés
        // partagent l'order 1. Le record e1RM doit valoir le côté faible (96),
        // pas le 1er élément du tableau (G, le côté fort) — cf. ADR 0005.
        date: '2026-01-10',
        exerciseId: 'curl',
        sets: [sideSet('left', 100, 5, 1, 1), sideSet('right', 80, 5, 1, 1)],
      },
    ]
    // côté faible : 80x5@1 = 80 * (1 + 6/30) = 96 (et NON 100x5@1 = 120)
    expect(personalRecord(executions, 'curl').bestE1rm).toBeCloseTo(96, 6)
  })

  it('e1RM unilatéral : insensible à l’ordre de saisie (droite saisie d’abord)', () => {
    const executions: ExerciseExecution[] = [
      {
        // Même série, mais le côté FAIBLE (D) est saisi en 1er dans le tableau :
        // le record doit rester le côté faible, l'appariement étant par order.
        date: '2026-01-10',
        exerciseId: 'curl',
        sets: [sideSet('right', 80, 5, 1, 1), sideSet('left', 100, 5, 1, 1)],
      },
    ]
    expect(personalRecord(executions, 'curl').bestE1rm).toBeCloseTo(96, 6)
  })

  it('e1RM unilatéral : seule la 1ʳᵉ série (order 1) compte, côté faible', () => {
    const executions: ExerciseExecution[] = [
      {
        date: '2026-01-10',
        exerciseId: 'curl',
        sets: [
          // 1ʳᵉ série : faible = D à 90x5@1 = 108.
          sideSet('left', 100, 5, 1, 1),
          sideSet('right', 90, 5, 1, 1),
          // 2ᵉ série plus lourde : ignorée pour l'e1RM (comme en bilatéral).
          sideSet('left', 120, 5, 1, 2),
          sideSet('right', 110, 5, 1, 2),
        ],
      },
    ]
    // côté faible de la 1ʳᵉ série : 90x5@1 = 90 * 1.2 = 108
    expect(personalRecord(executions, 'curl').bestE1rm).toBeCloseTo(108, 6)
  })

  it('poids×reps : balaie TOUTES les séries (pas seulement la 1ʳᵉ)', () => {
    const executions: ExerciseExecution[] = [
      {
        date: '2026-01-10',
        exerciseId: 'squat',
        // La charge max (130) est sur la 2ᵉ série.
        sets: [set(100, 8, 1, 1), set(130, 3, 0, 2)],
      },
    ]
    const pr = personalRecord(executions, 'squat')
    expect(pr.bestWeightReps).toEqual({ weightKg: 130, reps: 3 })
  })

  it('poids×reps : à poids égal, départage par les reps les plus hautes', () => {
    const executions: ExerciseExecution[] = [
      {
        date: '2026-01-10',
        exerciseId: 'squat',
        sets: [set(100, 5, 1, 1), set(100, 8, 1, 2)],
      },
    ]
    expect(personalRecord(executions, 'squat').bestWeightReps).toEqual({
      weightKg: 100,
      reps: 8,
    })
  })

  it('poids×reps : le poids le plus lourd prime sur des reps plus hautes à charge moindre', () => {
    const executions: ExerciseExecution[] = [
      {
        date: '2026-01-10',
        exerciseId: 'squat',
        sets: [set(120, 3, 0, 1), set(100, 12, 1, 2)],
      },
    ]
    expect(personalRecord(executions, 'squat').bestWeightReps).toEqual({
      weightKg: 120,
      reps: 3,
    })
  })
})

describe('isE1rmRecord', () => {
  const record: PersonalRecord = {
    bestE1rm: 120, // p. ex. 100x5@1
    bestWeightReps: { weightKg: 100, reps: 5 },
  }

  it('vrai quand l’e1RM de la série dépasse STRICTEMENT le record', () => {
    // 105x5@1 = 126 > 120
    expect(isE1rmRecord(record, set(105, 5, 1))).toBe(true)
  })

  it('faux à égalité : un record égalé n’est pas un nouveau record', () => {
    // 100x5@1 = 120 == 120
    expect(isE1rmRecord(record, set(100, 5, 1))).toBe(false)
  })

  it('faux quand l’e1RM est sous le record', () => {
    // 90x5@1 = 108 < 120
    expect(isE1rmRecord(record, set(90, 5, 1))).toBe(false)
  })

  it('vrai contre un record vierge (premier passage, bestE1rm null)', () => {
    const blank: PersonalRecord = { bestE1rm: null, bestWeightReps: null }
    expect(isE1rmRecord(blank, set(50, 5, 1))).toBe(true)
  })
})

describe('isWeightRepsRecord', () => {
  const record: PersonalRecord = {
    bestE1rm: 120,
    bestWeightReps: { weightKg: 100, reps: 5 },
  }

  it('vrai quand le poids dépasse strictement le record (peu importe les reps)', () => {
    expect(isWeightRepsRecord(record, set(102.5, 1, 0))).toBe(true)
  })

  it('vrai à poids égal quand les reps dépassent strictement le record', () => {
    expect(isWeightRepsRecord(record, set(100, 6, 1))).toBe(true)
  })

  it('faux à poids et reps égaux : record égalé, pas battu', () => {
    expect(isWeightRepsRecord(record, set(100, 5, 1))).toBe(false)
  })

  it('faux à poids égal mais reps inférieures', () => {
    expect(isWeightRepsRecord(record, set(100, 4, 1))).toBe(false)
  })

  it('faux quand le poids est inférieur, même avec beaucoup plus de reps', () => {
    expect(isWeightRepsRecord(record, set(95, 20, 3))).toBe(false)
  })

  it('vrai contre un record vierge (premier passage, bestWeightReps null)', () => {
    const blank: PersonalRecord = { bestE1rm: null, bestWeightReps: null }
    expect(isWeightRepsRecord(blank, set(40, 10, 2))).toBe(true)
  })
})

describe('personalRecordBySide', () => {
  it('tient un record SÉPARÉ par côté (ADR 0010)', () => {
    // 2 jours. Gauche progresse, droite est plus lourde mais stagne.
    const executions: ExerciseExecution[] = [
      {
        date: '2026-01-10',
        exerciseId: 'db-press',
        sets: [sideSet('left', 20, 10, 0, 1), sideSet('right', 24, 10, 0, 1)],
      },
      {
        date: '2026-01-17',
        exerciseId: 'db-press',
        sets: [sideSet('left', 22, 10, 0, 1), sideSet('right', 24, 8, 0, 1)],
      },
    ]
    const { left, right } = personalRecordBySide(executions, 'db-press')
    // Gauche : meilleur e1RM = 22×10 (jour 2), charge max 22×10.
    expect(left.bestWeightReps).toEqual({ weightKg: 22, reps: 10 })
    expect(left.bestE1rm).toBeCloseTo(22 * (1 + 10 / 30))
    // Droite : meilleur e1RM = 24×10 (jour 1, 1ʳᵉ série), charge max 24×10.
    expect(right.bestWeightReps).toEqual({ weightKg: 24, reps: 10 })
    expect(right.bestE1rm).toBeCloseTo(24 * (1 + 10 / 30))
  })

  it('records nuls pour un côté jamais travaillé', () => {
    const executions: ExerciseExecution[] = [
      { date: '2026-01-10', exerciseId: 'db-press', sets: [sideSet('left', 20, 10, 0, 1)] },
    ]
    const { right } = personalRecordBySide(executions, 'db-press')
    expect(right).toEqual({ bestE1rm: null, bestWeightReps: null })
  })
})
