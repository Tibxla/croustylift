// PREMIER import, avant tout ce qui charge le client Supabase : lit l'adresse
// d'arrivée tant qu'elle porte encore les jetons d'un lien de récupération.
import './pwa/recovery'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './auth/AuthProvider'
import { ErrorBoundary } from './ErrorBoundary'
import { initServiceWorker } from './pwa/register'
import { DiagPanel } from './viewport/DiagPanel'
import { startViewportWatch } from './viewport/watch'

// Hors de l'arbre React : ces deux services vivent autant que la page et ne
// doivent pas dépendre d'un écran monté (login, premier lancement, erreur).
initServiceWorker()
startViewportWatch()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ErrorBoundary>
    {/* Hors de la frontière d'erreur : le relevé reste ouvrable sur un écran planté. */}
    <DiagPanel />
  </StrictMode>,
)
