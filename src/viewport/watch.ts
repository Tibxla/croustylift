// Surveillance de la fenêtre d'affichage sur iPhone en mode écran d'accueil :
// remesure forcée quand WebKit s'est trompé, journal des incidents, et relevé de
// diagnostic consultable sur l'appareil (`DiagPanel.tsx`). Les décisions sont
// dans `anomaly.ts` (pur, testé) ; ici, les effets.
//
// Trois moments où WebKit peut garder une mauvaise mesure, donc trois contrôles :
// la fermeture du clavier (`focusout`), le retour au premier plan
// (`visibilitychange`, `pageshow`), et tout changement de la fenêtre visuelle
// sans champ focalisé. Le contrôle est différé : le clavier met environ 250 ms à
// descendre, juger plus tôt verrait une anomalie dans une animation normale.
//
// La remesure n'est tentée QUE sur anomalie détectée : elle masque puis réaffiche
// `#root`, ce qui rejoue les animations d'entrée. C'est la seule manœuvre
// rapportée comme efficace en mode écran d'accueil (ni `scrollTo`, ni `blur`, ni
// les écouteurs `visualViewport` seuls ne corrigent la mesure). Comme elle efface
// la preuve, chaque incident est journalisé avant et après, sur l'appareil.
//
// Hors iPhone ou iPad installé, rien ne tourne : les mêmes relevés y sont
// légitimes (voir `isIosStandalone`). `?diag=1` force la surveillance et ouvre le
// relevé, pour l'essayer sur un navigateur de bureau.

import { useSyncExternalStore } from 'react'
import { APP_VERSION_LABEL } from '../version'
import {
  appendIncident,
  describeIncident,
  detectViewportAnomaly,
  isIosStandalone,
  nextReference,
  parseIncidentLog,
  shouldAttemptRepair,
  type ViewportIncident,
  type ViewportReference,
  type ViewportSample,
} from './anomaly'

const LOG_KEY = 'croustylift:diag:fenetre'
/** Attente avant de juger : le clavier doit avoir fini de descendre. */
const SETTLE_MS = 400
/** Pas plus d'une remesure par fenêtre de temps : une anomalie tenace ne doit pas faire clignoter l'app. */
const REPAIR_COOLDOWN_MS = 5000
/** Un même constat répété dans ce délai n'est journalisé qu'une fois. */
const DEDUPE_MS = 10_000

let reference: ViewportReference | null = null
let active = false
let timer: number | undefined
let lastRepairAt = 0
/** Relevé sur lequel la dernière remesure a échoué (voir `shouldAttemptRepair`). */
let failedOn: ViewportSample | null = null
let lastCheck = 'aucun contrôle'

interface DiagState {
  open: boolean
  text: string
}
let diag: DiagState = { open: false, text: '' }
const listeners = new Set<() => void>()

function setDiag(next: DiagState): void {
  diag = next
  for (const listener of listeners) listener()
}

export function sampleViewport(): ViewportSample {
  const vv = window.visualViewport
  return {
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    visualHeight: vv ? vv.height : null,
    visualOffsetTop: vv ? vv.offsetTop : null,
    visualScale: vv ? vv.scale : null,
  }
}

function isFieldFocused(): boolean {
  const el = document.activeElement
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement ||
    (el instanceof HTMLElement && el.isContentEditable)
  )
}

function readLog(): ViewportIncident[] {
  try {
    return parseIncidentLog(localStorage.getItem(LOG_KEY))
  } catch {
    return []
  }
}

function writeLog(log: ViewportIncident[]): void {
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(log))
  } catch {
    /* quota plein ou mode privé : le journal reste facultatif */
  }
}

function logIncident(incident: ViewportIncident): void {
  const log = readLog()
  const last = log[log.length - 1]
  if (
    last &&
    last.anomaly === incident.anomaly &&
    last.repaired === incident.repaired &&
    last.before.innerHeight === incident.before.innerHeight &&
    Date.parse(incident.at) - Date.parse(last.at) < DEDUPE_MS
  ) {
    return
  }
  writeLog(appendIncident(log, incident))
}

/**
 * Force WebKit à remesurer la fenêtre : `#root` sort de la mise en page puis y
 * revient, avec une lecture de géométrie entre les deux pour que les deux états
 * soient réellement calculés. Les positions de défilement (document et
 * conteneurs internes), perdues au passage, sont restaurées.
 */
export function forceRemeasure(): void {
  const root = document.getElementById('root')
  if (!root) return
  const { scrollX, scrollY } = window
  const scrolled: [Element, number][] = []
  for (const el of root.querySelectorAll('*')) {
    if (el.scrollTop > 0) scrolled.push([el, el.scrollTop])
  }
  const previous = root.style.display
  root.style.display = 'none'
  void root.offsetHeight
  root.style.display = previous
  void root.offsetHeight
  for (const [el, top] of scrolled) el.scrollTop = top
  window.scrollTo(scrollX, scrollY)
}

function check(trigger: string): void {
  const before = sampleViewport()
  const focused = isFieldFocused()
  reference = nextReference(reference, before)
  const anomaly = detectViewportAnomaly(before, reference, focused)
  const at = new Date().toISOString()
  lastCheck = `${at} ${trigger} : ${anomaly ?? 'rien'}`
  if (anomaly === null) {
    failedOn = null
    if (diag.open) refreshDiag()
    return
  }
  const usedReference = reference
  const now = Date.now()
  if (!shouldAttemptRepair(anomaly, before, failedOn) || now - lastRepairAt < REPAIR_COOLDOWN_MS) {
    logIncident({ at, trigger, anomaly, reference: usedReference, before, after: null, repaired: null })
    if (diag.open) refreshDiag()
    return
  }
  lastRepairAt = now
  forceRemeasure()
  // Deux images plus tard : le moteur a eu le temps de refaire sa mise en page.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const after = sampleViewport()
      reference = nextReference(reference, after)
      const repaired = detectViewportAnomaly(after, reference, isFieldFocused()) === null
      failedOn = repaired ? null : after
      logIncident({ at, trigger, anomaly, reference: usedReference, before, after, repaired })
      if (diag.open) refreshDiag()
    }),
  )
}

function scheduleCheck(trigger: string): void {
  if (!active) return
  window.clearTimeout(timer)
  timer = window.setTimeout(() => check(trigger), SETTLE_MS)
}

// --- Relevé de diagnostic -------------------------------------------------------

function safeAreaInsets(): { top: number; bottom: number } {
  const probe = document.createElement('div')
  probe.style.cssText =
    'position:fixed;top:0;left:0;width:0;visibility:hidden;pointer-events:none;' +
    'padding-top:var(--safe-top);padding-bottom:var(--safe-bottom)'
  document.body.appendChild(probe)
  const style = getComputedStyle(probe)
  const insets = { top: parseFloat(style.paddingTop) || 0, bottom: parseFloat(style.paddingBottom) || 0 }
  probe.remove()
  return insets
}

function r(value: number): number {
  return Math.round(value * 100) / 100
}

/** Le relevé complet, en texte : affiché dans le panneau et copiable tel quel. */
export function buildDiagText(): string {
  const s = sampleViewport()
  const doc = document.documentElement
  const insets = safeAreaInsets()
  const focused = document.activeElement
  const anomaly = detectViewportAnomaly(s, reference, isFieldFocused())
  const lines = [
    `Croustylift ${APP_VERSION_LABEL}`,
    new Date().toISOString(),
    navigator.userAgent,
    `installée : ${isStandalone() ? 'oui' : 'non'} · surveillance : ${active ? 'active' : 'inactive'}`,
    '',
    `innerHeight ${s.innerHeight} (référence ${reference?.height ?? 'aucune'}) · innerWidth ${s.innerWidth}`,
    `screen ${window.screen.width}x${window.screen.height} · clientHeight ${doc.clientHeight} · scrollHeight ${doc.scrollHeight} · scrollY ${r(window.scrollY)}`,
    s.visualHeight === null
      ? 'visualViewport absent'
      : `visualViewport height ${r(s.visualHeight)} · offsetTop ${r(s.visualOffsetTop ?? 0)} · scale ${r(s.visualScale ?? 1)}`,
    `encoches : haut ${insets.top} · bas ${insets.bottom}`,
    `champ focalisé : ${focused && focused !== document.body ? focused.tagName.toLowerCase() : 'aucun'}`,
    `anomalie actuelle : ${anomaly ?? 'aucune'}`,
    '',
    'Navigation et barres collées ou fixes (haut, bas, écart au bas de fenêtre) :',
  ]
  // Les barres du bas sont collées en `sticky` depuis la refonte E ; les feuilles
  // et éditeurs plein écran hérités restent en `fixed`.
  const bars = [...document.querySelectorAll<HTMLElement>('#root nav, #root .fixed, #root .sticky')].filter(
    (el) => !el.closest('[data-diag-panel]') && el.getBoundingClientRect().height < s.innerHeight / 2,
  )
  if (bars.length === 0) lines.push('  aucune à l’écran')
  for (const el of bars) {
    const rect = el.getBoundingClientRect()
    if (rect.height === 0) continue
    const name = el.getAttribute('aria-label') ?? (el.textContent ?? '').trim().slice(0, 28) ?? el.tagName
    lines.push(`  ${name || el.tagName.toLowerCase()} : ${r(rect.top)} · ${r(rect.bottom)} · ${r(s.innerHeight - rect.bottom)}`)
  }
  const log = readLog()
  lines.push('', `Dernier contrôle : ${lastCheck}`, '', `Incidents journalisés (${log.length}) :`)
  if (log.length === 0) lines.push('  aucun')
  for (const incident of [...log].reverse()) lines.push(`  ${describeIncident(incident)}`)
  return lines.join('\n')
}

function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean }
  return nav.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true
}

export function refreshDiag(): void {
  setDiag({ open: diag.open, text: buildDiagText() })
}

export function openDiag(): void {
  setDiag({ open: true, text: buildDiagText() })
}

export function closeDiag(): void {
  setDiag({ open: false, text: '' })
}

export function clearIncidentLog(): void {
  writeLog([])
  refreshDiag()
}

/** Remesure demandée à la main depuis le relevé : journalisée comme les autres. */
export function repairFromDiag(): void {
  const before = sampleViewport()
  const usedReference = reference
  const anomaly = detectViewportAnomaly(before, reference, false)
  forceRemeasure()
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const after = sampleViewport()
      if (anomaly !== null) {
        logIncident({
          at: new Date().toISOString(),
          trigger: 'manuel',
          anomaly,
          reference: usedReference,
          before,
          after,
          repaired: detectViewportAnomaly(after, reference, false) === null,
        })
      }
      refreshDiag()
    }),
  )
}

export function useDiag(): DiagState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => diag,
  )
}

/** À appeler une fois, au démarrage (main.tsx). */
export function startViewportWatch(): void {
  const forced = new URLSearchParams(window.location.search).get('diag') === '1'
  active =
    forced ||
    isIosStandalone({
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      maxTouchPoints: navigator.maxTouchPoints,
      standalone: isStandalone(),
    })
  reference = nextReference(null, sampleViewport())
  if (forced) openDiag()
  if (!active) return

  document.addEventListener('focusout', () => scheduleCheck('focusout'), true)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleCheck('visibilitychange')
  })
  window.addEventListener('pageshow', () => scheduleCheck('pageshow'))
  window.addEventListener('resize', () => scheduleCheck('resize'))
  window.visualViewport?.addEventListener('resize', () => scheduleCheck('visualViewport.resize'))
  window.visualViewport?.addEventListener('scroll', () => scheduleCheck('visualViewport.scroll'))
}
