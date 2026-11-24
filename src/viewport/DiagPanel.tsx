import { useState } from 'react'
import { SecondaryButton, TextLink } from '../ui'
import {
  clearIncidentLog,
  closeDiag,
  refreshDiag,
  repairFromDiag,
  useDiag,
} from './watch'

/**
 * Relevé de diagnostic des barres du bas (registre R4), masqué par défaut. Il
 * s'ouvre par un appui long (1,5 s) sur la ligne de navigation en haut de
 * l'écran (shell/SurfaceNav.tsx), par « Relevé d'affichage » dans Réglages, ou
 * par `?diag=1` dans l'URL.
 *
 * Il sert quand les barres se décrochent sur l'iPhone : les valeurs affichées et
 * le journal des incidents disent laquelle des causes possibles est en jeu, et
 * « Remesurer » essaie le correctif sur place. Ancré en HAUT de l'écran : il
 * doit rester lisible justement quand le bas de la fenêtre est faux.
 */
export function DiagPanel() {
  const { open, text } = useDiag()
  const [copied, setCopied] = useState(false)
  if (!open) return null

  const copy = () => {
    void navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => {})
  }

  return (
    <section
      data-diag-panel
      aria-label="Relevé de diagnostic"
      className="fixed inset-x-2 z-[70] mx-auto flex max-h-[70vh] max-w-md flex-col rounded-sheet border border-line bg-raise"
      style={{ top: 'calc(var(--safe-top) + 0.5rem)' }}
    >
      <div className="flex items-center justify-between gap-2 border-b border-line py-1 pl-4 pr-2">
        <h2 className="text-[15px] font-semibold text-ink">Relevé de diagnostic</h2>
        <TextLink tone="muted" onClick={closeDiag} className="px-2">
          Fermer
        </TextLink>
      </div>
      <pre className="min-h-0 flex-1 select-text overflow-auto whitespace-pre-wrap break-words px-4 py-2 font-sans text-[13px] leading-relaxed text-muted">
        {text}
      </pre>
      <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2">
        <SecondaryButton size="sm" onClick={copy}>
          {copied ? 'Copié' : 'Copier'}
        </SecondaryButton>
        <SecondaryButton size="sm" onClick={refreshDiag}>
          Actualiser
        </SecondaryButton>
        <SecondaryButton size="sm" onClick={repairFromDiag}>
          Remesurer
        </SecondaryButton>
        <TextLink tone="muted" onClick={clearIncidentLog}>
          Vider le journal
        </TextLink>
      </div>
    </section>
  )
}
