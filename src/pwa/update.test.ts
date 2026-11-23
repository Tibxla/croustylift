import { describe, expect, it } from 'vitest'
import {
  CHUNK_RELOAD_COOLDOWN_MS,
  chunkFailureAction,
  isCaptureEntryInProgress,
  isChunkLoadError,
  parseStoredSurface,
  shouldApplyUpdate,
  type UpdateContext,
} from './update'

const TODAY = '2026-11-23'
const YESTERDAY = '2026-11-22'
const NOW = Date.parse('2026-11-23T18:00:00')
const HOUR = 60 * 60 * 1000

function entry(over: Record<string, unknown>): string {
  return JSON.stringify({
    sessionId: 's1',
    executionId: 'e1',
    date: TODAY,
    startedAt: NOW - 10 * 60 * 1000,
    progress: {},
    datedNotes: {},
    ...over,
  })
}

describe('isCaptureEntryInProgress', () => {
  const check = (raw: string | null) => isCaptureEntryInProgress(raw, TODAY, YESTERDAY, NOW)

  it('séance lancée il y a dix minutes, sans série : en cours', () => {
    expect(check(entry({}))).toBe(true)
  })

  it("lancement sans série vieux de plus d'une heure : expiré", () => {
    expect(check(entry({ startedAt: NOW - 2 * HOUR }))).toBe(false)
  })

  it('une série loggée garde la séance en cours, quel que soit son âge', () => {
    const progress = { exo: { sets: [{ weightKg: 60, reps: 8 }], setIds: ['a'], skipped: false } }
    expect(check(entry({ startedAt: NOW - 3 * HOUR, progress }))).toBe(true)
  })

  it('une note datée seule garde la séance en cours', () => {
    const datedNotes = { exo: { id: 'n1', body: 'épaule sensible' } }
    expect(check(entry({ startedAt: NOW - 3 * HOUR, datedNotes }))).toBe(true)
  })

  it('séance de la veille avec des séries (à cheval sur minuit) : en cours', () => {
    const progress = { exo: { sets: [{ weightKg: 60, reps: 8 }] } }
    expect(check(entry({ date: YESTERDAY, startedAt: NOW - 20 * HOUR, progress }))).toBe(true)
  })

  it("un état vieux de plusieurs jours ne retient pas la mise à jour", () => {
    const progress = { exo: { sets: [{ weightKg: 60, reps: 8 }] } }
    expect(check(entry({ date: '2026-11-19', progress }))).toBe(false)
  })

  it('entrée absente, illisible ou mal formée : pas en cours', () => {
    expect(check(null)).toBe(false)
    expect(check('')).toBe(false)
    expect(check('{pas du json')).toBe(false)
    expect(check('42')).toBe(false)
    expect(check(JSON.stringify({ date: TODAY, progress: 'x', startedAt: 'hier' }))).toBe(false)
  })
})

describe('shouldApplyUpdate', () => {
  const base: UpdateContext = {
    trigger: 'ready',
    updateReady: true,
    captureInProgress: false,
    fieldFocused: false,
    interactedSinceLoad: false,
  }

  it("au lancement, avant toute interaction : on bascule", () => {
    expect(shouldApplyUpdate(base)).toBe(true)
  })

  it('sans mise à jour en attente : jamais', () => {
    expect(shouldApplyUpdate({ ...base, updateReady: false })).toBe(false)
    expect(
      shouldApplyUpdate({ ...base, updateReady: false, trigger: 'surface-change', targetSurface: 'analysis' }),
    ).toBe(false)
  })

  it('séance en cours : jamais, quel que soit le déclencheur', () => {
    for (const trigger of ['ready', 'external', 'surface-change'] as const) {
      expect(
        shouldApplyUpdate({ ...base, trigger, captureInProgress: true, targetSurface: 'analysis' }),
      ).toBe(false)
    }
  })

  it('champ en cours de saisie : jamais', () => {
    expect(shouldApplyUpdate({ ...base, fieldFocused: true })).toBe(false)
    expect(
      shouldApplyUpdate({ ...base, fieldFocused: true, trigger: 'surface-change', targetSurface: 'seances' }),
    ).toBe(false)
  })

  it("après une interaction, la mise à jour prête attend un changement d'onglet", () => {
    const touched = { ...base, interactedSinceLoad: true }
    expect(shouldApplyUpdate(touched)).toBe(false)
    expect(shouldApplyUpdate({ ...touched, trigger: 'external' })).toBe(false)
    expect(
      shouldApplyUpdate({ ...touched, trigger: 'surface-change', targetSurface: 'analysis' }),
    ).toBe(true)
  })

  it('un passage vers la Capture ne recharge pas', () => {
    expect(
      shouldApplyUpdate({ ...base, trigger: 'surface-change', targetSurface: 'capture' }),
    ).toBe(false)
  })
})

describe('isChunkLoadError', () => {
  it('reconnaît les libellés des trois moteurs', () => {
    expect(
      isChunkLoadError(
        new TypeError('Failed to fetch dynamically imported module: https://x/assets/A-1.js'),
      ),
    ).toBe(true)
    expect(isChunkLoadError(new TypeError('error loading dynamically imported module'))).toBe(true)
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true)
    expect(isChunkLoadError(new Error('Unable to preload CSS for /assets/A-1.css'))).toBe(true)
  })

  it("laisse passer les autres erreurs", () => {
    expect(isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'x')"))).toBe(false)
    expect(isChunkLoadError(new TypeError('Failed to fetch'))).toBe(false)
    expect(isChunkLoadError(null)).toBe(false)
  })
})

describe('chunkFailureAction', () => {
  const base = { online: true, captureInProgress: false, lastReloadAt: null, now: NOW }

  it('premier échec, en ligne, hors séance : on recharge', () => {
    expect(chunkFailureAction(base)).toBe('reload')
  })

  it('hors ligne : recharger ne ramènerait rien', () => {
    expect(chunkFailureAction({ ...base, online: false })).toBe('report')
  })

  it('séance en cours : on ne recharge pas à sa place', () => {
    expect(chunkFailureAction({ ...base, captureInProgress: true })).toBe('report')
  })

  it('un rechargement récent pour la même raison : pas de boucle', () => {
    expect(chunkFailureAction({ ...base, lastReloadAt: NOW - 3000 })).toBe('report')
    expect(
      chunkFailureAction({ ...base, lastReloadAt: NOW - CHUNK_RELOAD_COOLDOWN_MS - 1 }),
    ).toBe('reload')
  })
})

describe('parseStoredSurface', () => {
  it("ne rend qu'un onglet connu", () => {
    expect(parseStoredSurface('analysis')).toBe('analysis')
    expect(parseStoredSurface('capture')).toBe('capture')
    expect(parseStoredSurface('admin')).toBeNull()
    expect(parseStoredSurface(null)).toBeNull()
  })
})
