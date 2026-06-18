import { describe, it, expect } from 'vitest'
import { buildRawLog, type RawLogSet } from './raw-log'

// Le log brut regroupe les séries réellement loggées par EXÉCUTION (une séance un
// jour donné), et dans chaque exécution par EXO, en gardant poids × reps × RIR.
// On vérifie le regroupement et les tris, pas l'estimation e1RM (vue ailleurs).

const set = (over: Partial<RawLogSet> = {}): RawLogSet => ({
  weightKg: 100,
  reps: 5,
  rir: 2,
  order: 1,
  ...over,
})

describe('buildRawLog', () => {
  it('regroupe les séries par exécution puis par exo', () => {
    const log = buildRawLog([
      {
        executionId: 'e1',
        date: '2026-01-08',
        exerciseId: 'bench',
        exerciseName: 'Développé couché',
        set: set({ weightKg: 100, reps: 5, rir: 2, order: 1 }),
      },
      {
        executionId: 'e1',
        date: '2026-01-08',
        exerciseId: 'bench',
        exerciseName: 'Développé couché',
        set: set({ weightKg: 100, reps: 5, rir: 1, order: 2 }),
      },
      {
        executionId: 'e1',
        date: '2026-01-08',
        exerciseId: 'squat',
        exerciseName: 'Squat',
        set: set({ weightKg: 140, reps: 5, rir: 2, order: 1 }),
      },
    ])

    expect(log).toHaveLength(1)
    expect(log[0].executionId).toBe('e1')
    expect(log[0].date).toBe('2026-01-08')
    expect(log[0].exercises).toHaveLength(2)
    const bench = log[0].exercises.find((e) => e.exerciseId === 'bench')!
    expect(bench.name).toBe('Développé couché')
    expect(bench.sets).toHaveLength(2)
    const squat = log[0].exercises.find((e) => e.exerciseId === 'squat')!
    expect(squat.sets).toHaveLength(1)
  })

  it('trie les exécutions par date décroissante (plus récente en tête)', () => {
    const log = buildRawLog([
      { executionId: 'old', date: '2026-01-01', exerciseId: 'bench', exerciseName: 'B', set: set() },
      { executionId: 'mid', date: '2026-01-08', exerciseId: 'bench', exerciseName: 'B', set: set() },
      { executionId: 'new', date: '2026-01-15', exerciseId: 'bench', exerciseName: 'B', set: set() },
    ])

    expect(log.map((entry) => entry.executionId)).toEqual(['new', 'mid', 'old'])
  })

  it('trie les séries de chaque exo par order croissant', () => {
    const log = buildRawLog([
      { executionId: 'e1', date: '2026-01-08', exerciseId: 'bench', exerciseName: 'B', set: set({ order: 3 }) },
      { executionId: 'e1', date: '2026-01-08', exerciseId: 'bench', exerciseName: 'B', set: set({ order: 1 }) },
      { executionId: 'e1', date: '2026-01-08', exerciseId: 'bench', exerciseName: 'B', set: set({ order: 2 }) },
    ])

    expect(log[0].exercises[0].sets.map((s) => s.order)).toEqual([1, 2, 3])
  })

  it('trie les exos d’une exécution par nom (locale fr)', () => {
    const log = buildRawLog([
      { executionId: 'e1', date: '2026-01-08', exerciseId: 'z', exerciseName: 'Élévations', set: set() },
      { executionId: 'e1', date: '2026-01-08', exerciseId: 'a', exerciseName: 'Curl', set: set() },
    ])

    expect(log[0].exercises.map((e) => e.name)).toEqual(['Curl', 'Élévations'])
  })

  it('renvoie [] pour une entrée vide', () => {
    expect(buildRawLog([])).toEqual([])
  })
})
