import { useAuth } from './auth/useAuth'
import { LoginScreen } from './auth/LoginScreen'

function App() {
  const { session, user, loading, signOut } = useAuth()

  if (loading) {
    return (
      <main className="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center">
        <div
          className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-700 border-t-violet-500"
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
    <main className="min-h-screen bg-neutral-950 text-neutral-100">
      <header className="flex items-center justify-between border-b border-neutral-900 px-6 py-4">
        <h1 className="text-lg font-semibold tracking-tight">Croustylift</h1>
        <div className="flex items-center gap-4">
          <span className="text-sm text-neutral-400">{user?.email}</span>
          <button
            type="button"
            onClick={() => {
              void signOut()
            }}
            className="rounded-lg border border-neutral-800 px-3 py-1.5 text-sm font-medium text-neutral-200 transition hover:border-neutral-700 hover:text-white"
          >
            Se déconnecter
          </button>
        </div>
      </header>

      <section className="flex min-h-[60vh] items-center justify-center px-6 text-center">
        <p className="text-sm text-neutral-500">
          L’écran de capture arrive bientôt.
        </p>
      </section>
    </main>
  )
}

export default App
