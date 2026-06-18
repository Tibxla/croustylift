import { useAuth } from './auth/useAuth'
import { LoginScreen } from './auth/LoginScreen'
import { CaptureScreen } from './features/capture/CaptureScreen'

function App() {
  const { session, user, loading, signOut } = useAuth()

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

      <CaptureScreen />
    </main>
  )
}

export default App
