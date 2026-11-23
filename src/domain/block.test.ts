import { describe, it, expect } from 'vitest'
import { blockKey, detectBlocks } from './block'

describe('detectBlocks', () => {
  it('retourne [] pour une timeline vide', () => {
    expect(detectBlocks([])).toEqual([])
  })

  it('une seule entrée donne un bloc en cours (end: null)', () => {
    expect(detectBlocks([{ date: '2026-01-01', configId: 'A' }])).toEqual([
      { configId: 'A', start: '2026-01-01', end: null },
    ])
  })

  it('A puis B donne 2 blocs, le end de A = le start de B', () => {
    expect(
      detectBlocks([
        { date: '2026-01-01', configId: 'A' },
        { date: '2026-02-01', configId: 'B' },
      ]),
    ).toEqual([
      { configId: 'A', start: '2026-01-01', end: '2026-02-01' },
      { configId: 'B', start: '2026-02-01', end: null },
    ])
  })

  it('fusionne deux entrées consécutives de même config en un seul bloc', () => {
    expect(
      detectBlocks([
        { date: '2026-01-01', configId: 'A' },
        { date: '2026-02-01', configId: 'A' },
      ]),
    ).toEqual([{ configId: 'A', start: '2026-01-01', end: null }])
  })

  it('A puis B puis A donne 3 blocs distincts (A réapparu non fusionné)', () => {
    expect(
      detectBlocks([
        { date: '2026-01-01', configId: 'A' },
        { date: '2026-02-01', configId: 'B' },
        { date: '2026-03-01', configId: 'A' },
      ]),
    ).toEqual([
      { configId: 'A', start: '2026-01-01', end: '2026-02-01' },
      { configId: 'B', start: '2026-02-01', end: '2026-03-01' },
      { configId: 'A', start: '2026-03-01', end: null },
    ])
  })

  it('trie par date avant de dériver les blocs (entrée désordonnée)', () => {
    expect(
      detectBlocks([
        { date: '2026-02-01', configId: 'B' },
        { date: '2026-01-01', configId: 'A' },
      ]),
    ).toEqual([
      { configId: 'A', start: '2026-01-01', end: '2026-02-01' },
      { configId: 'B', start: '2026-02-01', end: null },
    ])
  })

  // Rattachement par instant (ADR 0001, amendement du 2026-11-23) : chaque
  // frontière garde son instant, le jour ne sert plus qu'au libellé.
  it('porte l’instant de chaque frontière quand le changement en a un', () => {
    expect(
      detectBlocks([
        { date: '2026-09-01', at: '2026-09-01T08:00:00+00:00', configId: 'A' },
        { date: '2026-09-22', at: '2026-09-22T17:30:00+00:00', configId: 'B' },
      ]),
    ).toEqual([
      {
        configId: 'A',
        start: '2026-09-01',
        end: '2026-09-22',
        startAt: '2026-09-01T08:00:00+00:00',
        endAt: '2026-09-22T17:30:00+00:00',
      },
      { configId: 'B', start: '2026-09-22', end: null, startAt: '2026-09-22T17:30:00+00:00' },
    ])
  })

  it('deux changements le même jour s’ordonnent par instant', () => {
    const blocks = detectBlocks([
      { date: '2026-09-22', at: '2026-09-22T17:30:00+00:00', configId: 'B' },
      { date: '2026-09-22', at: '2026-09-22T09:00:00+00:00', configId: 'A' },
    ])
    expect(blocks.map((b) => b.configId)).toEqual(['A', 'B'])
  })

  it('blockKey distingue deux blocs nés le même jour', () => {
    const [a, b] = detectBlocks([
      { date: '2026-09-22', at: '2026-09-22T09:00:00+00:00', configId: 'A' },
      { date: '2026-09-22', at: '2026-09-22T17:30:00+00:00', configId: 'B' },
    ])
    expect(blockKey(a!)).not.toBe(blockKey(b!))
    // Sans instant, le jour reste la clé.
    expect(blockKey({ configId: 'A', start: '2026-01-01', end: null })).toBe('2026-01-01')
  })
})
