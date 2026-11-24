import { describe, expect, it } from 'vitest'
import type { ExerciseAnalysis, SeanceCurve } from './data'
import { leadCurve, summarizeRoutine } from './exercise-reading'

function curve(seanceId: string, weeklyRate: number | null, sessions: number): SeanceCurve {
  return {
    seanceId,
    seanceName: seanceId,
    routineName: 'R',
    label: seanceId,
    curve: [{ date: '2026-11-01', e1rm: 100 }],
    secondaryCurve: [],
    weeklyRate,
    ratePeriod: { since: '2026-11-01', sessions },
    lastDate: '2026-11-01',
  }
}

function exo(id: string, curves: SeanceCurve[]): ExerciseAnalysis {
  return { exerciseId: id, name: id.toUpperCase(), seanceCurves: curves, unit: 'kg', zeroLoadHoles: 0 }
}

const lead = (a: ExerciseAnalysis) => leadCurve(a, new Set())

describe('summarizeRoutine', () => {
  it('ne compte que les exos du plan, et juge chacun sur sa courbe en tête', () => {
    const analyses = [
      exo('squat', [curve('a', 1.2, 4)]),
      exo('dips', [curve('a', 0.1, 3)]),
      exo('curl', [curve('a', -2, 5)]),
      exo('ancien', [curve('z', 3, 6)]),
    ]
    const s = summarizeRoutine(analyses, ['squat', 'dips', 'curl'], lead)
    expect(s.counts).toEqual({ up: 1, eq: 1, down: 1 })
    expect(s.thin).toEqual([])
    expect(s.notYet).toBe(0)
    expect(s.period).toEqual({ since: '2026-11-01', sessions: 4 })
  })

  it('sépare « trop peu pour une pente » de « pas encore fait dans le bloc »', () => {
    const analyses = [exo('squat', [curve('a', null, 2)]), exo('dips', [curve('a', null, 0)])]
    const s = summarizeRoutine(analyses, ['squat', 'dips', 'jamais'], lead)
    expect(s.thin).toEqual(['SQUAT'])
    // dips : fait avant le bloc seulement ; jamais : aucune série.
    expect(s.notYet).toBe(2)
  })

  it('lit la courbe affichée en tête quand la plus récente est masquée', () => {
    const a = exo('squat', [curve('a', -3, 4), curve('b', 2, 4)])
    expect(leadCurve(a, new Set(['a']))?.seanceId).toBe('b')
    expect(summarizeRoutine([a], ['squat'], (x) => leadCurve(x, new Set(['a']))).counts.up).toBe(1)
  })
})
