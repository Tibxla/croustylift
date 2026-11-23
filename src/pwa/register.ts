// Enregistrement du service worker et bascule contrôlée vers une nouvelle
// version. Les décisions sont dans `update.ts` (pur, testé) ; ici, seulement les
// effets : écouteurs, stockage, rechargement.

import { useSyncExternalStore } from 'react'
import { registerSW } from 'virtual:pwa-register'
import { previousDayIso, todayIso } from '../features/capture/state'
import {
  CAPTURE_STORAGE_PREFIX,
  chunkFailureAction,
  isCaptureEntryInProgress,
  parseStoredSurface,
  shouldApplyUpdate,
  type SurfaceName,
  type UpdateTrigger,
} from './update'

/** Onglet à rouvrir après un rechargement décidé par l'app (durée de l'onglet). */
const SURFACE_KEY = 'croustylift:surface-apres-rechargement'
/** Horodatage du dernier rechargement dû à un chunk introuvable (anti-boucle). */
const CHUNK_RELOAD_KEY = 'croustylift:rechargement-chunk'
/** Intervalle minimal entre deux recherches de mise à jour au retour au premier plan. */
const UPDATE_CHECK_MIN_INTERVAL_MS = 10 * 60 * 1000
/** Délai au-delà duquel on recharge soi-même après avoir demandé la bascule. */
const RELOAD_FALLBACK_MS = 4000

let updateReady = false
let interactedSinceLoad = false
let applyUpdate: (() => void) | null = null
/** Vrai dès que CETTE page a demandé la bascule : son rechargement est acquis. */
let switching = false
/** Onglet rouvert au chargement de cette page, repris si un second rechargement suit. */
let restoredSurface: SurfaceName | null = null
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

/** Une séance est-elle en cours de saisie sur cet appareil ? */
export function captureInProgress(): boolean {
  if (typeof localStorage === 'undefined') return false
  try {
    const today = todayIso()
    const yesterday = previousDayIso(today)
    const now = Date.now()
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i)
      if (key === null || !key.startsWith(CAPTURE_STORAGE_PREFIX)) continue
      if (isCaptureEntryInProgress(localStorage.getItem(key), today, yesterday, now)) return true
    }
  } catch {
    // Stockage inaccessible (mode privé) : rien n'y est persisté non plus.
  }
  return false
}

/** Un champ de saisie a-t-il le focus ? */
export function fieldFocused(): boolean {
  const el = document.activeElement
  if (!(el instanceof HTMLElement)) return false
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement ||
    el.isContentEditable
  )
}

function sessionGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}

function sessionSet(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value)
  } catch {
    /* stockage refusé : on se passe de la mémoire d'onglet */
  }
}

/**
 * Bascule sur la nouvelle version si le moment s'y prête. `targetSurface` :
 * l'onglet que l'utilisateur vient de demander, rouvert après le rechargement.
 * Rend vrai si la bascule est lancée (la page va se recharger).
 */
export function maybeApplyUpdate(trigger: UpdateTrigger, targetSurface?: SurfaceName): boolean {
  if (applyUpdate === null) return false
  const go = shouldApplyUpdate({
    trigger,
    updateReady,
    captureInProgress: captureInProgress(),
    fieldFocused: fieldFocused(),
    interactedSinceLoad,
    targetSurface,
  })
  if (!go) return false
  // Sans onglet visé (bascule au lancement), on garde celui qu'un rechargement
  // précédent venait de rouvrir : deux rechargements de suite ne le perdent pas.
  const surface = targetSurface ?? restoredSurface
  if (surface) sessionSet(SURFACE_KEY, surface)
  switching = true
  applyUpdate()
  return true
}

/**
 * Bascule demandée explicitement (bouton « Mettre à jour » du bloc Compte) : pas
 * de condition d'interaction, mais toujours aucune séance en cours.
 */
export function applyUpdateNow(targetSurface: SurfaceName): boolean {
  if (applyUpdate === null || !updateReady || captureInProgress()) return false
  sessionSet(SURFACE_KEY, targetSurface)
  switching = true
  applyUpdate()
  return true
}

/** Onglet mémorisé avant un rechargement, consommé à la lecture. */
export function takeSurfaceAfterReload(): SurfaceName | null {
  const surface = parseStoredSurface(sessionGet(SURFACE_KEY))
  restoredSurface = surface
  try {
    sessionStorage.removeItem(SURFACE_KEY)
  } catch {
    /* no-op */
  }
  return surface
}

/**
 * Un chunk n'a pas pu être chargé. Rend vrai si la page se recharge (une seule
 * fois, en ligne, hors séance en cours) ; sinon l'appelant laisse l'erreur
 * remonter à l'écran d'erreur.
 */
export function recoverFromChunkFailure(surface?: SurfaceName): boolean {
  const last = Number(sessionGet(CHUNK_RELOAD_KEY))
  const action = chunkFailureAction({
    online: navigator.onLine !== false,
    captureInProgress: captureInProgress(),
    lastReloadAt: Number.isFinite(last) && last > 0 ? last : null,
    now: Date.now(),
  })
  if (action !== 'reload') return false
  sessionSet(CHUNK_RELOAD_KEY, String(Date.now()))
  if (surface) sessionSet(SURFACE_KEY, surface)
  window.location.reload()
  return true
}

/** Une nouvelle version attend-elle ? (pour le bloc Compte) */
export function useUpdateReady(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => updateReady,
  )
}

/** À appeler une fois, au démarrage (main.tsx). */
export function initServiceWorker(): void {
  // Première interaction : au-delà, un rechargement spontané pourrait défaire un
  // geste en cours. Écouteurs en capture, retirés dès le premier événement.
  const markInteracted = () => {
    interactedSinceLoad = true
    window.removeEventListener('pointerdown', markInteracted, true)
    window.removeEventListener('keydown', markInteracted, true)
  }
  window.addEventListener('pointerdown', markInteracted, true)
  window.addEventListener('keydown', markInteracted, true)

  // Chunk introuvable : la reprise est branchée sur le rejet de l'`import()` de
  // l'écran paresseux (App.tsx), qui sait quel onglet rouvrir. On n'écoute pas
  // en plus `vite:preloadError` : Vite l'émet avant ce rejet, pour le même
  // échec, et un écouteur ici rechargerait sans connaître l'onglet visé.

  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      updateReady = true
      notify()
      maybeApplyUpdate('ready')
    },
    onNeedReload() {
      // Le service worker neuf contrôle la page. Si c'est nous qui l'avons
      // demandé, on recharge ; sinon un autre onglet du navigateur a basculé :
      // on ne recharge que si rien ne peut se perdre ici. À défaut la page reste
      // sur l'ancien bundle, et la reprise sur chunk introuvable fait le reste.
      if (
        switching ||
        shouldApplyUpdate({
          trigger: 'external',
          updateReady: true,
          captureInProgress: captureInProgress(),
          fieldFocused: fieldFocused(),
          interactedSinceLoad,
        })
      ) {
        window.location.reload()
      }
    },
    onRegisteredSW(_url, registration) {
      if (!registration) return
      // En mode écran d'accueil, iOS garde l'app suspendue des jours : sans
      // navigation, le navigateur ne cherche pas de nouveau service worker. On
      // le lui demande au retour au premier plan.
      let lastCheck = Date.now()
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return
        if (navigator.onLine === false) return
        if (Date.now() - lastCheck < UPDATE_CHECK_MIN_INTERVAL_MS) return
        lastCheck = Date.now()
        registration.update().catch(() => {})
      })
    },
  })
  applyUpdate = () => {
    void updateSW(true)
    // Filet : le rechargement suit normalement la prise de contrôle du service
    // worker neuf. S'il ne vient pas (événement manqué), la page resterait sur
    // l'ancien bundle avec le nouveau précache : on recharge nous-mêmes, sauf si
    // une saisie a commencé entre-temps (la reprise sur chunk introuvable suffit
    // alors).
    window.setTimeout(() => {
      if (!captureInProgress() && !fieldFocused()) window.location.reload()
    }, RELOAD_FALLBACK_MS)
  }
}
