import { useState } from 'react'
import { useAuth } from './auth/useAuth'
import { LoginScreen } from './auth/LoginScreen'
import { CaptureScreen } from './features/capture/CaptureScreen'
import { AnalysisScreen } from './features/analysis/AnalysisScreen'
import { SeancesScreen } from './features/authoring/SeancesScreen'

type Surface = 'capture' | 'analysis' | 'seances'

// La hauteur de la tab bar vit dans une variable CSS partagée `--nav-height`
// (`--nav-offset` = + safe-area iOS), définie une seule fois sur `:root`
// (index.css). La surface réserve l'espace en bas via `var(--nav-offset)` et les
// barres d'action fixes de la capture s'y alignent (`bottom-[var(--nav-offset)]`),
// sans <style> injecté ni couplage cross-feature.

function App() {
  const { session, user, loading, signOut } = useAuth()
  const [surface, setSurface] = useState<Surface>('capture')

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg text-ink">
        <div
          className="h-6 w-6 animate-spin rounded-full border-2 border-line border-t-accent"
          role="status"
          aria-label="Chargement"
        />
      </main>
    )
  }

  if (!session) {
    return <LoginScreen />
  }

  return (
    <main className="min-h-screen bg-bg text-ink">
      <header className="flex h-14 items-center justify-between border-b border-line px-4">
        <h1 className="text-base font-semibold tracking-tight">Croustylift</h1>
        <div className="flex items-center gap-3">
          <span className="hidden max-w-[40vw] truncate text-sm text-ink-muted sm:inline">
            {user?.email}
          </span>
          <button
            type="button"
            onClick={() => {
              void signOut()
            }}
            className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-ink-muted transition active:text-ink"
          >
            Se déconnecter
          </button>
        </div>
      </header>

      <div style={{ paddingBottom: 'var(--nav-offset)' }}>
        {surface === 'capture' && <CaptureScreen />}
        {surface === 'analysis' && <AnalysisScreen />}
        {surface === 'seances' && <SeancesScreen />}
      </div>

      <BottomNav surface={surface} onSelect={setSurface} />
    </main>
  )
}

// --- Navigation entre les deux surfaces (zone du pouce, bas d'écran) ---------

function BottomNav({
  surface,
  onSelect,
}: {
  surface: Surface
  onSelect: (s: Surface) => void
}) {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/95 backdrop-blur-sm"
      aria-label="Navigation principale"
    >
      <div className="mx-auto grid w-full max-w-md grid-cols-3 pb-[env(safe-area-inset-bottom,0)]">
        <TabButton
          label="Capture"
          active={surface === 'capture'}
          onClick={() => onSelect('capture')}
          icon={
            <path d="M12 5v14M5 12h14" />
          }
        />
        <TabButton
          label="Analyse"
          active={surface === 'analysis'}
          onClick={() => onSelect('analysis')}
          icon={
            <>
              <path d="M3 3v18h18" />
              <path d="M7 14l4-4 3 3 5-6" />
            </>
          }
        />
        <TabButton
          label="Séances"
          active={surface === 'seances'}
          onClick={() => onSelect('seances')}
          icon={
            <>
              <path d="M8 6h11M8 12h11M8 18h11" />
              <path d="M3 6h.01M3 12h.01M3 18h.01" />
            </>
          }
        />
      </div>
    </nav>
  )
}

function TabButton({
  label,
  active,
  onClick,
  icon,
}: {
  label: string
  active: boolean
  onClick: () => void
  icon: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      // Tap-target ≥ 44px (h-14 = 56px). Onglet actif en accent violet sobre :
      // texte + icône colorés, jamais de fond plein (One Voice Rule).
      className={`flex h-14 flex-col items-center justify-center gap-0.5 text-xs font-medium transition ${
        active ? 'text-accent-ink' : 'text-ink-muted active:text-ink'
      }`}
    >
      <svg
        viewBox="0 0 24 24"
        width="20"
        height="20"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {icon}
      </svg>
      {label}
    </button>
  )
}

export default App
