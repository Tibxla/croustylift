import { useEffect, useState } from 'react'
import { useAuth } from './auth/useAuth'
import { LoginScreen } from './auth/LoginScreen'
import { ResetPasswordScreen } from './auth/ResetPasswordScreen'
import { CaptureScreen } from './features/capture/CaptureScreen'
import { AnalysisScreen } from './features/analysis/AnalysisScreen'
import { SeancesScreen } from './features/authoring/SeancesScreen'
import { ExercisesScreen } from './features/exercises/ExercisesScreen'
import { FirstLaunchScreen } from './features/onboarding/FirstLaunchScreen'
import { listRoutines } from './features/authoring/data'
import { isFirstLaunch } from './features/onboarding/template'
import { flushOutbox } from './features/capture/sync'

type Surface = 'capture' | 'analysis' | 'seances' | 'exercises'

// La hauteur de la tab bar vit dans une variable CSS partagée `--nav-height`
// (`--nav-offset` = + safe-area iOS), définie une seule fois sur `:root`
// (index.css). La surface réserve l'espace en bas via `var(--nav-offset)` et les
// barres d'action fixes de la capture s'y alignent (`bottom-[var(--nav-offset)]`),
// sans <style> injecté ni couplage cross-feature.

function App() {
  const { session, user, loading, signOut, isPasswordRecovery } = useAuth()

  if (loading) {
    return <FullScreenSpinner label="Chargement" />
  }

  // Le flux recovery est prioritaire sur tout : l'utilisateur arrive via le lien
  // email, une session temporaire est ouverte, on lui demande son nouveau mot de
  // passe avant de le laisser accéder à l'app.
  if (isPasswordRecovery) {
    return <ResetPasswordScreen />
  }

  if (!session) {
    return <LoginScreen />
  }

  return <AuthenticatedApp email={user?.email} onSignOut={signOut} />
}

// --- App authentifiée : aiguillage premier lancement <-> surfaces ------------

/**
 * Après l'auth, on regarde si l'utilisateur a au moins une routine. Aucune ->
 * écran de PREMIER LANCEMENT (il nomme sa 1ʳᵉ routine + séance), pas de routine
 * auto-créée. Sinon -> les surfaces habituelles. Après création, on recharge et
 * on bascule sur la capture.
 */
function AuthenticatedApp({
  email,
  onSignOut,
}: {
  email: string | undefined
  onSignOut: () => Promise<void>
}) {
  type RoutineCheck =
    | { phase: 'checking' }
    | { phase: 'error'; message: string }
    | { phase: 'first-launch' }
    | { phase: 'ready' }

  const [check, setCheck] = useState<RoutineCheck>({ phase: 'checking' })
  const [reloadKey, setReloadKey] = useState(0)
  const [surface, setSurface] = useState<Surface>('capture')

  useEffect(() => {
    let active = true
    setCheck({ phase: 'checking' })

    void (async () => {
      try {
        const routines = await listRoutines()
        if (!active) return
        setCheck({ phase: isFirstLaunch(routines.length) ? 'first-launch' : 'ready' })
      } catch (err) {
        if (!active) return
        setCheck({
          phase: 'error',
          message: err instanceof Error ? err.message : String(err),
        })
      }
    })()

    return () => {
      active = false
    }
  }, [reloadKey])

  // Flush GLOBAL de l'outbox : au montage (reprise après reload, p. ex. en ligne
  // sans repasser par la Capture) et au retour réseau ('online'). Sans ce point,
  // les SEULS déclencheurs de flush vivaient dans CaptureBoard : une suppression
  // (ou correction) faite depuis l'Analyse en offline restait durable mais
  // n'était jamais tentée tant qu'on n'ouvrait pas la Capture → au reload, la
  // séance « supprimée » réapparaissait (« delete zombie »). La file étant
  // globale et idempotente par id (ADR 0003), un flush ici remonte toute op en
  // attente quel que soit l'onglet monté ; le flush est sérialisé (outbox), donc
  // ce déclencheur ne double pas ceux de la Capture.
  useEffect(() => {
    void flushOutbox()
    const onOnline = () => void flushOutbox()
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [])

  if (check.phase === 'checking') {
    return <FullScreenSpinner label="Chargement" />
  }

  if (check.phase === 'error') {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg px-6 text-center text-ink">
        <p className="text-sm text-ink-muted">Impossible de charger ton compte.</p>
        <p className="readout max-w-full break-words text-xs text-warn">{check.message}</p>
        <button
          type="button"
          onClick={() => setReloadKey((k) => k + 1)}
          className="inline-flex h-11 items-center rounded-xl bg-accent-strong px-5 text-sm font-semibold text-on-accent transition active:scale-[0.98] active:bg-accent"
        >
          Réessayer
        </button>
      </main>
    )
  }

  if (check.phase === 'first-launch') {
    return (
      <main className="min-h-screen bg-bg text-ink">
        <FirstLaunchScreen
          onCreated={() => {
            // La routine existe désormais : on recharge l'aiguillage et on ouvre
            // la capture sur la séance fraîchement créée.
            setSurface('capture')
            setReloadKey((k) => k + 1)
          }}
        />
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-bg text-ink">
      <header className="flex h-14 items-center justify-between border-b border-line px-4">
        <h1 className="text-base font-semibold tracking-tight">Croustylift</h1>
        <div className="flex items-center gap-3">
          <span className="hidden max-w-[40vw] truncate text-sm text-ink-muted sm:inline">
            {email}
          </span>
          <button
            type="button"
            onClick={() => {
              void onSignOut()
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
        {surface === 'exercises' && <ExercisesScreen />}
      </div>

      <BottomNav surface={surface} onSelect={setSurface} />
    </main>
  )
}

function FullScreenSpinner({ label }: { label: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg text-ink">
      <div
        className="h-6 w-6 animate-spin rounded-full border-2 border-line border-t-accent"
        role="status"
        aria-label={label}
      />
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
      <div className="mx-auto grid w-full max-w-md grid-cols-4 pb-[env(safe-area-inset-bottom,0)]">
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
        <TabButton
          label="Exercices"
          active={surface === 'exercises'}
          onClick={() => onSelect('exercises')}
          icon={
            <>
              <path d="M6.5 6.5l11 11" />
              <path d="M4 9l-1.5-1.5M2 12l3 3 3-3-3-3zM20 12l-3-3-3 3 3 3zM20 15l1.5 1.5" />
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
