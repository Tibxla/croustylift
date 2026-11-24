import { describe, expect, it } from 'vitest'
import type { ExerciseExecution } from '../../domain/types'
import { buildPrimaryCurve } from '../../domain/primary-curve'
import { exerciseFacts, gapBreaks, pointExecutions, secondaryBreaks } from './point-detail'

const ex = (id: string, date: string, w: number, seanceId = 's', createdAt?: string): ExerciseExecution => ({
  id,
  date,
  createdAt,
  seanceId,
  exerciseId: 'x',
  sets: [
    { weightKg: w, reps: 5, rir: 2, order: 1 },
    { weightKg: w - 10, reps: 8, rir: 1, order: 2 },
  ],
})

describe('pointExecutions', () => {
  it('aligne chaque point de la courbe sur son exécution, même jour compris', () => {
    const execs = [ex('b', '2026-11-02', 100, 's', '2026-11-02T18:00'), ex('a', '2026-11-02', 90, 's', '2026-11-02T09:00'), ex('c', '2026-11-01', 80), ex('z', '2026-11-03', 70, 'autre')]
    const aligned = pointExecutions(execs, 'x', 's', 'kg')
    const curve = buildPrimaryCurve(execs.filter((e) => e.seanceId === 's'), 'x', 'kg')
    expect(aligned.map((e) => e.id)).toEqual(['c', 'a', 'b'])
    expect(aligned.length).toBe(curve.length)
  })

  it('saute une exécution à 0 kg sur une courbe en kilos (un trou, pas un point)', () => {
    const execs = [ex('a', '2026-11-01', 80), ex('b', '2026-11-02', 0), ex('c', '2026-11-03', 85)]
    expect(pointExecutions(execs, 'x', 's', 'kg').map((e) => e.id)).toEqual(['a', 'c'])
  })
})

describe('exerciseFacts', () => {
  it('date le record et la charge la plus lourde', () => {
    const f = exerciseFacts([ex('a', '2026-11-01', 80), ex('b', '2026-11-05', 100), ex('c', '2026-11-09', 90)], 'x', 'kg')
    expect(f.record?.set).toEqual({ weightKg: 100, reps: 5, rir: 2 })
    expect(f.record?.date).toBe('2026-11-05')
    expect(f.heaviest).toEqual({ weightKg: 100, reps: 5, date: '2026-11-05' })
  })
})

describe('coupures du trait', () => {
  it('coupe après une pause de plus de trois semaines', () => {
    const c = [{ date: '2026-10-01', e1rm: 1 }, { date: '2026-10-20', e1rm: 1 }, { date: '2026-11-20', e1rm: 1 }]
    expect(gapBreaks(c)).toEqual([false, false, true])
  })
  it('coupe les séries 2+ quand une séance n’en a pas eu', () => {
    const primary = [{ date: '2026-11-01', e1rm: 1 }, { date: '2026-11-03', e1rm: 1 }, { date: '2026-11-05', e1rm: 1 }]
    const secondary = [{ date: '2026-11-01', e1rm: 1 }, { date: '2026-11-05', e1rm: 1 }]
    expect(secondaryBreaks(secondary, primary)).toEqual([false, true])
  })
})
