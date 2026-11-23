// Le blocage d'un brouillon doit être levé au démontage, à l'enregistrement et à
// l'abandon : une fuite interdirait toute mise à jour de la PWA sans aucun
// symptôme. Les tests tournent sans DOM : `react` est remplacé par un moteur de
// hooks minimal (cases mémoire par ordre d'appel, effets rejoués quand leurs
// dépendances changent, nettoyages au changement et au démontage), ce qui suffit
// à dérouler le cycle de vie réel du hook.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface EffectSlot {
  deps?: readonly unknown[]
  cleanup?: void | (() => void)
}

const engine = vi.hoisted(() => {
  const state = {
    slots: [] as unknown[],
    cursor: 0,
    pending: [] as (() => void)[],
  }
  function slot<T>(init: () => T): T {
    if (state.cursor >= state.slots.length) state.slots.push(init())
    return state.slots[state.cursor++] as T
  }
  return { state, slot }
})

vi.mock('react', () => ({
  useRef: <T,>(initial: T) => engine.slot(() => ({ current: initial })),
  useCallback: <T,>(fn: T) => engine.slot(() => fn),
  useEffect: (effect: () => void | (() => void), deps?: readonly unknown[]) => {
    const slot = engine.slot<EffectSlot>(() => ({}))
    const changed =
      slot.deps === undefined ||
      deps === undefined ||
      deps.length !== slot.deps.length ||
      deps.some((dep, i) => !Object.is(dep, slot.deps![i]))
    if (!changed) return
    engine.state.pending.push(() => {
      slot.cleanup?.()
      slot.deps = deps
      slot.cleanup = effect()
    })
  },
}))

import { activeBlockers, blockReloads, unblockReloads } from './blockers'
import { useReloadBlockWhile } from './useReloadBlockWhile'

const REASON = 'brouillon-test'

/** Un rendu du composant porteur, effets compris ; rend la levée immédiate. */
function render(active: boolean): () => void {
  engine.state.cursor = 0
  // Appelé sous un autre nom : ce « rendu » n'est pas un composant React, et la
  // règle des hooks n'a rien à vérifier ici.
  const hook = useReloadBlockWhile
  const release = hook(REASON, active)
  for (const run of engine.state.pending.splice(0)) run()
  return release
}

/** Démontage : tous les nettoyages d'effet. */
function unmount(): void {
  for (const slot of engine.state.slots) {
    if (slot !== null && typeof slot === 'object' && 'cleanup' in slot) {
      ;(slot as EffectSlot).cleanup?.()
    }
  }
  engine.state.slots = []
}

beforeEach(() => {
  engine.state.slots = []
  engine.state.pending = []
})

afterEach(() => {
  for (const reason of activeBlockers()) {
    while (activeBlockers().includes(reason)) unblockReloads(reason)
  }
})

describe('useReloadBlockWhile', () => {
  it('ne bloque rien tant que le brouillon est vierge', () => {
    render(false)
    expect(activeBlockers()).toEqual([])
    unmount()
    expect(activeBlockers()).toEqual([])
  })

  it('bloque dès la première modification, une seule fois malgré les rendus suivants', () => {
    render(false)
    render(true)
    render(true)
    render(true)
    expect(activeBlockers()).toEqual([REASON])
    unmount()
    expect(activeBlockers()).toEqual([])
  })

  it('levé à l’ENREGISTREMENT : le brouillon redevient propre, l’écran reste monté', () => {
    render(true)
    expect(activeBlockers()).toEqual([REASON])
    render(false)
    expect(activeBlockers()).toEqual([])
    // Nouvelle modification après l'enregistrement : bloqué à nouveau, puis libéré.
    render(true)
    expect(activeBlockers()).toEqual([REASON])
    unmount()
    expect(activeBlockers()).toEqual([])
  })

  it('levé au DÉMONTAGE d’un écran encore modifié', () => {
    render(true)
    unmount()
    expect(activeBlockers()).toEqual([])
  })

  it('levé à l’ABANDON, tout de suite, avant le démontage', () => {
    const release = render(true)
    release()
    // La navigation confirmée peut recharger dans le même tour synchrone.
    expect(activeBlockers()).toEqual([])
    unmount()
    expect(activeBlockers()).toEqual([])
  })

  it('abandon puis démontage ne lèvent pas le blocage d’un autre écran sous la même raison', () => {
    blockReloads(REASON) // un autre porteur
    const release = render(true)
    release()
    release()
    unmount()
    expect(activeBlockers()).toEqual([REASON])
  })

  it('la levée immédiate est sans effet quand rien n’est tenu', () => {
    const release = render(false)
    release()
    expect(activeBlockers()).toEqual([])
    unmount()
  })
})
