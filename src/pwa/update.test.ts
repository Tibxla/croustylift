import { describe, expect, it } from 'vitest'
import {
  CHUNK_RELOAD_COOLDOWN_MS,
  chunkFailureAction,
  ImportRequests,
  isControllerReplacement,
  updateAlreadyInstalling,
  isCaptureEntryInProgress,
  isChunkLoadError,
  parseStoredSurface,
  reloadAllowed,
  shouldReload,
  type ReloadContext,
  type ReloadGuards,
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

describe('reloadAllowed', () => {
  const libre: ReloadGuards = { captureInProgress: false, fieldFocused: false, blockers: [] }

  it('rien en cours : permis', () => {
    expect(reloadAllowed(libre)).toBe(true)
  })

  it('chaque garde suffit à interdire', () => {
    expect(reloadAllowed({ ...libre, captureInProgress: true })).toBe(false)
    expect(reloadAllowed({ ...libre, fieldFocused: true })).toBe(false)
    expect(reloadAllowed({ ...libre, blockers: ['brouillon-seance'] })).toBe(false)
    expect(reloadAllowed({ ...libre, blockers: ['recuperation-mot-de-passe'] })).toBe(false)
  })
})

describe('shouldReload', () => {
  const base: ReloadContext = {
    trigger: 'activated',
    reloadPending: true,
    captureInProgress: false,
    fieldFocused: false,
    blockers: [],
    interactedSinceLoad: false,
  }
  const TRIGGERS = ['activated', 'surface-change', 'manual'] as const

  it('au lancement, avant toute interaction : on recharge', () => {
    expect(shouldReload(base)).toBe(true)
  })

  it('sans version en attente : jamais', () => {
    for (const trigger of TRIGGERS) {
      expect(shouldReload({ ...base, trigger, reloadPending: false, targetSurface: 'analysis' })).toBe(false)
    }
  })

  it('séance en cours, champ focalisé, brouillon, récupération : jamais, quel que soit le déclencheur', () => {
    for (const trigger of TRIGGERS) {
      const ctx = { ...base, trigger, targetSurface: 'analysis' }
      expect(shouldReload({ ...ctx, captureInProgress: true })).toBe(false)
      expect(shouldReload({ ...ctx, fieldFocused: true })).toBe(false)
      expect(shouldReload({ ...ctx, blockers: ['brouillon-seance'] })).toBe(false)
      expect(shouldReload({ ...ctx, blockers: ['recuperation-mot-de-passe'] })).toBe(false)
    }
  })

  it("le service worker prend la main APRÈS le début d'une saisie : on attend le point sûr suivant", () => {
    // La page s'ouvre, l'utilisateur tape dans un champ, puis le worker s'active.
    const enSaisie = { ...base, interactedSinceLoad: true, fieldFocused: true }
    expect(shouldReload(enSaisie)).toBe(false)
    // Il quitte le champ sans changer d'onglet : toujours rien de spontané.
    expect(shouldReload({ ...enSaisie, fieldFocused: false })).toBe(false)
    // Il change d'onglet, champ encore focalisé : refusé ; champ quitté : rechargé.
    const versAnalyse = { ...enSaisie, trigger: 'surface-change' as const, targetSurface: 'analysis' }
    expect(shouldReload(versAnalyse)).toBe(false)
    expect(shouldReload({ ...versAnalyse, fieldFocused: false })).toBe(true)
  })

  it('un passage vers la Capture ne recharge pas', () => {
    expect(shouldReload({ ...base, trigger: 'surface-change', targetSurface: 'capture' })).toBe(false)
  })

  it('le bouton « Mettre à jour » recharge même après interaction', () => {
    expect(shouldReload({ ...base, trigger: 'manual', interactedSinceLoad: true })).toBe(true)
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
  const base = { online: true, requestActive: true, allowed: true, lastReloadAt: null, now: NOW }

  it("premier échec, en ligne, l'utilisateur est encore sur l'écran : on recharge", () => {
    expect(chunkFailureAction(base)).toBe('reload')
  })

  it("l'utilisateur a quitté l'écran avant l'échec : ignoré, rien ne recharge sous ses pieds", () => {
    expect(chunkFailureAction({ ...base, requestActive: false })).toBe('ignore')
    expect(chunkFailureAction({ ...base, requestActive: false, allowed: false })).toBe('ignore')
    expect(chunkFailureAction({ ...base, requestActive: false, online: false })).toBe('ignore')
  })

  it('hors ligne : recharger ne ramènerait rien', () => {
    expect(chunkFailureAction({ ...base, online: false })).toBe('report')
  })

  it("rechargement non autorisé (séance, saisie, brouillon) : on ne recharge pas à sa place", () => {
    expect(chunkFailureAction({ ...base, allowed: false })).toBe('report')
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

describe('ImportRequests', () => {
  it('la demande ouverte est active tant que rien ne la périme', () => {
    const requests = new ImportRequests()
    const id = requests.begin()
    expect(requests.isActive(id)).toBe(true)
  })

  it("quitter l'écran ou démonter l'app (déconnexion) périme la demande : son rejet sera ignoré", () => {
    const requests = new ImportRequests()
    const id = requests.begin()
    requests.invalidate()
    expect(requests.isActive(id)).toBe(false)
    // Mêmes gardes que la reprise : une demande périmée ne recharge jamais.
    expect(
      chunkFailureAction({
        online: true,
        requestActive: requests.isActive(id),
        allowed: true,
        lastReloadAt: null,
        now: NOW,
      }),
    ).toBe('ignore')
  })

  it('une nouvelle demande périme la précédente sans la ressusciter', () => {
    const requests = new ImportRequests()
    const first = requests.begin()
    requests.invalidate()
    const second = requests.begin()
    expect(requests.isActive(first)).toBe(false)
    expect(requests.isActive(second)).toBe(true)
  })
})

describe('prise de contrôle du service worker', () => {
  it('première installation : pas un remplacement, rien à recharger', () => {
    expect(isControllerReplacement(false)).toBe(false)
  })

  it('la page avait un contrôleur : une nouvelle version a pris la main', () => {
    expect(isControllerReplacement(true)).toBe(true)
  })

  it("page ouverte pendant qu'un autre onglet installe : mise à l'abri immédiate", () => {
    expect(updateAlreadyInstalling({ hasController: true, installing: true, waiting: false })).toBe(true)
    expect(updateAlreadyInstalling({ hasController: true, installing: false, waiting: true })).toBe(true)
  })

  it('rien en cours, ou toute première installation : rien à faire', () => {
    expect(updateAlreadyInstalling({ hasController: true, installing: false, waiting: false })).toBe(false)
    expect(updateAlreadyInstalling({ hasController: false, installing: true, waiting: false })).toBe(false)
  })
})
