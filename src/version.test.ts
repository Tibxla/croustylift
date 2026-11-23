import { describe, expect, it } from 'vitest'
import { formatVersion } from './version'

describe('formatVersion', () => {
  it('accole le commit et la date locale du build', () => {
    const iso = new Date(2026, 10, 23, 9, 5).toISOString()
    expect(formatVersion('a1b2c3d', iso)).toBe('a1b2c3d · 23/11/2026 09:05')
  })

  it('sans date lisible, rend le commit seul', () => {
    expect(formatVersion('inconnu', '')).toBe('inconnu')
  })
})
