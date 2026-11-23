// Mise à jour de l'app : décisions PURES (aucun DOM, aucun service worker), pour
// être testables. Le câblage vit dans `register.ts`.
//
// Le problème : après un déploiement, le service worker neuf remplace le précache.
// Il prend la main dès son installation (`skipWaiting`, vite.config.ts), y compris
// sous une page ouverte : sans cela, une app installée avec un ancien bundle, qui
// ne sait pas lui demander de s'activer, resterait bloquée sur l'ancienne version.
// La page ouverte tourne alors sur l'ancien bundle, et c'est ELLE qui choisit le
// moment de recharger. Deux règles :
//   1. on ne recharge jamais pendant une séance en cours de saisie, un champ
//      focalisé, un brouillon ou une écriture directe déclarés, une
//      récupération de mot de passe, ni tant que des écritures de la file ne
//      tiennent qu'en mémoire, stockage de l'appareil plein (`reloadAllowed`,
//      vérifiée à l'instant du rechargement ; raisons relevées par
//      `currentBlockers`, reload-guards.ts) ;
//   2. on recharge là où rien ne se perd : au lancement, tant que l'utilisateur
//      n'a encore rien touché, ou à un changement d'onglet, qui démonte déjà
//      l'écran quitté.
// En attendant, l'ancien bundle reste utilisable : le chunk paresseux de
// l'Analyse est chargé en mémoire dès qu'une mise à jour s'annonce, avant que le
// précache ne soit remplacé (`register.ts`).

import { LAUNCH_EXPIRY_MS } from '../features/capture/state'

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

// --- Autorisation de recharger ------------------------------------------------

/** Ce qui, à l'instant présent, interdit de recharger la page. */
export interface ReloadGuards {
  /** Une séance est en cours de saisie sur cet appareil. */
  captureInProgress: boolean
  /** Un champ de saisie a le focus. */
  fieldFocused: boolean
  /**
   * Raisons qui interdisent de recharger (`currentBlockers`, reload-guards.ts) :
   * celles déclarées par le reste de l'app (`blockReloads` : brouillon non
   * enregistré, écriture en cours, récupération de mot de passe), et les
   * écritures de la file que l'appareil n'a pas pu stocker.
   */
  blockers: readonly string[]
}

/**
 * LA fonction d'autorisation : peut-on recharger la page maintenant sans rien
 * faire perdre ? Tout rechargement décidé par l'app passe par elle, au moment
 * même où il a lieu (jamais sur une réponse mise de côté plus tôt).
 */
export function reloadAllowed(guards: ReloadGuards): boolean {
  return !guards.captureInProgress && !guards.fieldFocused && guards.blockers.length === 0
}

/** Le moment où la question « recharge-t-on ? » est posée. */
export type ReloadTrigger =
  /** Le service worker neuf vient de prendre la main (ici ou depuis un autre onglet). */
  | 'activated'
  /** L'utilisateur change d'onglet. */
  | 'surface-change'
  /** Bouton « Mettre à jour » du bloc Compte. */
  | 'manual'

export interface ReloadContext extends ReloadGuards {
  trigger: ReloadTrigger
  /** Une nouvelle version est active, la page tourne encore sur l'ancien bundle. */
  reloadPending: boolean
  /** L'utilisateur a touché l'écran ou le clavier depuis le chargement de la page. */
  interactedSinceLoad: boolean
  /** Onglet visé par le changement (trigger `surface-change`). */
  targetSurface?: string
}

/**
 * Faut-il recharger MAINTENANT pour passer sur la nouvelle version ?
 *
 * - jamais sans version en attente, ni sans l'autorisation (`reloadAllowed`) ;
 * - `activated` : seulement si l'utilisateur n'a encore rien touché (lancement
 *   de l'app : le rechargement passe pour la fin du démarrage). Après une
 *   interaction, on attend un point sûr ;
 * - `surface-change` : oui, sauf vers la Capture. L'écran quitté est démonté de
 *   toute façon, et on ne retarde pas le lancement d'une séance ;
 * - `manual` : l'utilisateur le demande, l'autorisation suffit.
 * Un refus n'est pas définitif : la version reste en attente du point sûr suivant.
 */
export function shouldReload(ctx: ReloadContext): boolean {
  if (!ctx.reloadPending) return false
  if (!reloadAllowed(ctx)) return false
  switch (ctx.trigger) {
    case 'activated':
      return !ctx.interactedSinceLoad
    case 'surface-change':
      return ctx.targetSurface !== 'capture'
    case 'manual':
      return true
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
  /**
   * La demande qui a provoqué l'import est-elle toujours d'actualité ?
   * (l'utilisateur est encore sur l'écran dont le chunk manque)
   */
  requestActive: boolean
  /** Résultat de `reloadAllowed` au moment de l'échec. */
  allowed: boolean
  /** Horodatage du dernier rechargement automatique pour cette raison, ou null. */
  lastReloadAt: number | null
  now: number
}

/**
 * Un chunk n'a pas pu être chargé (build remplacé sous la page, cache vidé par
 * le système) : recharger la page ramène un shell et des chunks cohérents.
 * - `ignore` : l'utilisateur a quitté l'écran entre-temps, on ne recharge pas
 *   sous ses pieds ; l'import sera retenté s'il y revient ;
 * - `reload` : une seule fois, en ligne, avec l'autorisation de recharger ;
 * - `report` : sinon, l'écran d'erreur explique et laisse recharger à la main.
 */
export function chunkFailureAction(ctx: ChunkFailureContext): 'reload' | 'report' | 'ignore' {
  if (!ctx.requestActive) return 'ignore'
  if (!ctx.online) return 'report'
  if (!ctx.allowed) return 'report'
  if (ctx.lastReloadAt !== null && ctx.now - ctx.lastReloadAt < CHUNK_RELOAD_COOLDOWN_MS) {
    return 'report'
  }
  return 'reload'
}

/**
 * Suit LA demande d'import en cours d'un écran paresseux. `begin` ouvre une
 * demande (et périme la précédente), `invalidate` la périme : l'utilisateur a
 * quitté l'écran, ou l'app authentifiée a été démontée (déconnexion). Le rejet
 * d'un import ne compte que si SA demande est toujours celle en cours.
 */
export class ImportRequests {
  private current: number | null = null
  private last = 0

  begin(): number {
    this.last += 1
    this.current = this.last
    return this.last
  }

  invalidate(): void {
    this.current = null
  }

  isActive(id: number): boolean {
    return this.current === id
  }
}

// --- Prise de contrôle du service worker ---------------------------------------

/**
 * Un `controllerchange` signifie-t-il qu'une NOUVELLE version a pris la main
 * sous une page chargée par l'ancienne ? Oui si la page avait déjà un contrôleur
 * à son démarrage. Sinon c'est la première installation : le worker prend en
 * charge une page qu'il n'avait pas servie, et son bundle est déjà le bon.
 */
export function isControllerReplacement(hadControllerAtStart: boolean): boolean {
  return hadControllerAtStart
}

/**
 * À l'enregistrement, une mise à jour est-elle DÉJÀ en cours d'installation
 * (lancée par un autre onglet avant que cette page ne s'abonne) ? La page a
 * alors manqué `updatefound` : il faut mettre ses chunks paresseux à l'abri tout
 * de suite. Le rechargement, lui, n'est marqué en attente qu'à la prise de
 * contrôle (`controllerchange`) : recharger avant resservirait l'ancien bundle.
 */
export function updateAlreadyInstalling(registration: {
  hasController: boolean
  installing: boolean
  waiting: boolean
}): boolean {
  return registration.hasController && (registration.installing || registration.waiting)
}

// --- Onglet à rouvrir après le rechargement -----------------------------------

const SURFACES = ['capture', 'analysis', 'seances', 'exercises'] as const
export type SurfaceName = (typeof SURFACES)[number]

/** Valide l'onglet mémorisé avant un rechargement (valeur lue du stockage). */
export function parseStoredSurface(raw: string | null): SurfaceName | null {
  return (SURFACES as readonly string[]).includes(raw ?? '') ? (raw as SurfaceName) : null
}
