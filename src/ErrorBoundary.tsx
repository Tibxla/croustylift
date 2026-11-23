import { Component, type ErrorInfo, type ReactNode } from 'react'
import { isChunkLoadError } from './pwa/update'

interface Props {
  children: ReactNode
  /** Rendu de secours. Défaut : écran plein « Recharger l'app ». */
  fallback?: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Frontière d'erreur de RENDU — la seule chose qu'un composant React peut
 * intercepter. Sans elle, une exception levée pendant le rendu (payload Supabase
 * malformé, donnée de graphe recharts inattendue, accès à un champ undefined)
 * remonte jusqu'à la racine et démonte TOUT l'arbre : écran blanc, sans message
 * ni récupération — inacceptable pour une PWA censée tenir en pleine salle.
 *
 * Les états `phase: 'error'` des écrans ne couvrent QUE les rejets de promesses
 * async ; ceci couvre les throws SYNCHRONES du rendu, le maillon manquant.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Pas de service de reporting (local-first, 0 €) : on trace en console pour le
    // diagnostic. Les logs navigateur font le reste.
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.error === null) return this.props.children
    if (this.props.fallback !== undefined) return this.props.fallback
    // Un écran chargé à la demande dont le fichier est introuvable : ce n'est pas
    // un plantage de l'app. Le rechargement automatique (App.tsx) n'a pas eu
    // lieu, soit hors ligne, soit pour ne pas interrompre une séance en cours :
    // on le dit, et on rassure sur ce qui est déjà saisi.
    const missingChunk = isChunkLoadError(this.state.error)
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg px-6 text-center text-ink">
        <p className="text-sm text-ink-muted">
          {missingChunk
            ? "Cet écran n'a pas pu se charger : l'app a été mise à jour, ou le réseau manque. Tes saisies restent sur l'appareil, recharger suffit."
            : "Quelque chose a planté à l'affichage."}
        </p>
        <p className="readout max-w-full break-words text-xs text-warn">
          {this.state.error.message}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="btn btn-primary h-11 rounded-xl px-5 text-sm"
        >
          Recharger l'app
        </button>
      </main>
    )
  }
}
