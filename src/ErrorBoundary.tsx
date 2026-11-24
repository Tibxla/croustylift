import { Component, useContext, useState, type ErrorInfo, type ReactNode } from 'react'
import { isChunkLoadError } from './pwa/update'
import { manualReload } from './pwa/register'
import type { ManualReloadVerdict } from './pwa/manual-reload'
import { SurfaceNavigationContext } from './shell/navigation'
import { Alert, PrimaryButton, SecondaryButton } from './ui'

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
    // Pas de service de reporting (local-first, 0 €) : on trace en console pour le
    // diagnostic. Les logs navigateur font le reste.
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.error === null) return this.props.children
    if (this.props.fallback !== undefined) return this.props.fallback
    return <RecoveryScreen error={this.state.error} />
  }
}

/**
 * L'écran d'erreur. Un écran chargé à la demande dont le fichier est
 * introuvable n'est pas un plantage de l'app : le rechargement automatique
 * (App.tsx) n'a pas eu lieu, hors ligne ou pour ne rien faire perdre. Le bouton
 * « Recharger l'app » passe par les mêmes gardes (pwa/manual-reload.ts) : tant
 * que des saisies ne tiennent qu'en mémoire, ou qu'un brouillon ou une écriture
 * est en cours, il ne recharge pas, dit pourquoi et propose de revenir à la
 * Salle (dans le shell authentifié).
 */
function RecoveryScreen({ error }: { error: Error }) {
  const goTo = useContext(SurfaceNavigationContext)
  const [refusal, setRefusal] = useState<Exclude<ManualReloadVerdict, 'reload'> | null>(null)
  const missingChunk = isChunkLoadError(error)
  // Dans le shell, l'écran prend la place d'une surface (le shell porte déjà le
  // <main>) ; hors du shell, il est la page entière.
  const Frame = goTo ? 'div' : 'main'
  return (
    <Frame className={goTo ? 'px-5 pt-6 text-ink' : 'min-h-screen bg-bg px-5 pt-6 text-ink'}>
      <p className="max-w-[40ch] text-[16px] leading-[1.45] text-ink">
        {missingChunk
          ? "Cet écran n'a pas pu se charger : l'app a été mise à jour, ou le réseau manque."
          : "Quelque chose a planté à l'affichage."}
      </p>
      <p className="mt-2 max-w-full break-words text-[14px] text-faint">{error.message}</p>
      {refusal && (
        <Alert label="Pas de rechargement" className="mt-4">
          {refusal === 'unsaved'
            ? 'des saisies ne sont encore qu’en mémoire (le stockage de l’appareil est plein) : recharger les perdrait. Reviens à la Salle et libère de la place, ou attends le réseau pour qu’elles partent.'
            : 'un brouillon ou un enregistrement est en cours : recharger le perdrait. Reviens à la Salle et termine-le d’abord.'}
        </Alert>
      )}
      <div className="mt-5 flex flex-col gap-2">
        <PrimaryButton
          onClick={() => {
            const verdict = manualReload()
            if (verdict !== 'reload') setRefusal(verdict)
          }}
        >
          Recharger l'app
        </PrimaryButton>
        {goTo && (
          <SecondaryButton onClick={() => goTo('capture')}>Retour à la Salle</SecondaryButton>
        )}
      </div>
    </Frame>
  )
}
