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

  it('départage deux exécutions au même jour par created_at, peu importe l’ordre d’entrée', () => {
    const older: ExerciseExecution = {
      date: '2026-01-17',
      createdAt: '2026-01-17T09:00:00Z',
      exerciseId: 'squat',
      sets: [{ weightKg: 100, reps: 5, rir: 2, order: 1 }],
    }
    const newer: ExerciseExecution = {
      date: '2026-01-17',
      createdAt: '2026-01-17T18:00:00Z',
      exerciseId: 'squat',
      sets: [{ weightKg: 110, reps: 5, rir: 1, order: 1 }],
    }
    const expected = [{ weightKg: 110, reps: 5, rir: 1, order: 1 }]

    // La plus récemment créée gagne, quel que soit l’ordre dans le tableau.
    expect(lastReference([older, newer], 'squat')).toEqual(expected)
    expect(lastReference([newer, older], 'squat')).toEqual(expected)
  })

  it('départage deux exécutions au même jour ET createdAt égal par id, peu importe l’ordre d’entrée', () => {
    // performed_on identique (granularité jour) ET created_at identique (timestamp
    // tronqué / import groupé) : sans tie-break final par id, l'ordre du tableau
    // décidait. L'id (UUID stable, ADR 0003) fige le choix entre deux chargements.
    const a: ExerciseExecution = {
      date: '2026-01-17',
      createdAt: '2026-01-17T10:00:00Z',
      id: 'exec-a',
      exerciseId: 'squat',
      sets: [{ weightKg: 100, reps: 5, rir: 2, order: 1 }],
    }
    const b: ExerciseExecution = {
      date: '2026-01-17',
      createdAt: '2026-01-17T10:00:00Z',
      id: 'exec-b',
      exerciseId: 'squat',
      sets: [{ weightKg: 110, reps: 5, rir: 1, order: 1 }],
    }
    // L'id le plus grand ('exec-b') gagne, quel que soit l'ordre dans le tableau.
    const expected = [{ weightKg: 110, reps: 5, rir: 1, order: 1 }]
    expect(lastReference([a, b], 'squat')).toEqual(expected)
    expect(lastReference([b, a], 'squat')).toEqual(expected)
  })

  // Note : deux exécutions sans `id` NI `createdAt` sont indiscernables (aucun
  // critère de départage) — cas absent en base (toute exécution porte un UUID) et
  // non satisfiable par construction (un reduce ne peut pas être ordre-indépendant
  // sans critère stable). Le départage par id à date+createdAt égaux est couvert
  // par le test ci-dessus.

  it('renvoie null si aucune exécution réelle de cet exo (liste vide ou que des trous)', () => {
    expect(lastReference([], 'squat')).toBeNull()

    const onlyHoles: ExerciseExecution[] = [
      { date: '2026-01-10', exerciseId: 'squat', sets: [] },
      { date: '2026-01-17', exerciseId: 'squat', sets: [] },
    ]
    expect(lastReference(onlyHoles, 'squat')).toBeNull()
  })
})
