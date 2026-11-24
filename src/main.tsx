// PREMIER import, avant tout ce qui charge le client Supabase : lit l'adresse
// d'arrivée tant qu'elle porte encore les jetons d'un lien de récupération.
import './pwa/recovery'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './auth/AuthProvider'
import { ErrorBoundary } from './ErrorBoundary'
import { initServiceWorker, requestReload } from './pwa/register'
import { watchRecoveryLink } from './pwa/recovery-watch'
import { applyStoredSignal } from './settings/reglages'
import { DiagPanel } from './viewport/DiagPanel'
import { startViewportWatch } from './viewport/watch'

// Couleur de signal choisie (Réglages), posée sur :root avant le premier rendu :
// aucun écran ne s'affiche d'abord dans la couleur par défaut.
applyStoredSignal()

// Hors de l'arbre React : ces deux services vivent autant que la page et ne
// doivent pas dépendre d'un écran monté (login, premier lancement, erreur).
initServiceWorker()
watchRecoveryLink(() => requestReload('activated'))
startViewportWatch()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Bande opaque sous la barre d'état iOS (heure, batterie, encoche), posée une
        fois pour TOUS les écrans (connexion, premier lancement, surfaces) : elle
        réserve l'encoche dans le flux et, collée en haut, couvre ce qui défile
        dessous. Premier enfant de #root, sinon `sticky` ne tient pas. Hauteur
        nulle hors encoche (index.css, .safe-top-scrim). */}
    <div className="safe-top-scrim" aria-hidden="true" />
    <ErrorBoundary>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ErrorBoundary>
    {/* Hors de la frontière d'erreur : le relevé reste ouvrable sur un écran planté. */}
    <DiagPanel />
  </StrictMode>,
)
