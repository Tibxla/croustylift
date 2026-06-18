import { describe, it, expect } from 'vitest'
import type { ExerciseExecution, PerformedSet } from './types'
import {
  personalRecord,
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
