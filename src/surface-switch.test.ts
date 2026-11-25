import { afterEach, describe, expect, it } from 'vitest'
import { setLeaveGuard } from './features/authoring/seance-dirty'
import { switchSurface, type SurfaceSwitchEffects } from './surface-switch'

/** Effets espions. */
function effects(): { calls: string[]; fx: SurfaceSwitchEffects } {
  const calls: string[] = []
  return {
    calls,
    fx: {
      requestReload: (trigger, target) => {
        calls.push(`reload:${trigger}:${target}`)
        return false
      },
      show: (surface) => calls.push(`show:${surface}`),
    },
  }
}

afterEach(() => setLeaveGuard(null, 'seances'))

describe('switchSurface', () => {
  it('demande le rechargement puis affiche l’onglet', () => {
    const { calls, fx } = effects()
    switchSurface('analysis', 'capture', fx)
    expect(calls).toEqual(['reload:surface-change:analysis', 'show:analysis'])
  })

  it('un éditeur qui porte un brouillon ne retient pas le changement d’onglet : il reste monté, caché', () => {
    const { calls, fx } = effects()
    let asked = false
    setLeaveGuard(() => {
      asked = true
    }, 'seances')
    switchSurface('reglages', 'seances', fx)
    expect(asked).toBe(false)
    expect(calls).toEqual(['reload:surface-change:reglages', 'show:reglages'])
  })

  it('affiche l’onglet même si le rechargement est accepté (il peut tarder)', () => {
    const { calls, fx } = effects()
    switchSurface('analysis', 'capture', { ...fx, requestReload: () => true })
    expect(calls).toEqual(['show:analysis'])
  })

  it('tap sur l’onglet déjà affiché : pas de rechargement', () => {
    const { calls, fx } = effects()
    switchSurface('seances', 'seances', fx)
    expect(calls).toEqual(['show:seances'])
  })

  it('depuis les Réglages vers la Salle : la demande de rechargement vise la Salle', () => {
    const { calls, fx } = effects()
    switchSurface('capture', 'reglages', fx)
    expect(calls).toEqual(['reload:surface-change:capture', 'show:capture'])
  })
})
