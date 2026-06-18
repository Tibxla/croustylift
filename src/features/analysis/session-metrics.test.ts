import { describe, it, expect } from 'vitest'
import { buildSessionMetrics, type RawExecutionMetric } from './session-metrics'

// BPM moyen + durée de séance dans le temps (cf. issue #28, brainstorm-intent.md
// §4 « BPM et durée affichés sur le même graphe »). On dérive des points à partir
// des executions ; un point n'existe que si AU MOINS une des deux métriques est
// présente (les deux sont optionnelles : durée auto-chronométrée, BPM manuel).

const exec = (over: Partial<RawExecutionMetric> = {}): RawExecutionMetric => ({
  date: '2026-01-08',
  bpmAvg: 130,
  durationMin: 60,
  ...over,
})

describe('buildSessionMetrics', () => {
  it('dérive un point par exécution ayant au moins une métrique', () => {
    const points = buildSessionMetrics([
      exec({ date: '2026-01-08', bpmAvg: 132, durationMin: 58 }),
    ])

    expect(points).toEqual([{ date: '2026-01-08', bpmAvg: 132, durationMin: 58 }])
  })

  it('garde un point avec une seule des deux métriques (l’autre à null)', () => {
    const points = buildSessionMetrics([
      exec({ date: '2026-01-08', bpmAvg: 140, durationMin: null }),
      exec({ date: '2026-01-09', bpmAvg: null, durationMin: 45 }),
    ])

    expect(points).toEqual([
      { date: '2026-01-08', bpmAvg: 140, durationMin: null },
      { date: '2026-01-09', bpmAvg: null, durationMin: 45 },
    ])
  })

  it('ignore une exécution sans aucune métrique (trou, pas un zéro)', () => {
    const points = buildSessionMetrics([
      exec({ date: '2026-01-08', bpmAvg: null, durationMin: null }),
      exec({ date: '2026-01-09', bpmAvg: 120, durationMin: 50 }),
    ])

    expect(points.map((p) => p.date)).toEqual(['2026-01-09'])
  })

  it('trie les points par date croissante (axe temporel)', () => {
    const points = buildSessionMetrics([
      exec({ date: '2026-01-15' }),
      exec({ date: '2026-01-01' }),
      exec({ date: '2026-01-08' }),
    ])

    expect(points.map((p) => p.date)).toEqual([
      '2026-01-01',
      '2026-01-08',
      '2026-01-15',
    ])
  })

  it('renvoie [] quand aucune exécution n’a de métrique (pas de graphe)', () => {
    const points = buildSessionMetrics([
      exec({ bpmAvg: null, durationMin: null }),
    ])

    expect(points).toEqual([])
  })

  it('renvoie [] pour une entrée vide', () => {
    expect(buildSessionMetrics([])).toEqual([])
  })
})
