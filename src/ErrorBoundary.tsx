import { Component, type ErrorInfo, type ReactNode } from 'react'
import { isChunkLoadError } from './pwa/update'
import { PrimaryButton } from './ui'

interface Props {
  children: ReactNode
  /** Rendu de secours. Défaut : écran plein « Recharger l'app ». */
  fallback?: ReactNode
  /** Appelé après une erreur interceptée (ex. retirer une feuille qui n'a pas pu se charger). */
  onError?: (error: Error) => void
}

interface State {
  error: Error | null
}

/**
 * Frontière d'erreur de RENDU — la seule chose qu'un composant React peut
 * intercepter. Sans elle, une exception levée pendant le rendu (payload Supabase
 * malformé, donnée de graphe inattendue, accès à un champ undefined)
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
    this.props.onError?.(error)
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
      <main className="min-h-screen bg-bg px-5 pt-6 text-ink">
        <p className="max-w-[40ch] text-[16px] leading-[1.45] text-ink">
          {missingChunk
            ? "Cet écran n'a pas pu se charger : l'app a été mise à jour, ou le réseau manque. Tes saisies restent sur l'appareil, recharger suffit."
            : "Quelque chose a planté à l'affichage."}
        </p>
        <p className="mt-2 max-w-full break-words text-[14px] text-faint">{this.state.error.message}</p>
        <div className="mt-5 flex">
          <PrimaryButton onClick={() => window.location.reload()}>Recharger l'app</PrimaryButton>
        </div>
      </main>
    )
  }
}
