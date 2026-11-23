// Fenêtre d'affichage faussée sur iPhone en mode écran d'accueil : détection PURE.
//
// Le symptôme (registre R4, diagnostic du 22 novembre 2026) : les barres fixes du
// bas se décrochent et restent décrochées jusqu'à la relance de l'app. La cause
// la plus probable est côté WebKit : après la fermeture du clavier, ou après un
// long passage en arrière-plan, il ne recalcule pas la fenêtre (`innerHeight`
// reste trop petit, ou la fenêtre visuelle reste décalée), et tout élément
// `position: fixed; bottom: 0` est placé contre cette mauvaise mesure.
//
// On ne peut pas empêcher WebKit de se tromper, seulement s'en apercevoir et le
// forcer à remesurer (`watch.ts`). Ce module décide « la mesure est-elle
// fausse ? » à partir de relevés, sans toucher au DOM.

/** Relevé des grandeurs de fenêtre à un instant donné. */
export interface ViewportSample {
  innerWidth: number
  innerHeight: number
  /** `visualViewport`, absent des moteurs anciens. */
  visualHeight: number | null
  visualOffsetTop: number | null
  visualScale: number | null
}

/** Plus grande hauteur observée pour une largeur donnée (une par orientation). */
export interface ViewportReference {
  width: number
  height: number
}

export type ViewportAnomaly =
  /** `innerHeight` sous la hauteur de référence : fenêtre de mise en page rétrécie. */
  | 'retrecie'
  /** Fenêtre visuelle plus courte que la fenêtre de mise en page, sans clavier. */
  | 'visuelle-retrecie'
  /** Fenêtre visuelle décalée vers le bas, sans clavier. */
  | 'decalee'
  /** Page zoomée (focus d'un champ sous 16 px) : une remesure n'y change rien. */
  | 'zoomee'

/** Écart toléré, en px CSS : en dessous, c'est de l'arrondi. */
export const VIEWPORT_TOLERANCE_PX = 4

/**
 * Met à jour la référence : la plus grande hauteur vue, remise à zéro quand la
 * largeur change (rotation, fenêtre de bureau redimensionnée), car la hauteur
 * attendue n'est alors plus la même.
 */
export function nextReference(
  previous: ViewportReference | null,
  sample: ViewportSample,
): ViewportReference {
  if (previous === null || previous.width !== sample.innerWidth) {
    return { width: sample.innerWidth, height: sample.innerHeight }
  }
  return sample.innerHeight > previous.height
    ? { width: previous.width, height: sample.innerHeight }
    : previous
}

/**
 * La fenêtre est-elle faussée ? `fieldFocused` : un champ a le focus, donc le
 * clavier est (ou sera) ouvert et réduit légitimement la fenêtre visuelle. On ne
 * juge alors que le zoom ; le reste se juge clavier fermé.
 */
export function detectViewportAnomaly(
  sample: ViewportSample,
  reference: ViewportReference | null,
  fieldFocused: boolean,
): ViewportAnomaly | null {
  if (sample.visualScale !== null && sample.visualScale > 1.01) return 'zoomee'
  if (fieldFocused) return null
  if (
    reference !== null &&
    reference.width === sample.innerWidth &&
    sample.innerHeight < reference.height - VIEWPORT_TOLERANCE_PX
  ) {
    return 'retrecie'
  }
  if (sample.visualOffsetTop !== null && sample.visualOffsetTop > VIEWPORT_TOLERANCE_PX) {
    return 'decalee'
  }
  if (
    sample.visualHeight !== null &&
    sample.visualHeight < sample.innerHeight - VIEWPORT_TOLERANCE_PX
  ) {
    return 'visuelle-retrecie'
  }
  return null
}

/** Une remesure forcée peut-elle corriger cette anomalie ? (pas un zoom) */
export function isRepairable(anomaly: ViewportAnomaly | null): boolean {
  return anomaly !== null && anomaly !== 'zoomee'
}

export interface PlatformInfo {
  userAgent: string
  platform: string
  maxTouchPoints: number
  /** `navigator.standalone` (propre à iOS) ou `display-mode: standalone`. */
  standalone: boolean
}

/**
 * Est-on dans la PWA installée sur iPhone ou iPad ? La surveillance ne tourne que
 * là : ailleurs les mêmes relevés sont légitimes (sur Android le clavier
 * rétrécit `innerHeight`, dans Safari la barre d'adresse le fait varier, sur
 * bureau la fenêtre se redimensionne). iPadOS se présente comme un Mac : on le
 * reconnaît à son écran tactile.
 */
export function isIosStandalone(info: PlatformInfo): boolean {
  const ios =
    /iPhone|iPad|iPod/.test(info.userAgent) ||
    (info.platform === 'MacIntel' && info.maxTouchPoints > 1)
  return ios && info.standalone
}

// --- Journal ------------------------------------------------------------------

/** Une anomalie relevée, avec ce que la remesure a donné. */
export interface ViewportIncident {
  /** Date ISO du relevé. */
  at: string
  /** Ce qui a déclenché le contrôle (`focusout`, `visibilitychange`, `pageshow`...). */
  trigger: string
  anomaly: ViewportAnomaly
  reference: ViewportReference | null
  before: ViewportSample
  /** Relevé après la remesure forcée, ou null si aucune n'a été tentée. */
  after: ViewportSample | null
  /** La remesure a-t-elle fait disparaître l'anomalie ? null si non tentée. */
  repaired: boolean | null
}

export const INCIDENT_LOG_LIMIT = 30

/** Ajoute un incident au journal en ne gardant que les plus récents. */
export function appendIncident(
  log: readonly ViewportIncident[],
  incident: ViewportIncident,
  limit = INCIDENT_LOG_LIMIT,
): ViewportIncident[] {
  return [...log, incident].slice(-limit)
}

/** Relit le journal persisté : tout ce qui n'a pas la forme attendue est écarté. */
export function parseIncidentLog(raw: string | null): ViewportIncident[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item): item is ViewportIncident =>
        !!item &&
        typeof item === 'object' &&
        typeof (item as ViewportIncident).at === 'string' &&
        typeof (item as ViewportIncident).trigger === 'string' &&
        typeof (item as ViewportIncident).anomaly === 'string' &&
        typeof (item as ViewportIncident).before === 'object' &&
        (item as ViewportIncident).before !== null,
    )
  } catch {
    return []
  }
}

function describeSample(sample: ViewportSample): string {
  const vv =
    sample.visualHeight === null
      ? 'vv absent'
      : `vv ${round(sample.visualHeight)} top ${round(sample.visualOffsetTop ?? 0)} x${round(sample.visualScale ?? 1)}`
  return `${sample.innerWidth}x${sample.innerHeight} ${vv}`
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

/** Une ligne lisible par incident, pour le relevé copiable. */
export function describeIncident(incident: ViewportIncident): string {
  const outcome =
    incident.repaired === null
      ? 'remesure non tentée'
      : incident.repaired
        ? 'réparé par la remesure'
        : 'NON réparé'
  const after = incident.after ? ` -> ${describeSample(incident.after)}` : ''
  const ref = incident.reference ? ` (réf. ${incident.reference.height})` : ''
  return `${incident.at} ${incident.trigger} ${incident.anomaly}${ref} : ${describeSample(incident.before)}${after}, ${outcome}`
}
