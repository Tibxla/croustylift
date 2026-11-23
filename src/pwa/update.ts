// Mise à jour de l'app : décisions PURES (aucun DOM, aucun service worker), pour
// être testables. Le câblage vit dans `register.ts`.
//
// Le problème : après un déploiement, le service worker neuf remplace le précache.
// S'il prend la main sous une page ouverte, celle-ci tourne sur l'ancien bundle
// avec les fichiers du nouveau : le chunk paresseux de l'Analyse a disparu. Le
// service worker neuf reste donc EN ATTENTE (vite.config.ts) et l'app choisit le
// moment de basculer, c'est-à-dire de recharger. Deux règles :
//   1. on ne recharge jamais pendant une séance en cours de saisie, ni pendant
//      qu'un champ a le focus ;
//   2. on recharge là où rien ne se perd : au lancement, tant que l'utilisateur
//      n'a encore rien touché, ou à un changement d'onglet, qui démonte déjà
//      l'écran quitté.
// Tant que rien n'est décidé, l'ancien service worker sert l'ancien précache en
// entier : l'app ouverte reste cohérente, hors ligne compris.

import { LAUNCH_EXPIRY_MS } from '../features/capture/state'

/** Préfixe des états de Capture persistés (`storageKey`, features/capture/state.ts). */
export const CAPTURE_STORAGE_PREFIX = 'croustylift:capture:'

/**
 * Cet état de Capture persisté décrit-il une séance EN COURS ? Lu tel quel dans
 * le stockage, donc tolérant : une entrée illisible ne bloque pas la mise à jour
 * (la Capture l'ignore elle aussi à la restauration).
 *
 * Mêmes bornes que la reprise de séance (`resolveCaptureDate`, `isResumable`) :
 * l'état d'aujourd'hui ou de la veille (séance à cheval sur minuit), portant au
 * moins une série ou une note datée, ou lancé depuis moins d'une heure. Un
 * lancement oublié sans série, ou un état vieux de plusieurs jours, n'est plus
 * une séance en cours : il ne doit pas retenir la mise à jour indéfiniment.
 */
export function isCaptureEntryInProgress(
  raw: string | null,
  today: string,
  yesterday: string,
  now: number,
): boolean {
  if (!raw) return false
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return false
  }
  if (!parsed || typeof parsed !== 'object') return false
  const state = parsed as {
    date?: unknown
    startedAt?: unknown
    progress?: unknown
    datedNotes?: unknown
  }
  if (state.date !== today && state.date !== yesterday) return false

  if (state.progress && typeof state.progress === 'object') {
    for (const value of Object.values(state.progress as Record<string, unknown>)) {
      const sets = (value as { sets?: unknown } | null)?.sets
      if (Array.isArray(sets) && sets.length > 0) return true
    }
  }
  if (
    state.datedNotes &&
    typeof state.datedNotes === 'object' &&
    Object.keys(state.datedNotes).length > 0
  ) {
    return true
  }
  return (
    typeof state.startedAt === 'number' &&
    Number.isFinite(state.startedAt) &&
    now - state.startedAt <= LAUNCH_EXPIRY_MS
  )
}

/** Ce qui déclenche la question « peut-on basculer maintenant ? ». */
export type UpdateTrigger =
  /** Le service worker neuf vient de se mettre en attente. */
  | 'ready'
  /** L'utilisateur change d'onglet. */
  | 'surface-change'
  /** Un autre onglet du navigateur a fait basculer le service worker. */
  | 'external'

export interface UpdateContext {
  trigger: UpdateTrigger
  /** Un service worker neuf attend. */
  updateReady: boolean
  /** Une séance est en cours de saisie sur cet appareil. */
  captureInProgress: boolean
  /** Un champ de saisie a le focus. */
  fieldFocused: boolean
  /** L'utilisateur a touché l'écran ou le clavier depuis le chargement de la page. */
  interactedSinceLoad: boolean
  /** Onglet visé par le changement (trigger `surface-change`). */
  targetSurface?: string
}

/**
 * Faut-il basculer sur la nouvelle version MAINTENANT (donc recharger la page) ?
 *
 * - jamais sans mise à jour en attente, ni séance en cours, ni champ en saisie ;
 * - `ready` et `external` : seulement si l'utilisateur n'a encore rien touché
 *   (lancement de l'app : le rechargement passe pour la fin du démarrage). Après
 *   une interaction, un écran peut porter un brouillon que l'app ne connaît pas ;
 * - `surface-change` : oui, sauf vers la Capture. L'écran quitté est démonté de
 *   toute façon, et on ne retarde pas le lancement d'une séance par un
 *   rechargement.
 */
export function shouldApplyUpdate(ctx: UpdateContext): boolean {
  if (!ctx.updateReady) return false
  if (ctx.captureInProgress) return false
  if (ctx.fieldFocused) return false
  switch (ctx.trigger) {
    case 'ready':
    case 'external':
      return !ctx.interactedSinceLoad
    case 'surface-change':
      return ctx.targetSurface !== 'capture'
  }
}

// --- Chunk introuvable -------------------------------------------------------

/**
 * L'erreur vient-elle d'un `import()` dynamique qui n'a pas pu charger son
 * fichier ? Les libellés diffèrent d'un moteur à l'autre (Chromium, Firefox,
 * WebKit), aucun type d'erreur dédié n'existe.
 */
export function isChunkLoadError(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  return /dynamically imported module|importing a module script failed|unable to preload css|failed to load module script/i.test(
    message,
  )
}

/** Délai sous lequel un second rechargement automatique serait une boucle. */
export const CHUNK_RELOAD_COOLDOWN_MS = 5 * 60 * 1000

export interface ChunkFailureContext {
  /** Le navigateur se dit en ligne. */
  online: boolean
  /** Une séance est en cours de saisie. */
  captureInProgress: boolean
  /** Horodatage du dernier rechargement automatique pour cette raison, ou null. */
  lastReloadAt: number | null
  now: number
}

/**
 * Un chunk n'a pas pu être chargé (build remplacé sous la page, cache vidé par
 * le système) : recharger la page ramène un shell et des chunks cohérents.
 * `reload` : une seule fois, en ligne, hors séance en cours. Sinon `report` :
 * l'écran d'erreur explique et laisse l'utilisateur recharger lui-même.
 */
export function chunkFailureAction(ctx: ChunkFailureContext): 'reload' | 'report' {
  if (!ctx.online) return 'report'
  if (ctx.captureInProgress) return 'report'
  if (ctx.lastReloadAt !== null && ctx.now - ctx.lastReloadAt < CHUNK_RELOAD_COOLDOWN_MS) {
    return 'report'
  }
  return 'reload'
}

// --- Onglet à rouvrir après le rechargement -----------------------------------

const SURFACES = ['capture', 'analysis', 'seances', 'exercises'] as const
export type SurfaceName = (typeof SURFACES)[number]

/** Valide l'onglet mémorisé avant un rechargement (valeur lue du stockage). */
export function parseStoredSurface(raw: string | null): SurfaceName | null {
  return (SURFACES as readonly string[]).includes(raw ?? '') ? (raw as SurfaceName) : null
}
