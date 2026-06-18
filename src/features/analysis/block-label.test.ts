import { describe, it, expect } from 'vitest'
import type { Block } from '../../domain/types'
import { blockLabel } from './block-label'

function block(start: string, end: string | null): Block {
  return { configId: 'X', start, end }
}

describe('blockLabel', () => {
  it('formate un bloc fermé en plage de dates courtes', () => {
    expect(blockLabel(block('2026-01-05', '2026-02-10'))).toBe('05/01 → 10/02')
  })

  it('marque un bloc en cours (end null) comme « en cours »', () => {
    expect(blockLabel(block('2026-02-10', null))).toBe('10/02 → en cours')
  })
})
