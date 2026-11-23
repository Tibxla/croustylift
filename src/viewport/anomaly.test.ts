import { describe, expect, it } from 'vitest'
import {
  appendIncident,
  describeIncident,
  detectViewportAnomaly,
  isIosStandalone,
  isRepairable,
  sameReading,
  shouldAttemptRepair,
  nextReference,
  parseIncidentLog,
  type ViewportIncident,
  type ViewportSample,
} from './anomaly'

/** iPhone Pro Max en mode écran d'accueil, fenêtre saine. */
const SAIN: ViewportSample = {
  innerWidth: 430,
  innerHeight: 932,
  visualHeight: 932,
  visualOffsetTop: 0,
  visualScale: 1,
}
const REF = { width: 430, height: 932 }

describe('nextReference', () => {
  it('retient la plus grande hauteur vue', () => {
    expect(nextReference(null, SAIN)).toEqual(REF)
    expect(nextReference(REF, { ...SAIN, innerHeight: 873 })).toEqual(REF)
    expect(nextReference({ width: 430, height: 873 }, SAIN)).toEqual(REF)
  })

  it('repart de zéro quand la largeur change (rotation)', () => {
    const paysage = { ...SAIN, innerWidth: 932, innerHeight: 430 }
    expect(nextReference(REF, paysage)).toEqual({ width: 932, height: 430 })
  })
})

describe('detectViewportAnomaly', () => {
  it('fenêtre saine : rien', () => {
    expect(detectViewportAnomaly(SAIN, REF, false)).toBeNull()
  })

  it("innerHeight resté rétréci de la hauteur de l'encoche après le clavier", () => {
    const sample = { ...SAIN, innerHeight: 873, visualHeight: 873 }
    expect(detectViewportAnomaly(sample, REF, false)).toBe('retrecie')
  })

  it("un écart d'arrondi n'est pas une anomalie", () => {
    const sample = { ...SAIN, innerHeight: 929, visualHeight: 929.5 }
    expect(detectViewportAnomaly(sample, REF, false)).toBeNull()
  })

  it('fenêtre visuelle restée décalée', () => {
    expect(detectViewportAnomaly({ ...SAIN, visualOffsetTop: 59 }, REF, false)).toBe('decalee')
  })

  it('fenêtre visuelle restée plus courte que la fenêtre de mise en page', () => {
    expect(detectViewportAnomaly({ ...SAIN, visualHeight: 908 }, REF, false)).toBe(
      'visuelle-retrecie',
    )
  })

  it('clavier ouvert (champ focalisé) : la fenêtre visuelle réduite est normale', () => {
    const clavier = { ...SAIN, visualHeight: 560, visualOffsetTop: 120 }
    expect(detectViewportAnomaly(clavier, REF, true)).toBeNull()
  })

  it('page zoomée : signalée même champ focalisé, et non réparable', () => {
    const zoom = { ...SAIN, visualScale: 1.14, visualHeight: 817 }
    expect(detectViewportAnomaly(zoom, REF, true)).toBe('zoomee')
    expect(detectViewportAnomaly(zoom, REF, false)).toBe('zoomee')
    expect(isRepairable('zoomee')).toBe(false)
    expect(isRepairable('retrecie')).toBe(true)
    expect(isRepairable(null)).toBe(false)
  })

  it("une référence prise dans l'autre orientation ne sert pas", () => {
    const paysage = { ...SAIN, innerWidth: 932, innerHeight: 430, visualHeight: 430 }
    expect(detectViewportAnomaly(paysage, REF, false)).toBeNull()
  })

  it('sans visualViewport, seul innerHeight est jugé', () => {
    const ancien = { ...SAIN, visualHeight: null, visualOffsetTop: null, visualScale: null }
    expect(detectViewportAnomaly(ancien, REF, false)).toBeNull()
    expect(detectViewportAnomaly({ ...ancien, innerHeight: 873 }, REF, false)).toBe('retrecie')
  })
})

describe('shouldAttemptRepair', () => {
  const retrecie = { ...SAIN, innerHeight: 873, visualHeight: 873 }

  it('première anomalie réparable : on tente', () => {
    expect(shouldAttemptRepair('retrecie', retrecie, null)).toBe(true)
  })

  it('jamais pour un zoom ni sans anomalie', () => {
    expect(shouldAttemptRepair('zoomee', retrecie, null)).toBe(false)
    expect(shouldAttemptRepair(null, SAIN, null)).toBe(false)
  })

  it("la remesure a déjà échoué sur ce relevé : on ne la rejoue pas", () => {
    expect(shouldAttemptRepair('retrecie', retrecie, retrecie)).toBe(false)
    expect(shouldAttemptRepair('retrecie', { ...retrecie, innerHeight: 874 }, retrecie)).toBe(false)
  })

  it('le relevé a changé depuis l’échec : on retente', () => {
    expect(shouldAttemptRepair('retrecie', { ...retrecie, innerHeight: 850, visualHeight: 850 }, retrecie)).toBe(true)
    expect(shouldAttemptRepair('decalee', { ...SAIN, visualOffsetTop: 59 }, retrecie)).toBe(true)
  })

  it('sameReading compare à la tolérance près, et distingue un visualViewport absent', () => {
    expect(sameReading(SAIN, { ...SAIN, visualHeight: 930 })).toBe(true)
    expect(sameReading(SAIN, { ...SAIN, visualHeight: null })).toBe(false)
    expect(sameReading(SAIN, { ...SAIN, innerWidth: 932 })).toBe(false)
  })
})

describe('isIosStandalone', () => {
  const iphone =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'

  it("iPhone en mode écran d'accueil", () => {
    expect(
      isIosStandalone({ userAgent: iphone, platform: 'iPhone', maxTouchPoints: 5, standalone: true }),
    ).toBe(true)
  })

  it('iPhone dans Safari : la barre d’adresse fait varier la hauteur, on ne surveille pas', () => {
    expect(
      isIosStandalone({ userAgent: iphone, platform: 'iPhone', maxTouchPoints: 5, standalone: false }),
    ).toBe(false)
  })

  it('iPad, qui se présente comme un Mac tactile', () => {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)'
    expect(
      isIosStandalone({ userAgent: ua, platform: 'MacIntel', maxTouchPoints: 5, standalone: true }),
    ).toBe(true)
    expect(
      isIosStandalone({ userAgent: ua, platform: 'MacIntel', maxTouchPoints: 0, standalone: true }),
    ).toBe(false)
  })

  it('Android installé et bureau : jamais', () => {
    const android = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36'
    expect(
      isIosStandalone({ userAgent: android, platform: 'Linux armv81', maxTouchPoints: 5, standalone: true }),
    ).toBe(false)
    const linux = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36'
    expect(
      isIosStandalone({ userAgent: linux, platform: 'Linux x86_64', maxTouchPoints: 0, standalone: true }),
    ).toBe(false)
  })
})

describe('journal des incidents', () => {
  const incident = (n: number): ViewportIncident => ({
    at: `2026-11-23T18:00:${String(n).padStart(2, '0')}.000Z`,
    trigger: 'focusout',
    anomaly: 'retrecie',
    reference: REF,
    before: { ...SAIN, innerHeight: 873, visualHeight: 873 },
    after: SAIN,
    repaired: true,
  })

  it('ne garde que les plus récents', () => {
    let log: ViewportIncident[] = []
    for (let n = 0; n < 5; n += 1) log = appendIncident(log, incident(n), 3)
    expect(log.map((i) => i.at.slice(17, 19))).toEqual(['02', '03', '04'])
  })

  it('relit un journal persisté et écarte ce qui est mal formé', () => {
    const raw = JSON.stringify([incident(1), { at: 3 }, null, 'x'])
    expect(parseIncidentLog(raw)).toEqual([incident(1)])
    expect(parseIncidentLog('{')).toEqual([])
    expect(parseIncidentLog(null)).toEqual([])
    expect(parseIncidentLog('{"at":"x"}')).toEqual([])
  })

  it('décrit un incident en une ligne', () => {
    expect(describeIncident(incident(1))).toBe(
      '2026-11-23T18:00:01.000Z focusout retrecie (réf. 932) : 430x873 vv 873 top 0 x1 -> 430x932 vv 932 top 0 x1, réparé par la remesure',
    )
    expect(describeIncident({ ...incident(1), anomaly: 'zoomee', after: null, repaired: null })).toContain(
      'remesure non tentée',
    )
  })
})
