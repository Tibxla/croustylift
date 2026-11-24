import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useAuth } from './auth/useAuth'
import { PendingWritesError } from './auth/auth-context'
import { LoginScreen } from './auth/LoginScreen'
import { ResetPasswordScreen } from './auth/ResetPasswordScreen'
import { CaptureScreen } from './features/capture/CaptureScreen'
import { SeancesScreen } from './features/authoring/SeancesScreen'
import { ExercisesScreen } from './features/exercises/ExercisesScreen'
import { FirstLaunchScreen } from './features/onboarding/FirstLaunchScreen'
import { listRoutines } from './features/authoring/data'
import { requestLeave } from './features/authoring/seance-dirty'
import { isFirstLaunch } from './features/onboarding/template'
import { flushOutbox } from './features/capture/sync'
import { signOutRefusalLabel } from './features/capture/sync-label'
import { networkFirstRead, revalidateReadCache } from './lib/read-cache'
import { ErrorBoundary } from './ErrorBoundary'
import { blockReloads, unblockReloads } from './pwa/blockers'
import {
  captureInProgress,
  recoverFromChunkFailure,
  requestReload,
  setLazyChunkPreloader,
  takeSurfaceAfterReload,
  useUpdateReady,
} from './pwa/register'
import { RECOVERY_LINK_BLOCK, RECOVERY_SCREEN_BLOCK } from './pwa/recovery'
import { ImportRequests, type SurfaceName } from './pwa/update'
import { switchSurface } from './surface-switch'
import { openDiag } from './viewport/watch'
import { APP_VERSION_LABEL } from './version'
import { errorMessage } from './lib/error-message'

// L'Analyse est la seule surface qui tire recharts (lib lourde). On la charge en
// PARESSEUX pour la sortir du chunk critique de la Capture (surface par défaut,
// « zéro-friction ») : recharts n'est téléchargé qu'à l'ouverture de l'onglet.
//
// Si le fichier du chunk est introuvable (build remplacé sous la page, cache vidé
// par le système), la suite dépend de ce que fait l'utilisateur À CE MOMENT :
// - il est encore sur l'Analyse et un rechargement est permis : on recharge une
//   fois pour retrouver un shell et des chunks cohérents, et on rouvre l'Analyse
//   (la promesse reste en suspens, le Suspense tient jusqu'au rechargement) ;
// - sa demande est périmée (il a quitté l'onglet, ou s'est déconnecté) : on ne
//   recharge pas sous ses pieds, et on oublie l'échec (`React.lazy` le
//   garderait) pour retenter s'il y revient ;
// - sinon (hors ligne, séance en cours, déjà tenté) : l'erreur remonte à la
//   frontière d'erreur, qui l'explique.
const importAnalysis = () => import('./features/analysis/AnalysisScreen')

/**
 * La demande d'import de l'Analyse en cours : ouverte quand l'import démarre,
 * périmée par AuthenticatedApp dès que l'utilisateur quitte l'onglet ou que
 * l'app authentifiée est démontée.
 */
const analysisRequests = new ImportRequests()

function createAnalysisScreen() {
  return lazy(() => {
    const request = analysisRequests.begin()
    return importAnalysis()
      .then((m) => ({ default: m.AnalysisScreen }))
      .catch((err: unknown) => {
        const action = recoverFromChunkFailure('analysis', analysisRequests.isActive(request))
        if (action === 'reload') return new Promise<never>(() => {})
        if (action === 'ignore') AnalysisScreen = createAnalysisScreen()
        throw err
      })
  })
}
let AnalysisScreen = createAnalysisScreen()

// Une mise à jour s'annonce : le chunk de l'Analyse est chargé en mémoire tant
// que l'ancien précache existe encore (voir `setLazyChunkPreloader`).
setLazyChunkPreloader(() => {
  void importAnalysis().catch(() => {})
})

type Surface = SurfaceName

/**
 * Joue une mise à jour d'état derrière l'API native View Transitions : le passage
 * d'un onglet à l'autre se fait en crossfade court (0 ko, natif). `flushSync`
 * force React à appliquer le changement DANS la transition pour que l'ancien et
 * le nouvel écran soient capturés. Désactivé sous `prefers-reduced-motion` et là
 * où l'API n'existe pas (fallback : mise à jour directe, instantanée).
 *
 * Champ en cours de saisie : on lui retire le focus et on se passe de transition.
 * Sinon le champ est démonté pendant que le clavier descend et que le navigateur
 * photographie la page, ce qui sur iPhone peut laisser la fenêtre d'affichage
 * faussée et les barres du bas décrochées (registre R4).
 */
function withViewTransition(update: () => void): void {
  const focused = typeof document === 'undefined' ? null : document.activeElement
  if (
    focused instanceof HTMLInputElement ||
    focused instanceof HTMLTextAreaElement ||
    focused instanceof HTMLSelectElement
  ) {
    focused.blur()
    update()
    return
  }
  const reduce =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  // Accès défensif : l'API n'est pas typée dans toutes les versions de lib.dom.
  const doc =
    typeof document === 'undefined'
      ? undefined
      : (document as Document & { startViewTransition?: (cb: () => void) => unknown })
  if (!reduce && typeof doc?.startViewTransition === 'function') {
    doc.startViewTransition(() => flushSync(update))
  } else {
    update()
  }
}

// La hauteur de la tab bar vit dans une variable CSS partagée `--nav-height`
// (`--nav-offset` = + safe-area iOS), définie une seule fois sur `:root`
// (index.css). La surface réserve l'espace en bas via `var(--nav-offset)` et les
// barres d'action fixes de la capture s'y alignent (`bottom-[var(--nav-offset)]`),
// sans <style> injecté ni couplage cross-feature.

function App() {
  const { session, user, loading, signOut, isPasswordRecovery, localAccount, offlineRecognized } =
    useAuth()

  // Récupération de mot de passe : aucun rechargement automatique tant que le
  // flux n'est pas terminé (le lien ne sert qu'une fois). Un premier blocage est
  // posé dès l'arrivée par le lien (pwa/blockers.ts, avant que Supabase ne
  // nettoie l'URL) et levé si le lien n'aboutit pas (pwa/recovery-watch.ts).
  // S'il aboutit, l'écran de nouveau mot de passe tient ici le sien, et les deux
  // sont levés quand il se referme.
  useEffect(() => {
    if (!isPasswordRecovery) return
    blockReloads(RECOVERY_SCREEN_BLOCK)
    return () => {
      unblockReloads(RECOVERY_SCREEN_BLOCK)
      unblockReloads(RECOVERY_LINK_BLOCK)
    }
  }, [isPasswordRecovery])

  if (loading) {
    return <FullScreenSpinner label="Chargement" />
  }

  // Le flux recovery est prioritaire sur tout : l'utilisateur arrive via le lien
  // email, une session temporaire est ouverte, on lui demande son nouveau mot de
  // passe avant de le laisser accéder à l'app.
  if (isPasswordRecovery) {
    return <ResetPasswordScreen />
  }

  // Garde de route (ADR 0012) : session validée serveur, OU Session locale qui
  // fait foi hors-ligne (marqueur + session invérifiable faute de réseau). Le
  // login ne s'affiche que quand PERSONNE n'est reconnu sur l'appareil.
  if (!session && !offlineRecognized) {
    return <LoginScreen />
  }

  return (
    <AuthenticatedApp
      email={user?.email ?? localAccount?.email ?? undefined}
      onSignOut={signOut}
    />
  )
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
  onSignOut: (options?: { force?: boolean }) => Promise<void>
}) {
  type RoutineCheck =
    | { phase: 'checking' }
    | { phase: 'error'; message: string }
    | { phase: 'first-launch' }
    | { phase: 'ready' }

  const [check, setCheck] = useState<RoutineCheck>({ phase: 'checking' })
  const [reloadKey, setReloadKey] = useState(0)
  // Après un rechargement décidé par l'app (mise à jour, chunk introuvable), on
  // rouvre l'onglet que l'utilisateur visait ; sinon la Capture.
  const [surface, setSurface] = useState<Surface>(() => takeSurfaceAfterReload() ?? 'capture')
  const updateReady = useUpdateReady()
  // La demande d'import de l'Analyse ne vaut que tant que cet écran la porte :
  // elle est périmée au départ de l'onglet et au démontage (déconnexion).
  useEffect(() => {
    if (surface !== 'analysis') return
    return () => analysisRequests.invalidate()
  }, [surface])
  // Déconnexion refusée (ADR 0012) : le bandeau sous le header porte le choix
  // explicite — revenir en ligne pour ne rien perdre, ou forcer en connaissance.
  const [signOutIssue, setSignOutIssue] = useState<
    | { kind: 'pending'; pending: number; refused: number }
    | { kind: 'error'; message: string }
    | null
  >(null)

  useEffect(() => {
    let active = true
    setCheck({ phase: 'checking' })

    void (async () => {
      try {
        // Réseau d'abord BORNÉ (3 s), copie locale en secours (ADR 0012) : le
        // check doit voir une routine créée à l'instant (premier lancement),
        // mais hors-ligne ou sur wifi zombie il retombe sur la copie au lieu de
        // bloquer l'app entière sur « Impossible de charger ton compte ».
        const routines = await networkFirstRead('routines-check', listRoutines)
        if (!active) return
        setCheck({ phase: isFirstLaunch(routines.length) ? 'first-launch' : 'ready' })
      } catch (err) {
        if (!active) return
        // Sans copie locale ET sans réseau, il n'y a rien à afficher : cet état
        // n'existe qu'avant la première synchro réussie (ou après une purge du
        // navigateur) — on invite à repasser en ligne plutôt qu'un message brut.
        const offline = typeof navigator !== 'undefined' && navigator.onLine === false
        setCheck({
          phase: 'error',
          message: offline
            ? "Hors connexion, et aucune copie locale de ton compte sur cet appareil. Repasse en ligne une fois pour l'amorcer."
            : errorMessage(err),
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
    const flushAndRevalidate = () => {
      void flushOutbox()
        .then((result) => {
          // Après une remontée réussie, on RAFRAÎCHIT les copies locales de
          // lecture (ADR 0012) : la Référence hors-ligne de la prochaine séance
          // intègre celle qui vient d'être synchronisée.
          if (result.flushed > 0) revalidateReadCache()
        })
        .catch(() => {})
    }
    flushAndRevalidate()
    window.addEventListener('online', flushAndRevalidate)
    return () => window.removeEventListener('online', flushAndRevalidate)
  }, [])

  if (check.phase === 'checking') {
    return <FullScreenSpinner label="Chargement" />
  }

  if (check.phase === 'error') {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg px-6 text-center text-ink">
        <p className="text-base font-medium text-ink">Impossible de charger ton compte.</p>
        <p className="readout max-w-full break-words text-xs text-ink-faint">{check.message}</p>
        <button
          type="button"
          onClick={() => setReloadKey((k) => k + 1)}
          className="btn btn-primary h-11 rounded-xl px-5 text-sm"
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
      {/* Scrim de status bar : en standalone iOS la webview passe SOUS l'heure
          (viewport-fit=cover + status bar translucide, index.html). Sans cette
          bande opaque, le contenu défilerait derrière l'heure et la batterie.
          Elle ne coûte aucun pixel utile — la zone appartient déjà au système —
          et garde la teinte de l'app plutôt que le noir pur d'iOS. */}
      <div className="safe-top-scrim" aria-hidden="true" />

      <div style={{ paddingBottom: 'var(--nav-offset)' }}>
        {/* Frontière par surface (`key={surface}` la réarme au changement
            d'onglet) : un crash de rendu d'un onglet n'efface pas la nav ni les
            autres surfaces — l'utilisateur peut basculer pour s'en sortir. Le
            Suspense couvre le chargement paresseux de l'Analyse. */}
        <ErrorBoundary key={surface}>
          <Suspense fallback={<FullScreenSpinner label="Chargement" />}>
            {surface === 'capture' && <CaptureScreen />}
            {surface === 'analysis' && <AnalysisScreen />}
            {surface === 'seances' && <SeancesScreen />}
            {surface === 'exercises' && <ExercisesScreen />}
          </Suspense>
        </ErrorBoundary>

        {/* Compte : email + Déconnexion, en pied de l'Analyse — l'écran « au
            calme », consulté assis, hors salle. La Connexion arrive une fois par
            appareil (cf. GLOSSARY.md) : cette action n'a rien à faire dans le
            chrome permanent de l'app, où elle volait 56 px à tous les écrans, la
            Capture comprise. App reste propriétaire de l'auth — l'Analyse n'en
            reçoit aucune prop. */}
        {surface === 'analysis' && (
          <section className="mx-auto w-full max-w-md px-4 pb-8">
            <div className="panel rounded-xl p-4">
              <h2 className="text-sm font-medium text-ink">Compte</h2>
              <p className="mt-1 truncate text-sm text-ink-muted">{email}</p>
              {signOutIssue ? (
                <div className="mt-3 flex flex-col gap-2.5">
                  {signOutIssue.kind === 'pending' ? (
                    <>
                      <p className="text-sm text-ink">
                        {signOutRefusalLabel({
                          held: signOutIssue.pending,
                          refused: signOutIssue.refused,
                        })}
                      </p>
                      <div className="flex items-center gap-2.5">
                        <button
                          type="button"
                          onClick={() => setSignOutIssue(null)}
                          className="btn btn-secondary h-9 rounded-lg px-3 text-sm"
                        >
                          Rester connecté
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            // Forçage explicite (ADR 0012) : la seule porte de purge —
                            // la perte est nommée sur le bouton, pas dans un OK réflexe.
                            setSignOutIssue(null)
                            void onSignOut({ force: true }).catch(() => {})
                          }}
                          className="btn btn-ghost h-9 rounded-lg px-3 text-sm font-medium text-warn"
                        >
                          Déconnecter et perdre ces saisies
                        </button>
                      </div>
                    </>
                  ) : (
                    <p className="flex items-start justify-between gap-3 text-sm text-warn">
                      <span className="min-w-0 break-words">
                        Déconnexion impossible&#8239;: {signOutIssue.message}
                      </span>
                      <button
                        type="button"
                        onClick={() => setSignOutIssue(null)}
                        className="btn btn-ghost h-8 shrink-0 rounded-lg px-2.5 text-sm"
                      >
                        OK
                      </button>
                    </p>
                  )}
                </div>
              ) : null}
              {/* Version du build : le déploiement est manuel, c'est ici qu'on
                  vérifie depuis le téléphone quel commit tourne. Si une version
                  plus récente attend, elle s'installe au prochain changement
                  d'onglet ; le bouton évite d'avoir à le deviner. */}
              <p className="readout mt-1 text-xs text-ink-faint">Version {APP_VERSION_LABEL}</p>
              {updateReady && (
                <div className="mt-2 flex items-center justify-between gap-3">
                  <p className="text-sm text-ink-muted">
                    {captureInProgress()
                      ? 'Mise à jour prête, installée après ta séance.'
                      : 'Mise à jour prête.'}
                  </p>
                  {!captureInProgress() && (
                    <button
                      type="button"
                      onClick={() => requestReload('manual', 'analysis')}
                      className="btn btn-secondary h-9 shrink-0 rounded-lg px-3 text-sm"
                    >
                      Mettre à jour
                    </button>
                  )}
                </div>
              )}
              <button
                type="button"
                onClick={() => {
                  void (async () => {
                    try {
                      await onSignOut()
                    } catch (err) {
                      if (err instanceof PendingWritesError) {
                        setSignOutIssue({
                          kind: 'pending',
                          pending: err.pending,
                          refused: err.refused,
                        })
                        return
                      }
                      setSignOutIssue({
                        kind: 'error',
                        message: errorMessage(err),
                      })
                    }
                  })()
                }}
                className="btn btn-secondary mt-3 h-9 rounded-lg px-3 text-sm font-medium"
              >
                Se déconnecter
              </button>
            </div>
          </section>
        )}
      </div>

      <BottomNav
        surface={surface}
        onSelect={(s) => {
          // Garde de sortie d'abord (modifications non enregistrées), puis
          // rechargement sur une nouvelle version si une attend, puis l'onglet :
          // l'ordre et ses raisons sont dans surface-switch.ts.
          switchSurface(s, surface, {
            requestLeave,
            requestReload,
            show: (next) => withViewTransition(() => setSurface(next)),
          })
        }}
      />
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

// --- Navigation entre les surfaces (zone du pouce, bas d'écran) ---------------

/** Durée de l'appui long sur la barre d'onglets qui ouvre le relevé de diagnostic. */
const DIAG_LONG_PRESS_MS = 1500

function BottomNav({
  surface,
  onSelect,
}: {
  surface: Surface
  onSelect: (s: Surface) => void
}) {
  // Appui long sur la barre d'onglets : ouvre le relevé de diagnostic (registre
  // R4). C'est le seul geste disponible sur tous les écrans de l'app installée,
  // qui n'a pas de barre d'adresse pour `?diag=1`. Le clic qui suit le relâcher
  // est avalé, pour ne pas changer d'onglet en ouvrant le relevé.
  const pressTimer = useRef<number | undefined>(undefined)
  const longPressed = useRef(false)
  const cancelPress = () => window.clearTimeout(pressTimer.current)

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 select-none border-t border-hair bg-bg/80 backdrop-blur-md"
      style={{ WebkitTouchCallout: 'none' }}
      aria-label="Navigation principale"
      onPointerDown={() => {
        longPressed.current = false
        cancelPress()
        pressTimer.current = window.setTimeout(() => {
          longPressed.current = true
          openDiag()
        }, DIAG_LONG_PRESS_MS)
      }}
      onPointerUp={cancelPress}
      onPointerCancel={cancelPress}
      onPointerLeave={cancelPress}
      onContextMenu={(event) => event.preventDefault()}
      onClickCapture={(event) => {
        if (!longPressed.current) return
        longPressed.current = false
        event.preventDefault()
        event.stopPropagation()
      }}
    >
      <div className="mx-auto grid w-full max-w-md grid-cols-4 pb-[var(--safe-bottom)]">
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
      // texte + icône colorés, jamais de fond plein (One Voice Rule). Un fin
      // indicateur en haut porte un `view-transition-name` : au changement
      // d'onglet (derrière l'API View Transitions), il GLISSE de l'ancien vers le
      // nouvel onglet (morph natif) au lieu d'apparaître/disparaître.
      className={`relative flex h-14 flex-col items-center justify-center gap-0.5 text-xs font-medium transition-colors duration-200 ${
        active ? 'text-accent-ink' : 'text-ink-faint active:text-ink'
      }`}
    >
      {active && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 mx-auto h-[2.5px] w-7 rounded-full bg-accent shadow-[0_0_10px_0_var(--accent-glow)]"
          style={{ viewTransitionName: 'nav-indicator' }}
        />
      )}
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
        className={`transition-transform duration-200 ${active ? 'scale-105' : ''}`}
      >
        {icon}
      </svg>
      {label}
    </button>
  )
}

export default App
