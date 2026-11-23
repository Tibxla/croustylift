import { describe, expect, it } from 'vitest'
import { dayToTime, shortDay, timeAxis, timeTick, timeToDay } from './chart-time'

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
