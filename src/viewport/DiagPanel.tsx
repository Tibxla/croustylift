import { useState } from 'react'
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
      className="surface-raised fixed inset-x-2 z-[70] mx-auto flex max-h-[70vh] max-w-md flex-col rounded-xl"
      style={{ top: 'calc(var(--safe-top) + 0.5rem)' }}
    >
      <div className="flex items-center justify-between gap-2 border-b border-hair px-3 py-2">
        <h2 className="text-sm font-medium text-ink">Relevé de diagnostic</h2>
        <button type="button" onClick={closeDiag} className="btn btn-ghost h-9 rounded-lg px-3 text-sm">
          Fermer
        </button>
      </div>
      <pre className="readout min-h-0 flex-1 select-text overflow-auto whitespace-pre-wrap break-words px-3 py-2 text-xs leading-relaxed text-ink-muted">
        {text}
      </pre>
      <div className="flex flex-wrap gap-2 border-t border-hair px-3 py-2">
        <button type="button" onClick={copy} className="btn btn-primary h-9 rounded-lg px-3 text-sm">
          {copied ? 'Copié' : 'Copier'}
        </button>
        <button type="button" onClick={refreshDiag} className="btn btn-secondary h-9 rounded-lg px-3 text-sm">
          Actualiser
        </button>
        <button type="button" onClick={repairFromDiag} className="btn btn-secondary h-9 rounded-lg px-3 text-sm">
          Remesurer
        </button>
        <button type="button" onClick={clearIncidentLog} className="btn btn-ghost h-9 rounded-lg px-3 text-sm">
          Vider le journal
        </button>
      </div>
    </section>
  )
}
