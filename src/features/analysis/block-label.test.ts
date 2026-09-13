import { describe, it, expect } from 'vitest'
import type { Block } from '../../domain/types'
import { blockLabel, seanceRoutineLabel } from './block-label'

function block(start: string, end: string | null): Block {
  return { configId: 'X', start, end }
}

describe('blockLabel', () => {
  it('formate un bloc fermé en plage de dates courtes', () => {
    expect(blockLabel(block('2026-01-05', '2026-02-10'))).toBe('05/01 · 10/02')
  })

  it('marque un bloc en cours (end null) comme « en cours »', () => {
    expect(blockLabel(block('2026-02-10', null))).toBe('10/02 · en cours')
  })
})

describe('seanceRoutineLabel (ADR 0016)', () => {
  it('nomme la séance et sa routine : une option de comparaison peut venir de n’importe quelle routine', () => {
    expect(seanceRoutineLabel({ name: 'Push', routineName: 'PPL v2' })).toBe('Push · PPL v2')
  })

  it('sans routine connue, le nom de séance seul', () => {
    expect(seanceRoutineLabel({ name: 'Push', routineName: null })).toBe('Push')
  })

  it('séance introuvable : « (séance inconnue) »', () => {
    expect(seanceRoutineLabel(undefined)).toBe('(séance inconnue)')
  })
})
