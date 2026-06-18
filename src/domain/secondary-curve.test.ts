import { describe, it, expect } from 'vitest'
import { buildSecondaryCurve } from './secondary-curve'
import { estimateE1rm } from './e1rm'
import type { ExerciseExecution } from './types'

// La courbe secondaire = tendance des séries 2+ (order >= 2) : leur e1RM MOYEN
// par exécution. Signal subordonné « résistance à la fatigue » : comment les
// séries qui suivent la 1ʳᵉ tiennent dans le temps. Même forme que la primaire
// (E1rmPoint[]), donc directement comparable et réutilisable par l'UI.
describe('buildSecondaryCurve', () => {
  it('produit un point = e1RM moyen des séries 2+ (la 1ʳᵉ série exclue)', () => {
    const executions: ExerciseExecution[] = [
      {
        date: '2026-01-01',
        exerciseId: 'bench',
        sets: [
          { weightKg: 100, reps: 5, rir: 2, order: 1 }, // exclue : c'est la primaire
          { weightKg: 95, reps: 5, rir: 1, order: 2 },
          { weightKg: 90, reps: 5, rir: 0, order: 3 },
        ],
      },
    ]

    const curve = buildSecondaryCurve(executions, 'bench')

    const expected = (estimateE1rm(95, 5, 1) + estimateE1rm(90, 5, 0)) / 2
    expect(curve).toHaveLength(1)
    expect(curve[0].date).toBe('2026-01-01')
    expect(curve[0].e1rm).toBeCloseTo(expected)
  })

  it('ignore une exécution sans série 2+ (1ʳᵉ série seule = trou, pas un zéro)', () => {
    const executions: ExerciseExecution[] = [
      {
        date: '2026-01-01',
        exerciseId: 'bench',
        sets: [{ weightKg: 100, reps: 5, rir: 2, order: 1 }],
      },
      {
        date: '2026-01-08',
        exerciseId: 'bench',
        sets: [
          { weightKg: 100, reps: 5, rir: 2, order: 1 },
          { weightKg: 95, reps: 5, rir: 1, order: 2 },
        ],
      },
    ]

    const curve = buildSecondaryCurve(executions, 'bench')

    expect(curve).toHaveLength(1)
    expect(curve[0].date).toBe('2026-01-08')
    expect(curve[0].e1rm).toBeCloseTo(estimateE1rm(95, 5, 1))
  })

  it('renvoie [] quand AUCUNE exécution n’a de série 2+ (pas de graphe secondaire)', () => {
    const executions: ExerciseExecution[] = [
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

    expect(buildSecondaryCurve(executions, 'bench')).toEqual([])
  })

  it('ignore une exécution vide (trou ≠ zéro : aucun point)', () => {
    const executions: ExerciseExecution[] = [
      { date: '2026-01-01', exerciseId: 'bench', sets: [] },
      {
        date: '2026-01-08',
        exerciseId: 'bench',
        sets: [
          { weightKg: 100, reps: 5, rir: 2, order: 1 },
          { weightKg: 95, reps: 5, rir: 1, order: 2 },
        ],
      },
    ]

    const curve = buildSecondaryCurve(executions, 'bench')

    expect(curve).toHaveLength(1)
    expect(curve[0].date).toBe('2026-01-08')
  })

  it('ignore les exécutions d’un autre exerciseId', () => {
    const executions: ExerciseExecution[] = [
      {
        date: '2026-01-01',
        exerciseId: 'squat',
        sets: [
          { weightKg: 140, reps: 5, rir: 2, order: 1 },
          { weightKg: 135, reps: 5, rir: 1, order: 2 },
        ],
      },
      {
        date: '2026-01-08',
        exerciseId: 'bench',
        sets: [
          { weightKg: 100, reps: 5, rir: 2, order: 1 },
          { weightKg: 95, reps: 5, rir: 1, order: 2 },
        ],
      },
    ]

    const curve = buildSecondaryCurve(executions, 'bench')

    expect(curve).toHaveLength(1)
    expect(curve[0].date).toBe('2026-01-08')
    expect(curve[0].e1rm).toBeCloseTo(estimateE1rm(95, 5, 1))
  })

  it('moyenne les séries 2+ quel que soit leur ordre d’arrivée (entrée désordonnée)', () => {
    const executions: ExerciseExecution[] = [
      {
        date: '2026-01-01',
        exerciseId: 'bench',
        sets: [
          { weightKg: 90, reps: 5, rir: 0, order: 3 },
          { weightKg: 100, reps: 5, rir: 2, order: 1 }, // primaire, exclue
          { weightKg: 95, reps: 5, rir: 1, order: 2 },
        ],
      },
    ]

    const curve = buildSecondaryCurve(executions, 'bench')

    const expected = (estimateE1rm(95, 5, 1) + estimateE1rm(90, 5, 0)) / 2
    expect(curve[0].e1rm).toBeCloseTo(expected)
  })

  it('renvoie les points triés par date même si l’entrée est désordonnée', () => {
    const withSecondary = (date: string, w: number): ExerciseExecution => ({
      date,
      exerciseId: 'bench',
      sets: [
        { weightKg: w, reps: 5, rir: 2, order: 1 },
        { weightKg: w - 5, reps: 5, rir: 1, order: 2 },
      ],
    })
    const executions = [
      withSecondary('2026-01-15', 105),
      withSecondary('2026-01-01', 100),
      withSecondary('2026-01-08', 102),
    ]

    const curve = buildSecondaryCurve(executions, 'bench')

    expect(curve.map((point) => point.date)).toEqual([
      '2026-01-01',
      '2026-01-08',
      '2026-01-15',
    ])
  })

  it('renvoie [] pour une entrée vide', () => {
    expect(buildSecondaryCurve([], 'bench')).toEqual([])
  })
})
