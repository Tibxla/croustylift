// Enregistrement du service worker et passage contrôlé sur une nouvelle version.
// Les décisions sont dans `update.ts` (pur, testé) ; ici, seulement les effets :
// écouteurs, stockage, rechargement.

import { useSyncExternalStore } from 'react'
import { registerSW } from 'virtual:pwa-register'
import { STORAGE_PREFIX, previousDayIso, todayIso } from '../features/capture/state'
import { activeBlockers } from './blockers'
import {
  chunkFailureAction,
  isControllerReplacement,
  isCaptureEntryInProgress,
  parseStoredSurface,
  reloadAllowed,
  shouldReload,
  updateAlreadyInstalling,
  type ReloadGuards,
  type ReloadTrigger,
  type SurfaceName,
} from './update'

/** Onglet à rouvrir après un rechargement décidé par l'app (durée de l'onglet). */
const SURFACE_KEY = 'croustylift:surface-apres-rechargement'
/** Horodatage du dernier rechargement dû à un chunk introuvable (anti-boucle). */
const CHUNK_RELOAD_KEY = 'croustylift:rechargement-chunk'
/** Intervalle minimal entre deux recherches de mise à jour au retour au premier plan. */
const UPDATE_CHECK_MIN_INTERVAL_MS = 10 * 60 * 1000

/** Une nouvelle version est active, la page tourne encore sur l'ancien bundle. */
let reloadPending = false
let interactedSinceLoad = false
/** Onglet rouvert au chargement de cette page, repris si un second rechargement suit. */
let restoredSurface: SurfaceName | null = null
/** Charge en mémoire les chunks paresseux de l'app (fourni par App.tsx). */
let preloadLazyChunks: (() => void) | null = null
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
      if (key === null || !key.startsWith(STORAGE_PREFIX)) continue
      if (isCaptureEntryInProgress(localStorage.getItem(key), today, yesterday, now)) return true
    }
  } catch {
    // Stockage inaccessible (mode privé) : rien n'y est persisté non plus.
  }
  return false
}

function fieldFocused(): boolean {
  const el = document.activeElement
  if (!(el instanceof HTMLElement)) return false
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement ||
    el.isContentEditable
  )
}

/** L'état des gardes, relu à chaque question : jamais mis de côté. */
function currentGuards(): ReloadGuards {
  return {
    captureInProgress: captureInProgress(),
    fieldFocused: fieldFocused(),
    blockers: activeBlockers(),
  }
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
 * Recharge la page sur la nouvelle version si le moment s'y prête. La décision
 * et le rechargement sont pris dans le même appel synchrone : rien ne peut
 * commencer entre les deux. `targetSurface` : l'onglet que l'utilisateur vient
 * de demander, rouvert après le rechargement. Rend vrai si la page recharge ;
 * sinon la version reste en attente du point sûr suivant.
 */
export function requestReload(trigger: ReloadTrigger, targetSurface?: SurfaceName): boolean {
  const go = shouldReload({
    ...currentGuards(),
    trigger,
    reloadPending,
    interactedSinceLoad,
    targetSurface,
  })
  if (!go) return false
  // Sans onglet visé (rechargement au lancement), on garde celui qu'un
  // rechargement précédent venait de rouvrir.
  const surface = targetSurface ?? restoredSurface
  if (surface) sessionSet(SURFACE_KEY, surface)
  window.location.reload()
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
 * Un chunk n'a pas pu être chargé pour l'onglet `surface`. `requestActive` :
 * l'utilisateur est-il encore sur cet onglet ? Rend `reload` si la page se
 * recharge, `ignore` si la demande a été quittée (l'appelant oublie l'échec et
 * retentera), `report` si l'erreur doit remonter à l'écran d'erreur.
 */
export function recoverFromChunkFailure(
  surface: SurfaceName,
  requestActive: boolean,
): 'reload' | 'report' | 'ignore' {
  const last = Number(sessionGet(CHUNK_RELOAD_KEY))
  const action = chunkFailureAction({
    online: navigator.onLine !== false,
    requestActive,
    allowed: reloadAllowed(currentGuards()),
    lastReloadAt: Number.isFinite(last) && last > 0 ? last : null,
    now: Date.now(),
  })
  if (action === 'reload') {
    sessionSet(CHUNK_RELOAD_KEY, String(Date.now()))
    sessionSet(SURFACE_KEY, surface)
    window.location.reload()
  }
  return action
}

/**
 * Déclare comment charger en mémoire les chunks paresseux. Appelé dès qu'une
 * mise à jour s'annonce, AVANT que le service worker neuf ne remplace le
 * précache : l'app ouverte garde ainsi tous ses écrans, même si elle ne peut pas
 * recharger tout de suite (séance en cours).
 */
export function setLazyChunkPreloader(preload: () => void): void {
  preloadLazyChunks = preload
}

/** Une nouvelle version attend-elle un rechargement ? (pour le bloc Compte) */
export function useUpdateReady(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => reloadPending,
  )
}

/**
 * Met à l'abri les chunks paresseux dès qu'une mise à jour s'installe (plusieurs
 * secondes de téléchargement avant qu'elle ne remplace le précache) : soit on la
 * voit commencer (`updatefound`), soit elle a commencé avant notre abonnement.
 * Peut être appelé plusieurs fois pour la même inscription : un import déjà fait
 * ne coûte rien.
 */
function shelterLazyChunks(registration: ServiceWorkerRegistration): void {
  registration.addEventListener('updatefound', () => {
    if (navigator.serviceWorker.controller) preloadLazyChunks?.()
  })
  if (
    updateAlreadyInstalling({
      hasController: navigator.serviceWorker.controller !== null,
      installing: registration.installing !== null,
      waiting: registration.waiting !== null,
    })
  ) {
    preloadLazyChunks?.()
  }
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
  // l'écran paresseux (App.tsx), qui sait quel onglet est demandé. On n'écoute
  // pas en plus `vite:preloadError` : Vite l'émet avant ce rejet, pour le même
  // échec, et un écouteur ici rechargerait sans connaître l'onglet visé.

  // Une nouvelle version vient de prendre la main sous cette page : on le note
  // et on recharge si c'est permis maintenant, sinon au prochain point sûr.
  const markUpdateActive = () => {
    if (reloadPending) return
    reloadPending = true
    notify()
    requestReload('activated')
  }

  // Écouté dès le démarrage, sans dépendre de l'enregistrement : une page ouverte
  // pendant qu'un autre onglet installe la mise à jour s'abonne trop tard pour
  // les événements du client d'enregistrement, mais voit toujours son contrôleur
  // changer. On distingue le remplacement de la première installation.
  if ('serviceWorker' in navigator) {
    const hadController = navigator.serviceWorker.controller !== null
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (isControllerReplacement(hadController)) markUpdateActive()
    })
    // Même raison pour la mise à l'abri des chunks : `register()` ne rend la
    // main qu'une fois l'installation en cours terminée (les opérations d'un
    // même périmètre sont mises en file), donc trop tard. `getRegistration()`,
    // lui, répond tout de suite.
    void navigator.serviceWorker
      .getRegistration()
      .then((registration) => {
        if (registration) shelterLazyChunks(registration)
      })
      .catch(() => {})
  }

  registerSW({
    immediate: true,
    onNeedReload: markUpdateActive,
    onRegisteredSW(_url, registration) {
      if (!registration) return
      shelterLazyChunks(registration)
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
}
