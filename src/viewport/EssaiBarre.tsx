import { useEffect, useState } from 'react'

/**
 * Relevé de l'ESSAI « ligne de navigation juste sous l'île » (branche
 * feat/barre-ile). Monté seulement dans un build `VITE_ESSAI=1` (main.tsx) :
 * absent du build normal.
 *
 * Il affiche, dans un coin en bas, de quoi lire une capture de l'iPhone : la
 * valeur du meta de barre d'état figée à l'installation, l'encoche, la taille de
 * la fenêtre et la position réelle de la ligne collée. Le SHA et l'heure du build
 * disent si le service worker sert bien ce build-ci.
 *
 * `position: fixed`, par exception à la règle du kit : c'est un calque de
 * diagnostic qui ne reçoit aucun toucher (`pointer-events: none`), n'entre pas
 * dans le flux et n'existe que dans ce build d'essai. Il reste étroit (moins de la
 * moitié de la largeur) et loin du milieu des bords, là où WebKit cherche une
 * boîte pleine largeur pour décider du flou.
 */
export default function EssaiBarre() {
  const [lignes, setLignes] = useState<string[]>(() => mesurer())

  useEffect(() => {
    const maj = () => setLignes(mesurer())
    const timer = window.setInterval(maj, 1000)
    window.addEventListener('resize', maj)
    window.addEventListener('scroll', maj, { passive: true })
    window.visualViewport?.addEventListener('resize', maj)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('resize', maj)
      window.removeEventListener('scroll', maj)
      window.visualViewport?.removeEventListener('resize', maj)
    }
  }, [])

  return (
    <div
      data-essai-barre
      aria-hidden="true"
      className="pointer-events-none fixed left-1 z-[80] max-w-[46vw] rounded-[4px] bg-black/70 px-1.5 py-1 font-sans text-[10px] leading-[1.35] tabular-nums text-ink"
      style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 4px)' }}
    >
      {lignes.map((ligne) => (
        <div key={ligne} className="whitespace-nowrap">
          {ligne}
        </div>
      ))}
    </div>
  )
}

function mesurer(): string[] {
  const sonde = document.createElement('div')
  sonde.style.cssText =
    'position:absolute;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
    'padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)'
  document.body.appendChild(sonde)
  const style = getComputedStyle(sonde)
  const safeHaut = arrondi(parseFloat(style.paddingTop) || 0)
  const safeBas = arrondi(parseFloat(style.paddingBottom) || 0)
  sonde.remove()

  const meta =
    document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-status-bar-style"]')?.content ??
    'absent'
  const piste = meta === 'black-translucent' ? 'translucide (ancienne)' : `opaque ${meta} + ligne collée`

  const installee = window.matchMedia('(display-mode: standalone)').matches
  const navStandalone = (navigator as Navigator & { standalone?: boolean }).standalone

  const barre = document.querySelector('.surface-nav-bar')
  let ligneNav = 'ligne absente (écran sans nav)'
  if (barre) {
    const rect = barre.getBoundingClientRect()
    const cs = getComputedStyle(barre)
    ligneNav = `ligne ${cs.position} · haut ${arrondi(rect.top)} · h ${arrondi(rect.height)} · l ${arrondi(rect.width)}`
  }

  const ua = navigator.userAgent
  const os = /OS (\d+[_\d]*) like Mac/.exec(ua)?.[1] ?? '?'
  const safari = /Version\/([\d.]+)/.exec(ua)?.[1] ?? '?'
  const heureBuild = __APP_BUILT_AT__.slice(11, 16)

  return [
    `essai barre-ile · ${__APP_COMMIT__} · ${heureBuild} UTC`,
    `meta ${meta}`,
    `piste ${piste}`,
    `display-mode ${installee ? 'standalone' : 'navigateur'} · nav.standalone ${String(navStandalone)}`,
    `safe-top ${safeHaut} · safe-bottom ${safeBas}`,
    `fenêtre ${window.innerWidth}×${window.innerHeight} · écran ${window.screen.width}×${window.screen.height}`,
    ligneNav,
    `défilement ${arrondi(window.scrollY)} · OS ${os} · Version ${safari}`,
  ]
}

function arrondi(valeur: number): number {
  return Math.round(valeur * 10) / 10
}
