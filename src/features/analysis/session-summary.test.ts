import { describe, it, expect } from 'vitest'
import { summarizeSession } from './session-summary'
import type { RawLogEntry, RawLogSet } from './raw-log'
import { countPerformedSets } from '../../domain/set-count'

// Le récap d'une séance (en-tête du journal, cf. issue #32) agrège ce que la
// séance contient : son DÉCOMPTE DE SÉRIES (celui de la Clôture, ADR 0006 :
// pondéré par les reps, une série unilatérale compte 2) et ses kg soulevés
// (Σ poids×reps, les deux côtés). Les métadonnées (nom,
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
  routineName: 'PPL',
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

  it('compte une série unilatérale pour 2 au total de la séance (les deux côtés)', () => {
    // Exo unilatéral, 3 séries = 6 lignes (G + D à chaque order, ADR 0005) : le
    // décompte de la séance vaut 6, comme à la Clôture (décision du 2026-11-23).
    // Ce test affirmait 3 (séries logiques) avant la décision.
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
    expect(summary.setCount).toBe(6)
    // Le total Σ poids×reps cumule bien LES DEUX côtés de chaque série :
    // (14+16)*10 + (14+16)*9 + (12+14)*8 = 300 + 270 + 208 = 778.
    expect(summary.totalLiftedKg).toBe(778)
  })

  it('somme les kg soulevés (Σ poids×reps) de toutes les séries', () => {
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
    expect(summary.totalLiftedKg).toBe(1840)
  })

  it('expose nom, date, durée et BPM tels quels quand ils sont saisis', () => {
    const summary = summarizeSession(
      entry({ sessionName: 'Push A', date: '2026-01-08', durationMin: 62, bpmAvg: 130 }),
    )
    expect(summary.sessionName).toBe('Push A')
    expect(summary.routineName).toBe('PPL')
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

  it('compte 0 série et 0 kg soulevé pour une séance sans exo', () => {
    const summary = summarizeSession(entry({ exercises: [] }))
    expect(summary.setCount).toBe(0)
    expect(summary.totalLiftedKg).toBe(0)
  })

  // Journal et Clôture : le même nombre pour la même séance (décision du
  // 2026-11-23). La Clôture passe par `countPerformedSets` avec le drapeau
  // unilatéral de l'exo (capture/summary.ts) ; le Journal par la même fonction,
  // le drapeau déduit du côté des lignes.
  describe('même décompte que la Clôture', () => {
    const unilateral = [
      set({ order: 1, side: 'left', reps: 10 }),
      set({ order: 1, side: 'right', reps: 10 }),
      set({ order: 2, side: 'left', reps: 10 }),
      set({ order: 2, side: 'right', reps: 10 }),
    ]
    const bilateral = [
      set({ order: 1, reps: 3 }),
      set({ order: 2, reps: 3 }),
      set({ order: 3, reps: 3 }),
    ]
    /** Le total affiché en fin de séance pour ces deux exos. */
    const closing = (uni: RawLogSet[], bi: RawLogSet[]) =>
      countPerformedSets([
        { unilateral: true, primaryMuscles: ['biceps'], sets: uni },
        { unilateral: false, primaryMuscles: ['pectoraux'], sets: bi },
      ]).total
    const journal = (uni: RawLogSet[], bi: RawLogSet[]) =>
      summarizeSession(
        entry({
          exercises: [
            { exerciseId: 'curl', name: 'Curl', sets: uni },
            { exerciseId: 'bench', name: 'Bench', sets: bi },
          ],
        }),
      ).setCount

    it('2 séries unilatérales de 10 reps et 3 bilatérales de 3 reps : 5,8 des deux côtés', () => {
      expect(journal(unilateral, bilateral)).toBeCloseTo(5.8, 10)
      expect(journal(unilateral, bilateral)).toBe(closing(unilateral, bilateral))
    })

    it('un côté seul (série unilatérale entamée) compte pareil des deux côtés', () => {
      const oneSide = unilateral.slice(0, 3)
      expect(journal(oneSide, bilateral)).toBe(closing(oneSide, bilateral))
      expect(journal(oneSide, [])).toBe(3)
    })

    it('les séries courtes sont pondérées par leurs reps (3 reps = 0,6)', () => {
      expect(journal([], bilateral)).toBeCloseTo(1.8, 10)
    })
  })
})
