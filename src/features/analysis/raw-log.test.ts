import { describe, it, expect } from 'vitest'
import { buildRawLog, type RawLogRow, type RawLogSet } from './raw-log'

// Le log brut regroupe les séries réellement loggées par EXÉCUTION (une séance un
// jour donné), et dans chaque exécution par EXO, en gardant poids × reps × RIR.
// On vérifie le regroupement, les tris et le report des métadonnées de séance
// (nom/BPM/durée), pas l'estimation e1RM (vue ailleurs).

const set = (over: Partial<RawLogSet> = {}): RawLogSet => ({
  weightKg: 100,
  reps: 5,
  rir: 2,
  order: 1,
  ...over,
})

const row = (over: Partial<RawLogRow> = {}): RawLogRow => ({
  executionId: 'e1',
  date: '2026-01-08',
  exerciseId: 'bench',
  exerciseName: 'Développé couché',
  sessionName: 'Push A',
  bpmAvg: 130,
  durationMin: 62,
  set: set(),
  ...over,
})

describe('buildRawLog', () => {
  it('regroupe les séries par exécution puis par exo', () => {
    const log = buildRawLog([
      row({ exerciseId: 'bench', exerciseName: 'Développé couché', set: set({ order: 1 }) }),
      row({ exerciseId: 'bench', exerciseName: 'Développé couché', set: set({ rir: 1, order: 2 }) }),
      row({ exerciseId: 'squat', exerciseName: 'Squat', set: set({ weightKg: 140, order: 1 }) }),
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

  it('reporte les métadonnées de séance (nom, BPM, durée) sur l’entrée', () => {
    const log = buildRawLog([
      row({ sessionName: 'Pull B', bpmAvg: 128, durationMin: 55, set: set({ order: 1 }) }),
      row({ sessionName: 'Pull B', bpmAvg: 128, durationMin: 55, set: set({ order: 2 }) }),
    ])

    expect(log[0].sessionName).toBe('Pull B')
    expect(log[0].bpmAvg).toBe(128)
    expect(log[0].durationMin).toBe(55)
  })

  it('garde null les métadonnées manquantes', () => {
    const log = buildRawLog([
      row({ sessionName: null, bpmAvg: null, durationMin: null }),
    ])

    expect(log[0].sessionName).toBeNull()
    expect(log[0].bpmAvg).toBeNull()
    expect(log[0].durationMin).toBeNull()
  })

  it('trie les exécutions par date décroissante (plus récente en tête)', () => {
    const log = buildRawLog([
      row({ executionId: 'old', date: '2026-01-01' }),
      row({ executionId: 'mid', date: '2026-01-08' }),
      row({ executionId: 'new', date: '2026-01-15' }),
    ])

    expect(log.map((entry) => entry.executionId)).toEqual(['new', 'mid', 'old'])
  })

  it('trie les séries de chaque exo par order croissant', () => {
    const log = buildRawLog([
      row({ set: set({ order: 3 }) }),
      row({ set: set({ order: 1 }) }),
      row({ set: set({ order: 2 }) }),
    ])

    expect(log[0].exercises[0].sets.map((s) => s.order)).toEqual([1, 2, 3])
  })

  it('trie les exos d’une exécution par nom (locale fr)', () => {
    const log = buildRawLog([
      row({ exerciseId: 'z', exerciseName: 'Élévations' }),
      row({ exerciseId: 'a', exerciseName: 'Curl' }),
    ])

    expect(log[0].exercises.map((e) => e.name)).toEqual(['Curl', 'Élévations'])
  })

  it('renvoie [] pour une entrée vide', () => {
    expect(buildRawLog([])).toEqual([])
  })
})
