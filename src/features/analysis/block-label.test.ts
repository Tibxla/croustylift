import { describe, it, expect } from 'vitest'
import type { Block } from '../../domain/types'
import { blockPeriodLabel, seanceRoutineLabel } from './block-label'

function block(start: string, end: string | null): Block {
  return { configId: 'X', start, end }
}

describe('blockPeriodLabel', () => {
  it('dit un bloc fermé par ses deux dates courtes', () => {
    expect(blockPeriodLabel(block('2026-01-05', '2026-02-10'))).toBe('du 05/01 au 10/02')
  })

  it('dit un bloc en cours (end null) depuis son début', () => {
    expect(blockPeriodLabel(block('2026-02-10', null))).toBe('depuis le 10/02')
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
