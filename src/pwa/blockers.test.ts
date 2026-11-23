import { afterEach, describe, expect, it } from 'vitest'
import { activeBlockers, blockReloads, unblockReloads, withReloadBlocked } from './blockers'
import { reloadAllowed } from './update'

const allowed = () =>
  reloadAllowed({ captureInProgress: false, fieldFocused: false, blockers: activeBlockers() })

afterEach(() => {
  for (const reason of activeBlockers()) {
    while (activeBlockers().includes(reason)) unblockReloads(reason)
  }
})

describe('blockReloads / unblockReloads', () => {
  it('une raison posée interdit le rechargement, levée elle le rend', () => {
    expect(allowed()).toBe(true)
    blockReloads('brouillon-seance')
    expect(allowed()).toBe(false)
    unblockReloads('brouillon-seance')
    expect(allowed()).toBe(true)
  })

  it('compte par raison : deux poses demandent deux levées', () => {
    blockReloads('sauvegarde')
    blockReloads('sauvegarde')
    unblockReloads('sauvegarde')
    expect(activeBlockers()).toEqual(['sauvegarde'])
    unblockReloads('sauvegarde')
    expect(activeBlockers()).toEqual([])
  })

  it('lever une raison absente ne fait rien', () => {
    unblockReloads('inconnue')
    expect(activeBlockers()).toEqual([])
  })
})

describe('withReloadBlocked', () => {
  it("bloque en synchrone, avant la première instruction de l'écriture, et jusqu'à sa fin", async () => {
    const seen: boolean[] = []
    let finish!: (value: string) => void
    const pending = withReloadBlocked('sauvegarde-seance', () => {
      seen.push(allowed())
      return new Promise<string>((resolve) => {
        finish = resolve
      })
    })
    // Dès le retour de l'appel, sans attendre : le blocage est posé.
    expect(allowed()).toBe(false)
    expect(seen).toEqual([false])
    // Entre deux requêtes de l'écriture (ici, tant qu'elle n'a pas fini) : toujours bloqué.
    await Promise.resolve()
    expect(allowed()).toBe(false)
    finish('ok')
    await expect(pending).resolves.toBe('ok')
    expect(allowed()).toBe(true)
  })

  it("lève le blocage quand l'écriture échoue, et propage l'erreur", async () => {
    await expect(
      withReloadBlocked('sauvegarde', () => Promise.reject(new Error('réseau'))),
    ).rejects.toThrow('réseau')
    expect(allowed()).toBe(true)
  })

  it("lève le blocage quand l'écriture lève en synchrone", async () => {
    await expect(
      withReloadBlocked('sauvegarde', () => {
        throw new Error('avant la première requête')
      }),
    ).rejects.toThrow('avant la première requête')
    expect(allowed()).toBe(true)
  })

  it('imbriqué ou simultané sous la même raison : levé seulement à la dernière fin', async () => {
    let finishOuter!: () => void
    let finishInner!: () => void
    const outer = withReloadBlocked('sauvegarde', () => new Promise<void>((r) => (finishOuter = r)))
    const inner = withReloadBlocked('sauvegarde', () => new Promise<void>((r) => (finishInner = r)))
    finishInner()
    await inner
    expect(allowed()).toBe(false)
    finishOuter()
    await outer
    expect(allowed()).toBe(true)
  })
})
