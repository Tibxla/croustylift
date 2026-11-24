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
import {
  clearPersisted,
  hasUnpersistedCaptureState,
  initialState,
  loadPersisted,
  persist,
} from '../features/capture/state'
import { upperA } from '../features/capture/fixtures'
import { currentBlockers, UNPERSISTED_CAPTURE_BLOCK, UNPERSISTED_WRITES_BLOCK } from './reload-guards'
import { shouldReload } from './update'
import { REGISTRY_KEY, storedPendingIds } from '../test/registry'

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
    if (state.full && k === REGISTRY_KEY) throw new Error('QuotaExceededError')
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
    patchSet: run,
    deleteSet: run,
    updateExecution: run,
    upsertDatedNote: run,
    deleteDatedNote: run,
    upsertExerciseNote: run,
    deleteExerciseNote: run,
    deleteExecution: run,
    deleteExecutionIfEmpty: run,
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
    expect(storedPendingIds()).toEqual([])
    expect(currentBlockers()).toEqual([UNPERSISTED_WRITES_BLOCK])
    expect(wouldReload()).toBe(false)
  })

  it('levé dès que le stockage accepte de nouveau la file', () => {
    const state = quota()
    enqueue(execOp)
    expect(wouldReload()).toBe(false)

    state.full = false
    enqueue(setOp('s1', 1))
    expect(storedPendingIds()).toEqual(['exec-1', 's1'])
    expect(currentBlockers()).toEqual([])
    expect(wouldReload()).toBe(true)
  })

  it('stockage rétabli sans nouvelle écriture : la demande de mise à jour retente et passe', () => {
    const state = quota()
    enqueue(execOp)
    enqueue(setOp('s1', 1))
    enqueue(closeOp)
    expect(wouldReload()).toBe(false)

    // L'utilisateur libère de la place, hors ligne : aucun enfilement, aucun
    // acquittement. Seule la question « peut-on recharger ? » repasse.
    state.full = false
    expect(storedPendingIds()).toEqual([])
    expect(wouldReload()).toBe(true)
    // Tout est sur l'appareil, dans l'ordre : le rechargement ne perd rien.
    expect(storedPendingIds()).toEqual(['exec-1', 's1', 'exec-1'])
    expect(storageFailing()).toBe(false)
    expect(pendingCount()).toBe(3)
  })

  it('stockage toujours plein : la demande retente, échoue, et le refus tient', () => {
    quota()
    enqueue(execOp)
    expect(wouldReload()).toBe(false)
    expect(wouldReload()).toBe(false)
    expect(storedPendingIds()).toEqual([])
    expect(pendingCount()).toBe(1)
    expect(currentBlockers()).toEqual([UNPERSISTED_WRITES_BLOCK])
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

// Un exo ajouté à la séance n'alimente pas la file : il ne vit que dans l'état
// de capture. Stockage plein, cet état n'est pas écrit ; la garde voyait une
// file durable, aucune séance sur l'appareil, et laissait recharger.
describe('currentBlockers : état de la séance tenu en mémoire', () => {
  /** Le stockage refuse d'écrire l'état de capture tant que `full` est vrai. */
  function captureQuota(): { full: boolean } {
    const state = { full: true }
    const store = globalThis.localStorage
    const setItem = store.setItem.bind(store)
    store.setItem = (k: string, v: string) => {
      if (state.full && k.startsWith('croustylift:capture:')) throw new Error('QuotaExceededError')
      setItem(k, v)
    }
    return state
  }
  const today = new Date()
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const withAddedExercise = (date = iso(today)) => ({
    ...initialState(upperA, date),
    layout: [{ kind: 'added' as const, exerciseId: 'curl', name: 'Curl', unilateral: false, primaryMuscles: [] }],
  })

  afterEach(() => {
    // Lève l'état retenu d'un test à l'autre (module à mémoire).
    clearPersisted(upperA, iso(today))
    const old = new Date(today)
    old.setDate(old.getDate() - 3)
    clearPersisted(upperA, iso(old))
  })

  it('état écrit normalement : rien ne retient le rechargement', () => {
    persist(withAddedExercise())
    expect(currentBlockers()).toEqual([])
    expect(wouldReload()).toBe(true)
  })

  it('exo ajouté, état refusé par le stockage, file vide : rechargement refusé', () => {
    captureQuota()
    persist(withAddedExercise())
    expect(loadPersisted(upperA, iso(today))).toBeNull()
    expect(currentBlockers()).toEqual([UNPERSISTED_CAPTURE_BLOCK])
    expect(wouldReload()).toBe(false)
  })

  it('place libérée : la demande retente l’écriture, l’état est sur l’appareil, le rechargement passe', () => {
    const quota = captureQuota()
    persist(withAddedExercise())
    expect(wouldReload()).toBe(false)

    quota.full = false
    expect(wouldReload()).toBe(true)
    // Le rechargement ne perd rien : la disposition se relit.
    expect(loadPersisted(upperA, iso(today))?.layout?.[0]?.exerciseId).toBe('curl')
    expect(hasUnpersistedCaptureState()).toBe(false)
  })

  it('stockage toujours plein : le refus tient, demande après demande', () => {
    captureQuota()
    persist(withAddedExercise())
    expect(wouldReload()).toBe(false)
    expect(wouldReload()).toBe(false)
  })

  it('séance close ou annulée : plus rien à retenir, sans attendre le stockage', () => {
    captureQuota()
    persist(withAddedExercise())
    expect(wouldReload()).toBe(false)
    clearPersisted(upperA, iso(today))
    expect(currentBlockers()).toEqual([])
    expect(wouldReload()).toBe(true)
  })

  it('un état écrit ensuite avec succès lève le blocage', () => {
    const quota = captureQuota()
    persist(withAddedExercise())
    quota.full = false
    persist(withAddedExercise())
    expect(currentBlockers()).toEqual([])
  })

  it('état d’avant la veille, plus reprenable : il ne retient pas la mise à jour sans fin', () => {
    captureQuota()
    const old = new Date(today)
    old.setDate(old.getDate() - 3)
    persist(withAddedExercise(iso(old)))
    expect(hasUnpersistedCaptureState()).toBe(false)
    expect(wouldReload()).toBe(true)
  })

  it('les deux raisons s’ajoutent : file et état en mémoire', () => {
    quota()
    captureQuota()
    enqueue(execOp)
    persist(withAddedExercise())
    expect(currentBlockers()).toEqual([UNPERSISTED_WRITES_BLOCK, UNPERSISTED_CAPTURE_BLOCK])
  })
})
