import { describe, it, expect } from 'vitest'
import { summarizeSession } from './session-summary'
import type { RawLogEntry, RawLogSet } from './raw-log'

// Le récap d'une séance (en-tête du journal, cf. issue #32) agrège ce que la
// séance contient : nombre de SÉRIES LOGIQUES et total Σ poids×reps. En unilatéral
// (ADR 0005), les deux côtés G/D d'une série partagent un `order` et ne comptent
// qu'une série (le total Σ poids×reps cumule bien les deux). Les métadonnées (nom,
// durée, BPM) sont PORTÉES par l'entrée, pas calculées ; le récap ne fait que les
// exposer fidèlement, sans inventer une valeur manquante.

const set = (over: Partial<RawLogSet> = {}): RawLogSet => ({
  weightKg: 100,
  reps: 5,
  rir: 2,
  order: 1,
  ...over,
})

const entry = (over: Partial<RawLogEntry> = {}): RawLogEntry => ({
  executionId: 'e1',
  date: '2026-01-08',
  sessionName: 'Push A',
  bpmAvg: 130,
  durationMin: 62,
  exercises: [
    {
      exerciseId: 'bench',
      name: 'Développé couché',
      sets: [set({ weightKg: 100, reps: 5 }), set({ weightKg: 100, reps: 5, order: 2 })],
    },
  ],
  ...over,
})

describe('summarizeSession', () => {
  it('compte toutes les séries de tous les exos', () => {
    const summary = summarizeSession(
      entry({
        exercises: [
          { exerciseId: 'bench', name: 'B', sets: [set(), set({ order: 2 })] },
          { exerciseId: 'squat', name: 'S', sets: [set({ order: 1 })] },
        ],
      }),
    )
    expect(summary.setCount).toBe(3)
  })

  it('compte une série unilatérale une seule fois (les deux côtés au même order)', () => {
    // Exo unilatéral, 3 séries logiques = 6 lignes (G + D à chaque order, ADR 0005).
    const summary = summarizeSession(
      entry({
        exercises: [
          {
            exerciseId: 'curl',
            name: 'Curl haltère',
            sets: [
              set({ order: 1, side: 'left', weightKg: 14, reps: 10 }),
              set({ order: 1, side: 'right', weightKg: 16, reps: 10 }),
              set({ order: 2, side: 'left', weightKg: 14, reps: 9 }),
              set({ order: 2, side: 'right', weightKg: 16, reps: 9 }),
              set({ order: 3, side: 'left', weightKg: 12, reps: 8 }),
              set({ order: 3, side: 'right', weightKg: 14, reps: 8 }),
            ],
          },
        ],
      }),
    )
    expect(summary.setCount).toBe(3)
    // Le total Σ poids×reps cumule bien LES DEUX côtés de chaque série :
    // (14+16)*10 + (14+16)*9 + (12+14)*8 = 300 + 270 + 208 = 778.
    expect(summary.totalVolumeKg).toBe(778)
  })

  it('somme le volume Σ poids×reps de toutes les séries', () => {
    const summary = summarizeSession(
      entry({
        exercises: [
          {
            exerciseId: 'bench',
            name: 'B',
            sets: [set({ weightKg: 100, reps: 5 }), set({ weightKg: 80, reps: 8, order: 2 })],
          },
          { exerciseId: 'squat', name: 'S', sets: [set({ weightKg: 140, reps: 5 })] },
        ],
      }),
    )
    // 100*5 + 80*8 + 140*5 = 500 + 640 + 700 = 1840
    expect(summary.totalVolumeKg).toBe(1840)
  })

  it('expose nom, date, durée et BPM tels quels quand ils sont saisis', () => {
    const summary = summarizeSession(
      entry({ sessionName: 'Push A', date: '2026-01-08', durationMin: 62, bpmAvg: 130 }),
    )
    expect(summary.sessionName).toBe('Push A')
    expect(summary.date).toBe('2026-01-08')
    expect(summary.durationMin).toBe(62)
    expect(summary.bpmAvg).toBe(130)
  })

  it('garde null une métrique manquante (pas de récap trompeur)', () => {
    const summary = summarizeSession(
      entry({ sessionName: null, bpmAvg: null, durationMin: null }),
    )
    expect(summary.sessionName).toBeNull()
    expect(summary.bpmAvg).toBeNull()
    expect(summary.durationMin).toBeNull()
  })

  it('compte 0 série et 0 volume pour une séance sans exo', () => {
    const summary = summarizeSession(entry({ exercises: [] }))
    expect(summary.setCount).toBe(0)
    expect(summary.totalVolumeKg).toBe(0)
  })
})
