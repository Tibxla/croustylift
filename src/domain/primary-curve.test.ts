import { describe, it, expect } from 'vitest'
import { buildPrimaryCurve } from './primary-curve'
import { estimateE1rm } from './e1rm'
import type { ExerciseExecution } from './types'

describe('buildPrimaryCurve', () => {
  it('produit un point par exécution non vide', () => {
    const executions: ExerciseExecution[] = [
      {
        date: '2026-01-01',
        exerciseId: 'bench',
        sets: [{ weightKg: 100, reps: 5, rir: 2, order: 1 }],
      },
    ]

    const curve = buildPrimaryCurve(executions, 'bench')

    expect(curve).toHaveLength(1)
    expect(curve[0].date).toBe('2026-01-01')
    expect(curve[0].e1rm).toBeCloseTo(estimateE1rm(100, 5, 2))
  })

  it('prend la 1ʳᵉ série (plus petit order), pas la plus lourde ni la dernière', () => {
    const executions: ExerciseExecution[] = [
      {
        date: '2026-01-01',
        exerciseId: 'bench',
        sets: [
          // séries dans le désordre ; la 2ᵉ est plus lourde mais ne doit PAS être prise
          { weightKg: 120, reps: 3, rir: 0, order: 2 },
          { weightKg: 100, reps: 5, rir: 2, order: 1 },
        ],
      },
    ]

    const curve = buildPrimaryCurve(executions, 'bench')

    expect(curve).toHaveLength(1)
    expect(curve[0].e1rm).toBeCloseTo(estimateE1rm(100, 5, 2))
  })

  it('ignore une exécution vide (trou ≠ zéro : aucun point)', () => {
    const executions: ExerciseExecution[] = [
      { date: '2026-01-01', exerciseId: 'bench', sets: [] },
      {
        date: '2026-01-08',
        exerciseId: 'bench',
        sets: [{ weightKg: 100, reps: 5, rir: 2, order: 1 }],
      },
    ]

    const curve = buildPrimaryCurve(executions, 'bench')

    expect(curve).toHaveLength(1)
    expect(curve[0].date).toBe('2026-01-08')
  })

  it('ignore les exécutions d’un autre exerciseId', () => {
    const executions: ExerciseExecution[] = [
      {
        date: '2026-01-01',
        exerciseId: 'squat',
        sets: [{ weightKg: 140, reps: 5, rir: 2, order: 1 }],
      },
      {
        date: '2026-01-08',
        exerciseId: 'bench',
        sets: [{ weightKg: 100, reps: 5, rir: 2, order: 1 }],
      },
    ]

    const curve = buildPrimaryCurve(executions, 'bench')

    expect(curve).toHaveLength(1)
    expect(curve[0].date).toBe('2026-01-08')
    expect(curve[0].e1rm).toBeCloseTo(estimateE1rm(100, 5, 2))
  })

  it('renvoie les points triés par date même si l’entrée est désordonnée', () => {
    const executions: ExerciseExecution[] = [
      {
        date: '2026-01-15',
        exerciseId: 'bench',
        sets: [{ weightKg: 105, reps: 5, rir: 2, order: 1 }],
      },
      {
        date: '2026-01-01',
        exerciseId: 'bench',
        sets: [{ weightKg: 100, reps: 5, rir: 2, order: 1 }],
      },
      {
        date: '2026-01-08',
        exerciseId: 'bench',
        sets: [{ weightKg: 102, reps: 5, rir: 2, order: 1 }],
      },
    ]

    const curve = buildPrimaryCurve(executions, 'bench')

    expect(curve.map((point) => point.date)).toEqual([
      '2026-01-01',
      '2026-01-08',
      '2026-01-15',
    ])
  })

  it('renvoie [] pour une entrée vide', () => {
    expect(buildPrimaryCurve([], 'bench')).toEqual([])
  })

  it('unilatéral : le point suit le CÔTÉ FAIBLE de la 1ʳᵉ série (e1RM min des 2 côtés)', () => {
    const executions: ExerciseExecution[] = [
      {
        date: '2026-01-01',
        exerciseId: 'curl',
        sets: [
          // 1ʳᵉ série : DROITE saisie d'abord et plus FORTE, GAUCHE après et plus
          // faible -> c'est le côté faible (gauche) qui doit compter, peu importe
          // l'ordre d'apparition dans le tableau.
          { weightKg: 32, reps: 10, rir: 2, order: 1, side: 'right' },
          { weightKg: 28, reps: 10, rir: 2, order: 1, side: 'left' },
          // 2ᵉ série : ne doit pas influencer le point (on prend la 1ʳᵉ)
          { weightKg: 26, reps: 9, rir: 1, order: 2, side: 'left' },
          { weightKg: 30, reps: 9, rir: 1, order: 2, side: 'right' },
        ],
      },
    ]

    const curve = buildPrimaryCurve(executions, 'curl')

    expect(curve).toHaveLength(1)
    // côté faible = gauche (e1RM le plus bas), pas droite ni une moyenne
    expect(curve[0].e1rm).toBeCloseTo(estimateE1rm(28, 10, 2))
    expect(curve[0].e1rm).toBeLessThan(estimateE1rm(32, 10, 2))
  })
})
