import { describe, it, expect } from 'vitest'
import type { ExerciseExecution } from './types'
import { lastReference } from './reference'

describe('lastReference', () => {
  it('renvoie les séries de l’exécution non vide la plus récente', () => {
    const executions: ExerciseExecution[] = [
      {
        date: '2026-01-10',
        exerciseId: 'squat',
        sets: [{ weightKg: 100, reps: 5, rir: 2, order: 1 }],
      },
      {
        date: '2026-01-17',
        exerciseId: 'squat',
        sets: [{ weightKg: 105, reps: 5, rir: 1, order: 1 }],
      },
    ]

    expect(lastReference(executions, 'squat')).toEqual([
      { weightKg: 105, reps: 5, rir: 1, order: 1 },
    ])
  })

  it('saute une exécution vide plus récente et renvoie la dernière exécution réelle d’avant', () => {
    const executions: ExerciseExecution[] = [
      {
        date: '2026-01-10',
        exerciseId: 'squat',
        sets: [{ weightKg: 100, reps: 5, rir: 2, order: 1 }],
      },
      {
        date: '2026-01-17',
        exerciseId: 'squat',
        sets: [],
      },
    ]

    expect(lastReference(executions, 'squat')).toEqual([
      { weightKg: 100, reps: 5, rir: 2, order: 1 },
    ])
  })

  it('filtre par exerciseId et ignore les autres exos', () => {
    const executions: ExerciseExecution[] = [
      {
        date: '2026-01-10',
        exerciseId: 'squat',
        sets: [{ weightKg: 100, reps: 5, rir: 2, order: 1 }],
      },
      {
        date: '2026-01-17',
        exerciseId: 'bench',
        sets: [{ weightKg: 80, reps: 5, rir: 1, order: 1 }],
      },
    ]

    expect(lastReference(executions, 'squat')).toEqual([
      { weightKg: 100, reps: 5, rir: 2, order: 1 },
    ])
  })

  it('renvoie les séries triées par order même si stockées dans le désordre', () => {
    const executions: ExerciseExecution[] = [
      {
        date: '2026-01-10',
        exerciseId: 'squat',
        sets: [
          { weightKg: 100, reps: 5, rir: 2, order: 3 },
          { weightKg: 100, reps: 5, rir: 2, order: 1 },
          { weightKg: 100, reps: 5, rir: 2, order: 2 },
        ],
      },
    ]

    expect(lastReference(executions, 'squat')).toEqual([
      { weightKg: 100, reps: 5, rir: 2, order: 1 },
      { weightKg: 100, reps: 5, rir: 2, order: 2 },
      { weightKg: 100, reps: 5, rir: 2, order: 3 },
    ])
  })

  it('renvoie null si aucune exécution réelle de cet exo (liste vide ou que des trous)', () => {
    expect(lastReference([], 'squat')).toBeNull()

    const onlyHoles: ExerciseExecution[] = [
      { date: '2026-01-10', exerciseId: 'squat', sets: [] },
      { date: '2026-01-17', exerciseId: 'squat', sets: [] },
    ]
    expect(lastReference(onlyHoles, 'squat')).toBeNull()
  })
})
