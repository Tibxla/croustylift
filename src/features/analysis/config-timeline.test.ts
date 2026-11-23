import { describe, it, expect } from 'vitest'
import { buildConfigTimeline as buildWithLocalDay, localIsoDay } from './config-timeline'
import { detectBlocks } from '../../domain/block'
import { summarizeBlockSeances } from '../../domain/block-comparison'
import type { ExerciseExecution } from '../../domain/types'
import type {
  ActivationRow,
  ConfigTimelineInput,
  SeanceArchiveEventRow,
  SeanceVersionRow,
  SeanceRow,
} from './config-timeline'

// Le jour d'un changement est son jour LOCAL. Les tests injectent une conversion
// fixe pour ne pas dépendre du fuseau de la machine (Paris ici, UTC en CI).
const utcDay = (ts: string) => new Date(ts).toISOString().slice(0, 10)
/** Paris en heure d'été (UTC+2), sans dépendre du fuseau du processus. */
const parisSummerDay = (ts: string) =>
  new Date(Date.parse(ts) + 2 * 3600_000).toISOString().slice(0, 10)
const buildConfigTimeline = (i: ConfigTimelineInput, toDay = utcDay) =>
  buildWithLocalDay(i, toDay)

// Helpers : un jeu d'entrées minimal, surchargeable champ par champ.
function input(over: {
  activations?: ActivationRow[]
  seanceVersions?: SeanceVersionRow[]
  seances?: SeanceRow[]
  seanceArchiveEvents?: SeanceArchiveEventRow[]
}) {
  return {
    activations: over.activations ?? [],
    seanceVersions: over.seanceVersions ?? [],
    seances: over.seances ?? [],
    seanceArchiveEvents: over.seanceArchiveEvents ?? [],
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
      {
        configId: timeline[0]!.configId,
        start: '2026-01-01',
        end: null,
        startAt: '2026-01-01T08:00:00Z',
      },
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

// --- Archivage de séance (ADR 0017) ------------------------------------------
//
// Archiver une séance de la routine courante change la configuration du
// template : c'est un changement de plan, il coupe un bloc. Le journal daté des
// archivages est rejoué dans l'ordre, pour que désarchiver ne réécrive jamais
// les blocs passés.

describe('buildConfigTimeline — archivage de séance', () => {
  const seances = [
    { id: 'S1', routineId: 'R1' },
    { id: 'S2', routineId: 'R1' },
    { id: 'S3', routineId: 'R2' },
  ]

  it('archiver une séance de la routine courante coupe un bloc', () => {
    const timeline = buildConfigTimeline(
      input({
        activations: [{ activatedAt: '2026-01-01T08:00:00Z', routineId: 'R1' }],
        seances,
        seanceArchiveEvents: [
          { occurredAt: '2026-02-01T08:00:00Z', seanceId: 'S2', archived: true },
        ],
      }),
    )
    expect(timeline.map((c) => c.date)).toEqual(['2026-01-01', '2026-02-01'])
    expect(timeline[0]!.configId).not.toBe(timeline[1]!.configId)
  })

  it('désarchiver revient à la configuration d’avant, sans effacer le bloc intermédiaire', () => {
    const timeline = buildConfigTimeline(
      input({
        activations: [{ activatedAt: '2026-01-01T08:00:00Z', routineId: 'R1' }],
        seances,
        seanceArchiveEvents: [
          { occurredAt: '2026-02-01T08:00:00Z', seanceId: 'S2', archived: true },
          { occurredAt: '2026-03-01T08:00:00Z', seanceId: 'S2', archived: false },
        ],
      }),
    )
    expect(timeline[2]!.configId).toBe(timeline[0]!.configId)
    expect(detectBlocks(timeline).map((b) => [b.start, b.end])).toEqual([
      ['2026-01-01', '2026-02-01'],
      ['2026-02-01', '2026-03-01'],
      ['2026-03-01', null],
    ])
  })

  it('archiver une séance d’une autre routine ne touche pas la configuration courante', () => {
    const timeline = buildConfigTimeline(
      input({
        activations: [{ activatedAt: '2026-01-01T08:00:00Z', routineId: 'R1' }],
        seances,
        seanceArchiveEvents: [
          { occurredAt: '2026-02-01T08:00:00Z', seanceId: 'S3', archived: true },
        ],
      }),
    )
    expect(timeline.map((c) => c.date)).toEqual(['2026-01-01'])
  })

  it('une séance archivée pendant qu’une autre routine tournait reste hors de sa routine à la réactivation', () => {
    const timeline = buildConfigTimeline(
      input({
        activations: [
          { activatedAt: '2026-01-01T08:00:00Z', routineId: 'R1' },
          { activatedAt: '2026-02-01T08:00:00Z', routineId: 'R2' },
          { activatedAt: '2026-04-01T08:00:00Z', routineId: 'R1' },
        ],
        seances,
        seanceArchiveEvents: [
          { occurredAt: '2026-03-01T08:00:00Z', seanceId: 'S2', archived: true },
        ],
      }),
    )
    expect(timeline.map((c) => c.date)).toEqual(['2026-01-01', '2026-02-01', '2026-04-01'])
    expect(timeline[2]!.configId).not.toBe(timeline[0]!.configId)
  })

  it('à instant égal, une version passe avant l’archivage de la même séance', () => {
    const timeline = buildConfigTimeline(
      input({
        activations: [{ activatedAt: '2026-01-01T08:00:00Z', routineId: 'R1' }],
        seances,
        seanceVersions: [{ createdAt: '2026-02-01T08:00:00Z', seanceId: 'S2' }],
        seanceArchiveEvents: [
          { occurredAt: '2026-02-01T08:00:00Z', seanceId: 'S2', archived: true },
        ],
      }),
    )
    expect(timeline).toHaveLength(3)
    expect(timeline[2]!.configId).not.toBe(timeline[1]!.configId)
  })
})

// --- Instants, jour local, bloc implicite (ADR 0001, amendement du 2026-11-23) --

describe('buildConfigTimeline — instants et jour local', () => {
  const seances = [{ id: 'A', routineId: 'R' }]

  it('chaque changement porte son instant en plus de son jour', () => {
    const timeline = buildConfigTimeline(
      input({ activations: [{ activatedAt: '2026-01-05T09:30:00+00:00', routineId: 'R' }] }),
    )
    expect(timeline).toEqual([
      { date: '2026-01-05', at: '2026-01-05T09:30:00+00:00', configId: timeline[0]!.configId },
    ])
  })

  it('le jour est le jour LOCAL : une édition à 00 h 30 à Paris est datée du lendemain de son jour UTC', () => {
    // 22:30 UTC le 22/09 = 00:30 le 23/09 à Paris. Daté en UTC, le bloc
    // démarrait le 22 et avalait la séance du 22 au soir.
    const timeline = buildConfigTimeline(
      input({
        activations: [{ activatedAt: '2026-09-01T08:00:00+00:00', routineId: 'R' }],
        seances,
        seanceVersions: [{ createdAt: '2026-09-22T22:30:00+00:00', seanceId: 'A' }],
      }),
      parisSummerDay,
    )
    expect(detectBlocks(timeline).map((b) => [b.start, b.end])).toEqual([
      ['2026-09-01', '2026-09-23'],
      ['2026-09-23', null],
    ])
  })

  it('localIsoDay rend le jour du fuseau du processus', () => {
    const ts = '2026-09-22T22:30:00+00:00'
    // Contrôle indépendant : la locale suédoise formate en AAAA-MM-JJ local.
    expect(localIsoDay(ts)).toBe(new Date(ts).toLocaleDateString('sv-SE'))
    // Timestamp illisible : les dix premiers caractères, sans planter.
    expect(localIsoDay('2026-09-22')).toMatch(/^2026-09-2[12]$/)
    expect(localIsoDay('pas-une-date')).toBe('pas-une-da')
  })

  it('bout en bout : séance à 18 h, plan édité à 19 h 30 le même jour, elle reste dans l’ancien bloc', () => {
    const blocks = detectBlocks(
      buildConfigTimeline(
        input({
          activations: [{ activatedAt: '2026-09-01T08:00:00+00:00', routineId: 'R' }],
          seances,
          seanceVersions: [{ createdAt: '2026-09-22T17:30:00+00:00', seanceId: 'A' }],
        }),
      ),
    )
    const ex = (date: string, weightKg: number): ExerciseExecution => ({
      date,
      exerciseId: 'dc',
      seanceId: 'A',
      id: date,
      startedAt: `${date}T16:00:00+00:00`,
      sets: [{ weightKg, reps: 5, rir: 0, order: 1 }],
    })
    const options = summarizeBlockSeances(
      [
        ex('2026-09-08', 100),
        ex('2026-09-15', 102.5),
        ex('2026-09-22', 105),
        ex('2026-09-29', 100),
        ex('2026-10-06', 101),
      ],
      'dc',
      blocks,
    )
    expect(options.map((o) => o.curve.map((p) => p.date))).toEqual([
      ['2026-09-08', '2026-09-15', '2026-09-22'],
      ['2026-09-29', '2026-10-06'],
    ])
    // L'ancien bloc garde ses trois points, donc sa pente.
    expect(options[0]!.weeklyRate).not.toBeNull()
  })
})

describe('buildConfigTimeline — bloc implicite avant toute activation', () => {
  const base = {
    seances: [{ id: 'A', routineId: 'R' }],
    seanceVersions: [
      { createdAt: '2026-08-01T10:00:00+00:00', seanceId: 'A' },
      { createdAt: '2026-09-10T10:00:00+00:00', seanceId: 'A' },
    ],
  }
  const firstExecution = {
    date: '2026-08-05',
    at: '2026-08-05T16:00:00+00:00',
    routineId: 'R',
  }

  it('sans activation, la première exécution ouvre un bloc sur la routine de sa séance', () => {
    const blocks = detectBlocks(
      buildConfigTimeline({ ...input(base), firstExecution }),
    )
    // Bloc implicite au 05/08, coupé par l'édition du 10/09 (celle du 01/08,
    // d'avant la première séance, ne compte pas).
    expect(blocks.map((b) => [b.start, b.end])).toEqual([
      ['2026-08-05', '2026-09-10'],
      ['2026-09-10', null],
    ])
    expect(blocks[0]!.configId).toContain('routine=R')
  })

  it('les exécutions d’avant une activation tardive forment une option de comparaison', () => {
    const blocks = detectBlocks(
      buildConfigTimeline({
        ...input({
          ...base,
          activations: [{ activatedAt: '2026-10-01T10:00:00+00:00', routineId: 'R' }],
        }),
        firstExecution,
      }),
    )
    const ex = (date: string, weightKg: number): ExerciseExecution => ({
      date,
      exerciseId: 'dc',
      seanceId: 'A',
      id: date,
      startedAt: `${date}T16:00:00+00:00`,
      sets: [{ weightKg, reps: 5, rir: 0, order: 1 }],
    })
    const options = summarizeBlockSeances(
      [ex('2026-08-05', 100), ex('2026-08-12', 101), ex('2026-08-19', 102), ex('2026-10-05', 103)],
      'dc',
      blocks,
    )
    expect(options.map((o) => [o.block.start, o.pointCount])).toEqual([
      ['2026-08-05', 3],
      ['2026-09-10', 1],
    ])
  })

  it('une première exécution postérieure à la première activation n’ouvre rien de plus', () => {
    const withFirst = buildConfigTimeline({
      ...input({
        ...base,
        activations: [{ activatedAt: '2026-07-01T10:00:00+00:00', routineId: 'R' }],
      }),
      firstExecution,
    })
    const without = buildConfigTimeline(
      input({
        ...base,
        activations: [{ activatedAt: '2026-07-01T10:00:00+00:00', routineId: 'R' }],
      }),
    )
    expect(withFirst).toEqual(without)
  })

  it('le bloc implicite est daté du jour de la séance, même si sa ligne est arrivée en base plus tard', () => {
    // Séance du 05/08 hors ligne, créée en base le 07/08 : le bloc doit la contenir.
    const timeline = buildConfigTimeline({
      ...input(base),
      firstExecution: { ...firstExecution, at: '2026-08-07T09:00:00+00:00' },
    })
    expect(timeline[0]).toEqual({ date: '2026-08-05', configId: timeline[0]!.configId })
  })

  it('sans première exécution, rien ne change : aucun bloc avant l’activation', () => {
    expect(buildConfigTimeline(input(base))).toEqual([])
  })
})
