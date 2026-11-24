import { afterEach, describe, expect, it } from 'vitest'
import { requestLeave, setLeaveGuard } from './features/authoring/seance-dirty'
import { switchSurface, type SurfaceSwitchEffects } from './surface-switch'

/** Effets espions, branchés sur la VRAIE garde de sortie. */
function effects(): { calls: string[]; fx: SurfaceSwitchEffects } {
  const calls: string[] = []
  return {
    calls,
    fx: {
      requestLeave,
      requestReload: (trigger, target) => {
        calls.push(`reload:${trigger}:${target}`)
        return false
      },
      show: (surface) => calls.push(`show:${surface}`),
    },
  }
}

afterEach(() => setLeaveGuard(null))

describe('switchSurface', () => {
  it('sans garde : demande le rechargement puis affiche l’onglet', () => {
    const { calls, fx } = effects()
    switchSurface('analysis', 'capture', fx)
    expect(calls).toEqual(['reload:surface-change:analysis', 'show:analysis'])
  })

  it('l’utilisateur refuse de quitter : ni rechargement, ni changement d’onglet', () => {
    const { calls, fx } = effects()
    // La garde garde la suite sans jamais l'appeler (« Continuer l'édition »).
    setLeaveGuard(() => {})
    switchSurface('analysis', 'seances', fx)
    expect(calls).toEqual([])
  })

  it('rien ne se passe AVANT la réponse ; une fois la sortie acceptée, rechargement puis onglet', () => {
    const { calls, fx } = effects()
    let accept: (() => void) | null = null
    setLeaveGuard((proceed) => {
      accept = proceed
    })
    switchSurface('exercises', 'seances', fx)
    expect(calls).toEqual([])
    // « Quitter » : l'écran retire sa garde, puis laisse passer.
    setLeaveGuard(null)
    accept!()
    expect(calls).toEqual(['reload:surface-change:exercises', 'show:exercises'])
  })

  it('affiche l’onglet même si le rechargement est accepté (il peut tarder)', () => {
    const { calls, fx } = effects()
    switchSurface('analysis', 'capture', { ...fx, requestReload: () => true })
    expect(calls).toEqual(['show:analysis'])
  })

  it('tap sur l’onglet déjà affiché : pas de garde, pas de rechargement', () => {
    const { calls, fx } = effects()
    let asked = false
    setLeaveGuard(() => {
      asked = true
    })
    switchSurface('seances', 'seances', fx)
    expect(asked).toBe(false)
    expect(calls).toEqual(['show:seances'])
  })
})
