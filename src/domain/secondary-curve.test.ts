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

  // --- Unilatéral : la moyenne porte sur le CÔTÉ FAIBLE des séries 2+ (ADR 0005),
  // pas sur l'e1RM moyen des deux côtés (qui noierait le déséquilibre).
  it('unilatéral : moyenne le CÔTÉ FAIBLE des séries 2+ (pas les e1RM des deux côtés)', () => {
    const executions: ExerciseExecution[] = [
      {
        date: '2026-01-01',
        exerciseId: 'curl',
        sets: [
          // 1ʳᵉ série (order 1) : exclue de la secondaire.
          { weightKg: 110, reps: 5, rir: 1, order: 1, side: 'left' },
          { weightKg: 100, reps: 5, rir: 1, order: 1, side: 'right' },
          // Série 2 : faible = D (85), fort = G (95).
          { weightKg: 95, reps: 5, rir: 1, order: 2, side: 'left' },
          { weightKg: 85, reps: 5, rir: 1, order: 2, side: 'right' },
          // Série 3 : faible = D (80), fort = G (90).
          { weightKg: 90, reps: 5, rir: 0, order: 3, side: 'left' },
          { weightKg: 80, reps: 5, rir: 0, order: 3, side: 'right' },
        ],
      },
    ]

    const curve = buildSecondaryCurve(executions, 'curl')

    // Moyenne des côtés faibles : (85x5@1 puis 80x5@0).
    const expected = (estimateE1rm(85, 5, 1) + estimateE1rm(80, 5, 0)) / 2
    expect(curve).toHaveLength(1)
    expect(curve[0].date).toBe('2026-01-01')
    expect(curve[0].e1rm).toBeCloseTo(expected)
  })

  it('unilatéral : côté faible apparié par order, insensible à l’ordre de saisie', () => {
    const executions: ExerciseExecution[] = [
      {
        date: '2026-01-01',
        exerciseId: 'curl',
        // Entrée volontairement désordonnée et côtés faibles saisis en 1er.
        sets: [
          { weightKg: 80, reps: 5, rir: 0, order: 3, side: 'right' },
          { weightKg: 100, reps: 5, rir: 1, order: 1, side: 'right' },
          { weightKg: 85, reps: 5, rir: 1, order: 2, side: 'right' },
          { weightKg: 90, reps: 5, rir: 0, order: 3, side: 'left' },
          { weightKg: 110, reps: 5, rir: 1, order: 1, side: 'left' },
          { weightKg: 95, reps: 5, rir: 1, order: 2, side: 'left' },
        ],
      },
    ]

    const curve = buildSecondaryCurve(executions, 'curl')

    const expected = (estimateE1rm(85, 5, 1) + estimateE1rm(80, 5, 0)) / 2
    expect(curve[0].e1rm).toBeCloseTo(expected)
  })

  it('unilatéral : un côté manquant sur une série 2+ retombe sur le côté présent', () => {
    const executions: ExerciseExecution[] = [
      {
        date: '2026-01-01',
        exerciseId: 'curl',
        sets: [
          { weightKg: 110, reps: 5, rir: 1, order: 1, side: 'left' },
          { weightKg: 100, reps: 5, rir: 1, order: 1, side: 'right' },
          // Série 2 incomplète : seul le côté gauche est loggé.
          { weightKg: 95, reps: 5, rir: 1, order: 2, side: 'left' },
        ],
      },
    ]

    const curve = buildSecondaryCurve(executions, 'curl')

    expect(curve).toHaveLength(1)
    expect(curve[0].e1rm).toBeCloseTo(estimateE1rm(95, 5, 1))
  })
})
