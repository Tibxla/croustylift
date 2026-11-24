import { describe, expect, it } from 'vitest'
import { cardTimeAxis, dayToTime, monthTicks, shortDay, timeAxis, timeTick, timeToDay } from './chart-time'
import { analyzeExecutions } from './data'

const DAY = 24 * 60 * 60 * 1000
const curve = (...dates: string[]) => dates.map((date) => ({ date, e1rm: 100 }))

describe('axe temps des graphes', () => {
  it('une pause occupe sa vraie largeur : huit semaines pèsent huit fois une semaine', () => {
    const [a, b, c] = ['2026-01-05', '2026-01-12', '2026-03-09'].map(dayToTime)
    expect((c! - b!) / (b! - a!)).toBe(8)
  })

  it('jour -> abscisse -> jour, sans glisser d’un jour', () => {
    expect(timeToDay(dayToTime('2026-03-29'))).toBe('2026-03-29')
    // Changement d'heure du 29 mars : l'écart reste de 24 h pile (lecture UTC).
    expect(dayToTime('2026-03-30') - dayToTime('2026-03-29')).toBe(DAY)
  })

  it('graduation et date courte : JJ/MM, entrée mal formée rendue telle quelle', () => {
    expect(shortDay('2026-11-03')).toBe('03/11')
    expect(shortDay('hier')).toBe('hier')
    expect(timeTick(dayToTime('2026-11-03'))).toBe('03/11')
  })

  it('aucun point : pas d’axe', () => {
    expect(timeAxis([])).toBeNull()
    expect(timeAxis([[]])).toBeNull()
  })

  it('bornes sur le premier et le dernier jour de toutes les courbes', () => {
    const axis = timeAxis([curve('2026-01-10', '2026-02-10'), curve('2026-01-01', '2026-01-20')])!
    expect(axis.domain.map(timeToDay)).toEqual(['2026-01-01', '2026-02-10'])
  })

  it('cinq graduations au plus, sur des jours entiers, extrémités comprises', () => {
    const axis = timeAxis([curve('2026-01-01', '2026-06-30')])!
    expect(axis.ticks).toHaveLength(5)
    expect(timeToDay(axis.ticks[0]!)).toBe('2026-01-01')
    expect(timeToDay(axis.ticks[4]!)).toBe('2026-06-30')
    for (const tick of axis.ticks) expect(tick % DAY).toBe(0)
  })

  it('peu de jours : une graduation par jour, jamais de doublon', () => {
    const axis = timeAxis([curve('2026-01-01', '2026-01-03')])!
    expect(axis.ticks.map(timeToDay)).toEqual(['2026-01-01', '2026-01-02', '2026-01-03'])
  })

  it('un seul jour (un point, ou deux séances le même jour) : axe ouvert autour, une graduation', () => {
    const axis = timeAxis([curve('2026-01-10', '2026-01-10')])!
    expect(axis.domain[0]).toBeLessThan(dayToTime('2026-01-10'))
    expect(axis.domain[1]).toBeGreaterThan(dayToTime('2026-01-10'))
    expect(axis.ticks.map(timeToDay)).toEqual(['2026-01-10'])
  })
})

// Relecture du second tour du lot 3 : l'axe commun ne couvrait que les primaires.
describe('axe d’une carte : primaires affichées et séries 2+', () => {
  const day = (date: string, first: number, second: number) => ({
    date,
    exerciseId: 'dips',
    seanceId: 's1',
    sets: [
      { weightKg: first, reps: 8, rir: 0, order: 1 },
      { weightKg: second, reps: 6, rir: 0, order: 2 },
    ],
  })

  it('une date présente dans les seules séries 2+ entre dans l’axe des deux graphes', () => {
    // Le 01/09, la 1ʳᵉ série est à 0 kg (trou de la primaire) et la 2ᵉ lestée.
    const { seanceCurves } = analyzeExecutions(
      { exerciseId: 'dips', name: 'Dips' },
      [day('2026-09-01', 0, 5), day('2026-09-08', 5, 5), day('2026-09-15', 7.5, 5)],
      new Map(),
    )
    const accent = seanceCurves[0]!
    expect(accent.curve.map((p) => p.date)).toEqual(['2026-09-08', '2026-09-15'])
    expect(accent.secondaryCurve[0]!.date).toBe('2026-09-01')

    const axis = cardTimeAxis(seanceCurves)!
    expect(axis.domain.map(timeToDay)).toEqual(['2026-09-01', '2026-09-15'])
    // Chaque point des deux graphes tient dans ce domaine : Recharts n'en élargit aucun.
    for (const p of [...accent.curve, ...accent.secondaryCurve]) {
      expect(dayToTime(p.date)).toBeGreaterThanOrEqual(axis.domain[0])
      expect(dayToTime(p.date)).toBeLessThanOrEqual(axis.domain[1])
    }
    // Sans le secondaire, l'axe commençait une semaine trop tard.
    expect(timeToDay(timeAxis([accent.curve])!.domain[0])).toBe('2026-09-08')
  })

  it('le secondaire compté est celui de l’accent seul, et une carte vide n’a pas d’axe', () => {
    const point = (date: string) => [{ date, e1rm: 1 }]
    const axis = cardTimeAxis([
      { curve: point('2026-02-01'), secondaryCurve: [] },
      { curve: point('2026-02-10'), secondaryCurve: point('2026-01-01') },
    ])!
    expect(axis.domain.map(timeToDay)).toEqual(['2026-02-01', '2026-02-10'])
    expect(cardTimeAxis([])).toBeNull()
  })
})


describe('monthTicks', () => {
  const t = (iso: string) => Date.parse(iso)
  it('pose une graduation au 1er de chaque mois, l’année au passage de janvier', () => {
    const ticks = monthTicks([t('2026-10-12'), t('2027-02-20')], 10)
    expect(ticks.map((k) => k.label)).toEqual(['nov.', 'déc.', '2027', 'févr.'])
    expect(ticks[0]!.x).toBe(t('2026-11-01'))
  })
  it('espace les mois quand la place manque', () => {
    const ticks = monthTicks([t('2026-01-05'), t('2026-12-20')], 5)
    expect(ticks.map((k) => k.label)).toEqual(['mars', 'mai', 'juil.', 'sept.', 'nov.'])
  })
  it('rend [] sous deux graduations', () => {
    expect(monthTicks([t('2026-11-03'), t('2026-11-20')], 5)).toEqual([])
  })
})
