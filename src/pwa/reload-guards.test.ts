// Stockage de l'appareil plein : les écritures en file ne tiennent qu'en mémoire.
// Aucun rechargement automatique tant qu'elles existent, y compris séance close.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearQueue,
  enqueue,
  flush,
  pendingCount,
  storageFailing,
  type OutboxOp,
  type SyncFns,
} from '../features/capture/outbox'
import { blockReloads, unblockReloads } from './blockers'
import { currentBlockers, UNPERSISTED_WRITES_BLOCK } from './reload-guards'
import { shouldReload } from './update'

class MemoryStorage {
  private store = new Map<string, string>()
  getItem(k: string): string | null {
    return this.store.get(k) ?? null
  }
  setItem(k: string, v: string): void {
    this.store.set(k, String(v))
  }
  removeItem(k: string): void {
    this.store.delete(k)
  }
  clear(): void {
    this.store.clear()
  }
}

/** Le stockage refuse d'écrire la file tant que `full` est vrai. */
function quota(): { full: boolean } {
  const state = { full: true }
  const store = globalThis.localStorage
  const setItem = store.setItem.bind(store)
  store.setItem = (k: string, v: string) => {
    if (state.full && k === 'croustylift:outbox') throw new Error('QuotaExceededError')
    setItem(k, v)
  }
  return state
}

const execOp: OutboxOp = {
  type: 'upsertExecution',
  id: 'exec-1',
  seanceVersionId: 'ver-1',
  performedOn: '2026-11-23',
}
const setOp = (id: string, setOrder: number): OutboxOp => ({
  type: 'insertSet',
  id,
  executionId: 'exec-1',
  exerciseId: 'bench',
  setOrder,
  weightKg: 80,
  reps: 8,
  rir: 2,
})
const closeOp: OutboxOp = { type: 'updateExecution', id: 'exec-1', closedAt: '2026-11-23T18:00:00Z' }

/** Fonctions de synchro : tout passe, sauf les ids listés dans `failing`. */
function syncFns(failing: string[] = []): SyncFns {
  const run = async (op: { id: string }) => {
    if (failing.includes(op.id)) throw new TypeError('Failed to fetch')
  }
  return {
    upsertExecution: run,
    insertSet: run,
    deleteSet: run,
    updateExecution: run,
    upsertDatedNote: run,
    deleteDatedNote: run,
    upsertExerciseNote: run,
    deleteExerciseNote: run,
    deleteExecution: run,
  }
}

/**
 * Le changement d'onglet vers l'Analyse, une mise à jour en attente, séance
 * CLOSE (plus d'état de Capture persisté) et aucun champ focalisé : seules les
 * raisons relevées peuvent encore retenir le rechargement.
 */
const wouldReload = () =>
  shouldReload({
    captureInProgress: false,
    fieldFocused: false,
    blockers: currentBlockers(),
    trigger: 'surface-change',
    reloadPending: true,
    interactedSinceLoad: true,
    targetSurface: 'analysis',
  })

beforeEach(() => {
  ;(globalThis as unknown as { localStorage: Storage }).localStorage =
    new MemoryStorage() as unknown as Storage
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  clearQueue()
  vi.restoreAllMocks()
})

describe('currentBlockers : écritures de la file tenues en mémoire', () => {
  it('file persistée normalement : rien ne retient le rechargement', () => {
    enqueue(execOp)
    enqueue(setOp('s1', 1))
    expect(currentBlockers()).toEqual([])
    expect(wouldReload()).toBe(true)
  })

  it('stockage plein, séries et clôture en mémoire seulement : rechargement refusé', () => {
    quota()
    enqueue(execOp)
    enqueue(setOp('s1', 1))
    enqueue(closeOp)
    expect(localStorage.getItem('croustylift:outbox')).toBeNull()
    expect(currentBlockers()).toEqual([UNPERSISTED_WRITES_BLOCK])
    expect(wouldReload()).toBe(false)
  })

  it('levé dès que le stockage accepte de nouveau la file', () => {
    const state = quota()
    enqueue(execOp)
    expect(wouldReload()).toBe(false)

    state.full = false
    enqueue(setOp('s1', 1))
    expect(localStorage.getItem('croustylift:outbox')).not.toBeNull()
    expect(currentBlockers()).toEqual([])
    expect(wouldReload()).toBe(true)
  })

  it('levé dès que la base a acquitté ces écritures', async () => {
    quota()
    enqueue(execOp)
    enqueue(setOp('s1', 1))
    expect(wouldReload()).toBe(false)

    await flush(syncFns())
    expect(pendingCount()).toBe(0)
    expect(wouldReload()).toBe(true)
  })

  it('un retrait non écrit ne retient rien : seules les écritures en mémoire comptent', async () => {
    // Tout est écrit sur l'appareil, puis le stockage se remplit.
    enqueue(execOp)
    enqueue(setOp('s1', 1))
    enqueue(setOp('s2', 2))
    quota()

    // L'exécution et s1 passent en base, s2 non. Leur retrait de la file ne peut
    // pas être écrit : la file persistée les garde, elles seraient rejouées sans
    // effet après un rechargement. Rien n'existe en mémoire seulement.
    await flush(syncFns(['s2']))
    expect(pendingCount()).toBe(1)
    expect(storageFailing()).toBe(true)
    expect(currentBlockers()).toEqual([])
    expect(wouldReload()).toBe(true)
  })

  it('stockage toujours plein : levé quand la dernière écriture en mémoire est acquittée', async () => {
    enqueue(execOp)
    quota()
    enqueue(setOp('s1', 1))
    enqueue(setOp('s2', 2))

    await flush(syncFns(['s2']))
    expect(storageFailing()).toBe(true)
    expect(wouldReload()).toBe(false) // s2 n'est toujours qu'en mémoire

    await flush(syncFns())
    expect(pendingCount()).toBe(0)
    expect(wouldReload()).toBe(true)
  })

  it('une seule des écritures en mémoire acquittée : toujours refusé', async () => {
    quota()
    enqueue(execOp)
    enqueue(setOp('s1', 1))
    await flush(syncFns(['s1']))
    expect(pendingCount()).toBe(1)
    expect(wouldReload()).toBe(false)
  })

  it('s’ajoute aux raisons déclarées, sans les remplacer', () => {
    quota()
    enqueue(execOp)
    blockReloads('brouillon-seance')
    expect(currentBlockers()).toEqual(['brouillon-seance', UNPERSISTED_WRITES_BLOCK])
    unblockReloads('brouillon-seance')
    expect(currentBlockers()).toEqual([UNPERSISTED_WRITES_BLOCK])
  })
})
