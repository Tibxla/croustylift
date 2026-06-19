import { describe, it, expect } from 'vitest'
import { buildConfigTimeline } from './config-timeline'
import { detectBlocks } from '../../domain/block'
import type { ActivationRow, SeanceVersionRow, SeanceRow } from './config-timeline'

// Helpers : un jeu d'entrées minimal, surchargeable champ par champ.
function input(over: {
  activations?: ActivationRow[]
  seanceVersions?: SeanceVersionRow[]
  seances?: SeanceRow[]
}) {
  return {
    activations: over.activations ?? [],
    seanceVersions: over.seanceVersions ?? [],
    seances: over.seances ?? [],
  }
}

describe('buildConfigTimeline', () => {
  it('retourne [] quand rien ne s\'est passé', () => {
    expect(buildConfigTimeline(input({}))).toEqual([])
  })

  it('une activation seule donne un changement, daté du jour de activated_at', () => {
    const timeline = buildConfigTimeline(
      input({
        activations: [{ activatedAt: '2026-01-05T09:30:00Z', routineId: 'R1' }],
      }),
    )
    expect(timeline).toHaveLength(1)
    expect(timeline[0]!.date).toBe('2026-01-05')
  })

  it('deux routines différentes donnent deux configs distinctes', () => {
    const timeline = buildConfigTimeline(
      input({
        activations: [
          { activatedAt: '2026-01-01T08:00:00Z', routineId: 'R1' },
          { activatedAt: '2026-02-01T08:00:00Z', routineId: 'R2' },
        ],
      }),
    )
    expect(timeline.map((c) => c.date)).toEqual(['2026-01-01', '2026-02-01'])
    expect(timeline[0]!.configId).not.toBe(timeline[1]!.configId)
  })

  it('réactiver la routine déjà courante ne change pas la config', () => {
    // Même routineId réactivée : aucun changement réel de plan -> même configId,
    // que detectBlocks fusionnera en un seul bloc.
    const timeline = buildConfigTimeline(
      input({
        activations: [
          { activatedAt: '2026-01-01T08:00:00Z', routineId: 'R1' },
          { activatedAt: '2026-01-15T08:00:00Z', routineId: 'R1' },
        ],
      }),
    )
    expect(timeline[0]!.configId).toBe(timeline[1]!.configId)
    expect(detectBlocks(timeline)).toEqual([
      { configId: timeline[0]!.configId, start: '2026-01-01', end: null },
    ])
  })

  it('une nouvelle version d\'une séance de la routine courante change la config', () => {
    const timeline = buildConfigTimeline(
      input({
        activations: [{ activatedAt: '2026-01-01T08:00:00Z', routineId: 'R1' }],
        seances: [{ id: 'S1', routineId: 'R1' }],
        seanceVersions: [{ createdAt: '2026-01-20T08:00:00Z', seanceId: 'S1' }],
      }),
    )
    expect(timeline.map((c) => c.date)).toEqual(['2026-01-01', '2026-01-20'])
    expect(timeline[0]!.configId).not.toBe(timeline[1]!.configId)
  })

  it('une version d\'une séance hors routine courante est ignorée', () => {
    // S2 appartient à R2, qui n'est pas la routine courante (R1) : éditer S2
    // n'altère pas le template actif -> aucun changement de config.
    const timeline = buildConfigTimeline(
      input({
        activations: [{ activatedAt: '2026-01-01T08:00:00Z', routineId: 'R1' }],
        seances: [
          { id: 'S1', routineId: 'R1' },
          { id: 'S2', routineId: 'R2' },
        ],
        seanceVersions: [{ createdAt: '2026-01-20T08:00:00Z', seanceId: 'S2' }],
      }),
    )
    expect(timeline.map((c) => c.date)).toEqual(['2026-01-01'])
  })

  it('une version dont la séance est inconnue est ignorée (garde-fou)', () => {
    const timeline = buildConfigTimeline(
      input({
        activations: [{ activatedAt: '2026-01-01T08:00:00Z', routineId: 'R1' }],
        seances: [{ id: 'S1', routineId: 'R1' }],
        seanceVersions: [{ createdAt: '2026-01-20T08:00:00Z', seanceId: 'INCONNUE' }],
      }),
    )
    expect(timeline.map((c) => c.date)).toEqual(['2026-01-01'])
  })

  it('une version de séance avant toute activation est ignorée (pas de routine courante)', () => {
    const timeline = buildConfigTimeline(
      input({
        activations: [{ activatedAt: '2026-02-01T08:00:00Z', routineId: 'R1' }],
        seances: [{ id: 'S1', routineId: 'R1' }],
        seanceVersions: [{ createdAt: '2026-01-01T08:00:00Z', seanceId: 'S1' }],
      }),
    )
    expect(timeline.map((c) => c.date)).toEqual(['2026-02-01'])
  })

  it('trie les événements dans le temps même si l\'entrée est désordonnée', () => {
    const timeline = buildConfigTimeline(
      input({
        activations: [
          { activatedAt: '2026-03-01T08:00:00Z', routineId: 'R2' },
          { activatedAt: '2026-01-01T08:00:00Z', routineId: 'R1' },
        ],
        seances: [{ id: 'S1', routineId: 'R1' }],
        seanceVersions: [{ createdAt: '2026-02-01T08:00:00Z', seanceId: 'S1' }],
      }),
    )
    expect(timeline.map((c) => c.date)).toEqual([
      '2026-01-01',
      '2026-02-01',
      '2026-03-01',
    ])
  })

  it('départage par timestamp puis applique l\'activation avant la version au même instant', () => {
    // Au même horodatage exact, l'activation de routine doit s'appliquer d'abord
    // pour que la version de S1 (séance de R1) compte dans la config courante.
    const ts = '2026-01-01T08:00:00Z'
    const timeline = buildConfigTimeline(
      input({
        activations: [{ activatedAt: ts, routineId: 'R1' }],
        seances: [{ id: 'S1', routineId: 'R1' }],
        seanceVersions: [{ createdAt: ts, seanceId: 'S1' }],
      }),
    )
    // Deux événements le même jour, états successifs distincts.
    expect(timeline).toHaveLength(2)
    expect(timeline[0]!.configId).not.toBe(timeline[1]!.configId)
    expect(timeline.every((c) => c.date === '2026-01-01')).toBe(true)
  })

  it('le configId revient à l\'identique quand la config retrouve un état déjà vu', () => {
    // R1 -> R2 -> R1 : le 3ᵉ état est identique au 1ᵉʳ (R1 sans version éditée).
    const timeline = buildConfigTimeline(
      input({
        activations: [
          { activatedAt: '2026-01-01T08:00:00Z', routineId: 'R1' },
          { activatedAt: '2026-02-01T08:00:00Z', routineId: 'R2' },
          { activatedAt: '2026-03-01T08:00:00Z', routineId: 'R1' },
        ],
      }),
    )
    expect(timeline[0]!.configId).toBe(timeline[2]!.configId)
    expect(timeline[0]!.configId).not.toBe(timeline[1]!.configId)
  })

  it('bout-en-bout : detectBlocks dérive les blocs des changements de config', () => {
    const timeline = buildConfigTimeline(
      input({
        activations: [
          { activatedAt: '2026-01-01T08:00:00Z', routineId: 'R1' },
          { activatedAt: '2026-03-01T08:00:00Z', routineId: 'R2' },
        ],
        seances: [{ id: 'S1', routineId: 'R1' }],
        seanceVersions: [{ createdAt: '2026-02-01T08:00:00Z', seanceId: 'S1' }],
      }),
    )
    const blocks = detectBlocks(timeline)
    expect(blocks.map((b) => [b.start, b.end])).toEqual([
      ['2026-01-01', '2026-02-01'],
      ['2026-02-01', '2026-03-01'],
      ['2026-03-01', null],
    ])
  })
})
