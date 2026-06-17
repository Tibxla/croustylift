import { describe, it, expect } from 'vitest'
import { detectBlocks } from './block'

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
})
