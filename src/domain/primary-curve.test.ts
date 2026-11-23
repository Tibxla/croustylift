import { describe, it, expect } from 'vitest'
import { buildPrimaryCurve, curveUnit } from './primary-curve'
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
    expect(curve[0]!.date).toBe('2026-01-01')
    expect(curve[0]!.e1rm).toBeCloseTo(estimateE1rm(100, 5, 2))
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
    expect(curve[0]!.e1rm).toBeCloseTo(estimateE1rm(100, 5, 2))
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
    expect(curve[0]!.date).toBe('2026-01-08')
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
    expect(curve[0]!.date).toBe('2026-01-08')
    expect(curve[0]!.e1rm).toBeCloseTo(estimateE1rm(100, 5, 2))
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

  it('ordonne deux exécutions du même jour de façon STABLE (createdAt puis id), peu importe l’entrée', () => {
    // Même date (granularité jour) : sans tie-break, l'ordre du tableau d'entrée
    // décidait. On départage par createdAt, puis par id à createdAt égal.
    const morning: ExerciseExecution = {
      date: '2026-01-01',
      createdAt: '2026-01-01T09:00:00Z',
      id: 'exec-1',
      exerciseId: 'bench',
      sets: [{ weightKg: 100, reps: 5, rir: 2, order: 1 }],
    }
    const evening: ExerciseExecution = {
      date: '2026-01-01',
      createdAt: '2026-01-01T18:00:00Z',
      id: 'exec-2',
      exerciseId: 'bench',
      sets: [{ weightKg: 105, reps: 5, rir: 2, order: 1 }],
    }
    const expected = [estimateE1rm(100, 5, 2), estimateE1rm(105, 5, 2)]

    for (const input of [[morning, evening], [evening, morning]]) {
      const curve = buildPrimaryCurve(input, 'bench')
      expect(curve.map((p) => p.e1rm)).toEqual(
        expected.map((e) => expect.closeTo(e)),
      )
    }
  })

  it('ordonne par id quand date ET createdAt sont égaux', () => {
    const a: ExerciseExecution = {
      date: '2026-01-01',
      createdAt: '2026-01-01T09:00:00Z',
      id: 'exec-a',
      exerciseId: 'bench',
      sets: [{ weightKg: 100, reps: 5, rir: 2, order: 1 }],
    }
    const b: ExerciseExecution = {
      date: '2026-01-01',
      createdAt: '2026-01-01T09:00:00Z',
      id: 'exec-b',
      exerciseId: 'bench',
      sets: [{ weightKg: 105, reps: 5, rir: 2, order: 1 }],
    }
    // id 'exec-a' < 'exec-b' : a vient avant b, dans les deux ordres d'entrée.
    const expected = [estimateE1rm(100, 5, 2), estimateE1rm(105, 5, 2)]
    for (const input of [[a, b], [b, a]]) {
      const curve = buildPrimaryCurve(input, 'bench')
      expect(curve.map((p) => p.e1rm)).toEqual(
        expected.map((e) => expect.closeTo(e)),
      )
    }
  })

  it('ne fait fuiter ni createdAt ni id dans le point de sortie (E1rmPoint = { date, e1rm })', () => {
    const curve = buildPrimaryCurve(
      [
        {
          date: '2026-01-01',
          createdAt: '2026-01-01T09:00:00Z',
          id: 'exec-1',
          exerciseId: 'bench',
          sets: [{ weightKg: 100, reps: 5, rir: 2, order: 1 }],
        },
      ],
      'bench',
    )
    expect(Object.keys(curve[0]!).sort()).toEqual(['date', 'e1rm'])
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
    expect(curve[0]!.e1rm).toBeCloseTo(estimateE1rm(28, 10, 2))
    expect(curve[0]!.e1rm).toBeLessThan(estimateE1rm(32, 10, 2))
  })
})

// Exo au poids du corps saisi à 0 kg (ADR 0013, amendement du 2026-11-23).
describe('unité des courbes : reps effectives pour un exo jamais chargé', () => {
  const bodyweight = (date: string, reps: number, rir = 0): ExerciseExecution => ({
    date,
    exerciseId: 'tractions',
    sets: [{ weightKg: 0, reps, rir, order: 1 }],
  })

  it('curveUnit : reps tant qu’aucune série n’est chargée, kg dès la première charge', () => {
    const history = [bodyweight('2026-01-01', 8), bodyweight('2026-01-08', 9)]
    expect(curveUnit(history, 'tractions')).toBe('reps')
    const loaded: ExerciseExecution = {
      date: '2026-01-15',
      exerciseId: 'tractions',
      // La charge est sur la 2ᵉ série : elle suffit, on regarde TOUTES les séries.
      sets: [
        { weightKg: 0, reps: 9, rir: 0, order: 1 },
        { weightKg: 5, reps: 3, rir: 0, order: 2 },
      ],
    }
    expect(curveUnit([...history, loaded], 'tractions')).toBe('kg')
  })

  it('curveUnit : kg sans aucune série, et les autres exos ne comptent pas', () => {
    expect(curveUnit([], 'tractions')).toBe('kg')
    const other: ExerciseExecution = {
      date: '2026-01-01',
      exerciseId: 'bench',
      sets: [{ weightKg: 100, reps: 5, rir: 0, order: 1 }],
    }
    expect(curveUnit([bodyweight('2026-01-01', 8), other], 'tractions')).toBe('reps')
  })

  it('en reps, le point vaut les reps effectives de la 1ʳᵉ série (plus une courbe plate à 0)', () => {
    const curve = buildPrimaryCurve(
      [bodyweight('2026-01-01', 8), bodyweight('2026-01-08', 9, 2), bodyweight('2026-01-15', 12)],
      'tractions',
    )
    expect(curve).toEqual([
      { date: '2026-01-01', e1rm: 8 },
      { date: '2026-01-08', e1rm: 11 },
      { date: '2026-01-15', e1rm: 12 },
    ])
  })

  it('en reps, unilatéral : le côté faible est celui aux moindres reps effectives', () => {
    const curve = buildPrimaryCurve(
      [
        {
          date: '2026-01-01',
          exerciseId: 'pistol',
          sets: [
            { weightKg: 0, reps: 8, rir: 0, order: 1, side: 'left' },
            { weightKg: 0, reps: 6, rir: 1, order: 1, side: 'right' },
          ],
        },
      ],
      'pistol',
    )
    expect(curve).toEqual([{ date: '2026-01-01', e1rm: 7 }])
  })

  it('en kg, une exécution dont la 1ʳᵉ série est à 0 kg est un trou, pas un zéro', () => {
    const curve = buildPrimaryCurve(
      [
        bodyweight('2026-01-01', 12),
        { date: '2026-01-08', exerciseId: 'tractions', sets: [{ weightKg: 5, reps: 5, rir: 0, order: 1 }] },
        bodyweight('2026-01-15', 14),
        { date: '2026-01-22', exerciseId: 'tractions', sets: [{ weightKg: 7.5, reps: 5, rir: 0, order: 1 }] },
      ],
      'tractions',
    )
    expect(curve.map((p) => p.date)).toEqual(['2026-01-08', '2026-01-22'])
    expect(curve.every((p) => p.e1rm > 0)).toBe(true)
  })

  it('l’unité passée prime sur celle du sous-ensemble : une séance à 0 kg d’un exo chargé reste en kg', () => {
    // Le sous-ensemble (une séance) est tout à 0 kg, mais l'exo est chargé
    // ailleurs : pas de courbe en reps au milieu de courbes en kilos.
    expect(buildPrimaryCurve([bodyweight('2026-01-01', 12)], 'tractions', 'kg')).toEqual([])
  })
})
