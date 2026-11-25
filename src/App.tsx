import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
  type LazyExoticComponent,
} from 'react'
import { useAuth } from './auth/useAuth'
import { LoginScreen } from './auth/LoginScreen'
import { ResetPasswordScreen } from './auth/ResetPasswordScreen'
import { CaptureScreen } from './features/capture/CaptureScreen'
import { FirstLaunchScreen } from './features/onboarding/FirstLaunchScreen'
import { listRoutines } from './features/authoring/data'
import { isFirstLaunch } from './features/onboarding/template'
import { flushOutbox } from './features/capture/sync'
import { networkFirstRead, revalidateReadCache } from './lib/read-cache'
import { ErrorBoundary } from './ErrorBoundary'
import { activeBlockers, blockReloads, unblockReloads } from './pwa/blockers'
import {
  recoverFromChunkFailure,
  requestReload,
  setLazyChunkPreloader,
  takeSurfaceAfterReload,
} from './pwa/register'
import { RECOVERY_LINK_BLOCK, RECOVERY_SCREEN_BLOCK } from './pwa/recovery'
import { ImportRequests, type SurfaceName } from './pwa/update'
import { switchSurface } from './surface-switch'
import { SurfaceNav } from './shell/SurfaceNav'
import { blurFocusedField } from './shell/blur-focused-field'
import { hasSurfaceIntent, SurfaceActiveContext, SurfaceNavigationContext } from './shell/navigation'
import { guardSignOut, openMemory, surfaceKey, switchMemory, type SurfaceMemory } from './shell/surface-memory'
import { syncLine } from './shell/sync-line'
import { useSyncState } from './shell/useSyncState'
import { LoadError, Loading, SheetSlotContext, SyncBanner } from './ui'
import { RefusedWritesContext, refusedAction } from './shell/refused-context'
import { RefusedLoadFailed } from './shell/RefusedLoadFailed'
import { errorMessage } from './lib/error-message'

// Seule la Salle (surface par défaut, « zéro-friction ») est dans le chunk
// critique. L'Analyse, Séances (éditeur compris), Exos, Réglages et l'écran des
// saisies refusées se chargent en PARESSEUX : leur code n'est téléchargé qu'à
// l'ouverture (et préchargé quand une mise à jour s'annonce, voir plus bas).
//
// Si le fichier d'un chunk de surface est introuvable (build remplacé sous la
// page, cache vidé par le système), la suite dépend de ce que fait
// l'utilisateur À CE MOMENT :
// - il est encore sur la surface et un rechargement est permis : on recharge une
//   fois pour retrouver un shell et des chunks cohérents, et on rouvre la même
//   surface (la promesse reste en suspens, le Suspense tient jusqu'au
//   rechargement) ;
// - sa demande est périmée (il a quitté l'onglet, ou s'est déconnecté) : on ne
//   recharge pas sous ses pieds, et on oublie l'échec (`React.lazy` le
//   garderait) pour retenter s'il y revient ;
// - sinon (hors ligne, séance en cours, déjà tenté) : l'erreur remonte à la
//   frontière d'erreur, qui l'explique.

/** Un écran chargé à la demande, et la demande d'import en cours (ouverte quand
 *  l'import démarre, périmée dès que l'utilisateur quitte l'onglet ou que l'app
 *  authentifiée est démontée). */
interface LazyScreen<P> {
  Component: LazyExoticComponent<ComponentType<P>>
  requests: ImportRequests
  preload: () => void
}

function lazySurface<P extends object>(
  surface: SurfaceName,
  load: () => Promise<ComponentType<P>>,
): LazyScreen<P> {
  const requests = new ImportRequests()
  const create = (): LazyExoticComponent<ComponentType<P>> =>
    lazy(() => {
      const request = requests.begin()
      return load()
        .then((Component) => ({ default: Component }))
        .catch((err: unknown) => {
          const action = recoverFromChunkFailure(surface, requests.isActive(request))
          if (action === 'reload') return new Promise<never>(() => {})
          if (action === 'ignore') screen.Component = create()
          throw err
        })
    })
  const screen: LazyScreen<P> = {
    Component: create(),
    requests,
    preload: () => void load().catch(() => {}),
  }
  return screen
}

const lazyScreens = {
  analysis: lazySurface('analysis', () => import('./features/analysis/AnalysisScreen').then((m) => m.AnalysisScreen)),
  seances: lazySurface('seances', () => import('./features/authoring/SeancesScreen').then((m) => m.SeancesScreen)),
  exercises: lazySurface('exercises', () => import('./features/exercises/ExercisesScreen').then((m) => m.ExercisesScreen)),
  reglages: lazySurface('reglages', () => import('./features/settings/ReglagesScreen').then((m) => m.ReglagesScreen)),
} as const

// L'écran des saisies refusées est une feuille, pas une surface, mais son
// chunk suit la même reprise protégée : introuvable pendant qu'elle est ouverte
// et rechargement permis, la page recharge une fois et rouvre l'onglet en cours ;
// sinon l'échec s'affiche dans la feuille (RefusedLoadFailed), avec une reprise.
// L'import échoué est toujours oublié (`React.lazy` le garderait) : réessayer
// redemande vraiment le fichier.
const importRefused = () => import('./shell/RefusedWritesSheet')
const refusedRequests = new ImportRequests()
/** L'onglet affiché, rouvert si un rechargement de reprise a lieu (tenu par AuthenticatedApp). */
let recoverySurface: SurfaceName = 'capture'
const createRefusedSheet = (): LazyExoticComponent<ComponentType<{ open: boolean; onClose: () => void }>> =>
  lazy(() => {
    const request = refusedRequests.begin()
    return importRefused()
      .then((m) => ({ default: m.RefusedWritesSheet }))
      .catch((err: unknown) => {
        const action = recoverFromChunkFailure(recoverySurface, refusedRequests.isActive(request))
        if (action === 'reload') return new Promise<never>(() => {})
        RefusedWritesSheet = createRefusedSheet()
        throw err
      })
  })
let RefusedWritesSheet = createRefusedSheet()

// Une mise à jour s'annonce : les chunks paresseux sont chargés en mémoire tant
// que l'ancien précache existe encore (voir `setLazyChunkPreloader`).
setLazyChunkPreloader(() => {
  for (const screen of Object.values(lazyScreens)) screen.preload()
  void importRefused().catch(() => {})
})

type Surface = SurfaceName

// Avant d'afficher une autre surface, instantanément (le geste revient des
// dizaines de fois par jour, aucune animation ne s'y justifie, DESIGN.md,
// Mouvement), un champ en cours de saisie perd d'abord le focus
// (shell/blur-focused-field.ts).

// Une surface visitée reste montée (shell/surface-memory.ts). Affichée, son
// enveloppe ne fait pas de boîte : ses enfants sont ceux de la colonne, comme
// avant. Cachée, elle sort de la mise en page sans changer de largeur : hors du
// flux, de hauteur nulle, invisible et `inert` (ni focus, ni toucher, ni
// lecteur d'écran). Pas de `display: none` : les écrans qui se mesurent
// (courbes, poids de la Salle) liraient une largeur nulle et se redessineraient
// au retour. Rien n'y est `fixed` : tout s'y découpe.
const SHOWN: CSSProperties = { display: 'contents' }
const PARKED: CSSProperties = {
  position: 'absolute',
  insetInline: 0,
  top: 0,
  height: 0,
  overflow: 'hidden',
  visibility: 'hidden',
  display: 'flex',
  flexDirection: 'column',
}

// La navigation est une ligne de cinq mots en HAUT de l'écran (shell/SurfaceNav),
// dans le flux : collée en haut dans l'app installée (elle coupe le flou d'iOS
// 26), elle défile avec la page dans un onglet. Le bas appartient à l'action du
// moment, dans des barres collées en `sticky` qui portent elles-mêmes l'encoche
// basse (DESIGN.md, Layout). La surface occupe `min-h-surface` (index.css) : la
// fenêtre moins l'encoche haute et la ligne de navigation, pour que le document
// ne défile pas quand le contenu tient (registre R4).

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

  // Une clé par compte : si le compte change sans repasser par l'écran de
  // connexion (session arrivée par un lien), toutes les vues mémorisées des
  // onglets partent avec l'ancien (shell/surface-memory.ts).
  return (
    <AuthenticatedApp
      key={user?.id ?? localAccount?.userId ?? 'local'}
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
  // rouvre l'onglet que l'utilisateur visait ; sinon la Capture. Les onglets
  // visités restent montés, chacun avec son défilement (shell/surface-memory.ts).
  const [memory, setMemory] = useState<SurfaceMemory>(() => openMemory(takeSurfaceAfterReload() ?? 'capture'))
  const surface = memory.current
  // La frontière d'erreur de chaque surface montée, interrogée au départ.
  const boundaries = useRef(new Map<Surface, ErrorBoundary>())
  // Le défilement à rendre une fois la surface affichée (avant la peinture).
  const restoreScroll = useRef<number | null>(null)
  useLayoutEffect(() => {
    if (restoreScroll.current === null) return
    window.scrollTo(0, restoreScroll.current)
    restoreScroll.current = null
  }, [memory])
  // La demande d'import d'un écran paresseux ne vaut que tant que l'onglet le
  // porte : elle est périmée au départ de l'onglet et au démontage (déconnexion).
  useEffect(() => {
    recoverySurface = surface
  }, [surface])
  useEffect(() => {
    if (surface === 'capture') return
    const screen = lazyScreens[surface]
    return () => screen.requests.invalidate()
  }, [surface])
  // Le seul chemin d'une surface à l'autre, pour la navigation comme pour tout
  // écran (shell/navigation.ts) : rechargement sur une nouvelle version si une
  // attend, puis la surface (surface-switch.ts). La surface quittée reste montée,
  // son défilement noté ; la surface visée retrouve le sien, sauf intention en
  // attente (« Voir au Journal ») ou plantage (shell/surface-memory.ts).
  const goTo = useCallback(
    (next: Surface) => {
      switchSurface(next, memory.current, {
        requestReload,
        show: (target) => {
          blurFocusedField()
          const failed = memory.mounted.filter((s) => boundaries.current.get(s)?.failed() ?? false)
          const result = switchMemory(memory, {
            to: target,
            scrollY: window.scrollY,
            failed,
            intent: hasSurfaceIntent(target),
          })
          if (result.memory === memory) {
            // Tap sur l'onglet affiché : retour en haut, comme avant.
            window.scrollTo(0, result.scrollTo)
            return
          }
          restoreScroll.current = result.scrollTo
          setMemory(result.memory)
        },
      })
    },
    [memory],
  )
  const registerBoundary = useCallback((s: Surface, boundary: ErrorBoundary | null) => {
    if (boundary) boundaries.current.set(s, boundary)
    else boundaries.current.delete(s)
  }, [])
  // Se déconnecter démonte tous les onglets : refusé tant qu'un écran, même
  // caché, tient un brouillon (la raison s'affiche sous le bouton des Réglages).
  // Forcé compris : le forçage ne vise que les écritures retenues de la file.
  const guardedSignOut = useCallback(
    (options?: { force?: boolean }) => guardSignOut(onSignOut, activeBlockers(), options),
    [onSignOut],
  )
  // Emplacement des feuilles basses du kit (src/ui/sheet.tsx), dernier enfant
  // de la racine, collé au bas de la fenêtre.
  const [sheetSlot, setSheetSlot] = useState<HTMLElement | null>(null)
  // État réel de la file d'écritures, pour la ligne de synchro sous la navigation.
  const sync = useSyncState()
  // Écran des saisies refusées (feuille), ouvert depuis la ligne de synchro de
  // toute surface ou depuis Réglages.
  const [refusedOpen, setRefusedOpen] = useState(false)
  // Chaque « Réessayer » remonte la frontière d'erreur de la feuille.
  const [refusedAttempt, setRefusedAttempt] = useState(0)
  // La demande d'import de la feuille ne vaut que tant qu'elle est ouverte.
  useEffect(() => {
    if (!refusedOpen) return
    return () => refusedRequests.invalidate()
  }, [refusedOpen])
  const openRefused = useCallback(() => setRefusedOpen(true), [])

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
      <main className="min-h-screen bg-bg text-ink">
        <LoadError
          intro="Impossible de charger ton compte."
          message={check.message}
          onRetry={() => setReloadKey((k) => k + 1)}
        />
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
            setMemory(openMemory('capture'))
            setReloadKey((k) => k + 1)
          }}
        />
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-bg text-ink">
      <SurfaceNav current={surface} onSelect={goTo} />

      <SurfaceNavigationContext.Provider value={goTo}>
        <RefusedWritesContext.Provider value={openRefused}>
        <SheetSlotContext.Provider value={sheetSlot}>
          {/* Colonne flexible de la hauteur de la fenêtre (sous la navigation) :
              une barre collée en bas d'écran y reste même quand le contenu est
              court. Une frontière par surface : un crash de rendu d'une surface
              n'efface pas la navigation, l'utilisateur peut basculer pour s'en
              sortir, et la surface plantée est remontée à neuf quand il y
              revient (shell/surface-memory.ts). Le Suspense couvre le
              chargement paresseux des surfaces hors Salle. */}
          <div className="flex min-h-surface flex-col">
            {/* Ligne de synchro sous la navigation, sur toutes les surfaces sauf
                la Salle, qui garde la sienne tant que l'écran de capture n'est
                pas refait. Dans la colonne : sa hauteur compte dans celle de
                l'écran, le document ne défile pas pour elle. */}
            {surface !== 'capture' && (
              <SyncBanner line={syncLine(sync)} action={refusedAction(sync.refused, openRefused)} />
            )}
            {memory.mounted.map((s) => (
              <SurfaceSlot
                key={surfaceKey(memory, s)}
                surface={s}
                shown={s === surface}
                sheetSlot={sheetSlot}
                email={email}
                onSignOut={guardedSignOut}
                onBoundary={registerBoundary}
              />
            ))}
          </div>
          {/* Montée à la première ouverture seulement : son chunk n'est demandé
              qu'à ce moment. Un échec de chargement ne casse pas l'app (frontière
              sans repli visible) et se retente à la prochaine ouverture. */}
          {refusedOpen && (
            <ErrorBoundary
              key={refusedAttempt}
              fallback={
                <RefusedLoadFailed onRetry={() => setRefusedAttempt((n) => n + 1)} onClose={() => setRefusedOpen(false)} />
              }
            >
              <Suspense fallback={null}>
                <RefusedWritesSheet open onClose={() => setRefusedOpen(false)} />
              </Suspense>
            </ErrorBoundary>
          )}
        </SheetSlotContext.Provider>
        </RefusedWritesContext.Provider>
      </SurfaceNavigationContext.Provider>

      {/* Emplacement des feuilles basses : collé en bas de la zone visible, sans
          `position: fixed` (DESIGN.md, Layout). */}
      <div ref={setSheetSlot} className="sticky bottom-0 z-40 h-0" />
    </main>
  )
}

/**
 * Une surface montée, affichée ou cachée (shell/surface-memory.ts). Mémoïsée :
 * l'app authentifiée se rend à chaque changement de la file d'écritures (une
 * série loggée), et les surfaces cachées n'ont pas à se rendre avec elle.
 */
const SurfaceSlot = memo(function SurfaceSlot({
  surface,
  shown,
  sheetSlot,
  email,
  onSignOut,
  onBoundary,
}: {
  surface: Surface
  shown: boolean
  sheetSlot: HTMLElement | null
  email: string | undefined
  onSignOut: (options?: { force?: boolean }) => Promise<void>
  onBoundary: (surface: Surface, boundary: ErrorBoundary | null) => void
}) {
  // Lu au rendu : après un import échoué et oublié, le composant paresseux est
  // neuf (`lazySurface`), et la surface remontée le redemande.
  const { analysis, seances, exercises, reglages } = lazyScreens
  const AnalysisScreen = analysis.Component
  const SeancesScreen = seances.Component
  const ExercisesScreen = exercises.Component
  const ReglagesScreen = reglages.Component
  const boundaryRef = useCallback((boundary: ErrorBoundary | null) => onBoundary(surface, boundary), [onBoundary, surface])
  return (
    <div style={shown ? SHOWN : PARKED} inert={!shown} aria-hidden={shown ? undefined : true}>
      <SurfaceActiveContext.Provider value={shown}>
        {/* Une feuille d'une surface cachée ne s'affiche pas par-dessus une
            autre : sans emplacement, elle attend son retour. */}
        <SheetSlotContext.Provider value={shown ? sheetSlot : null}>
          <ErrorBoundary ref={boundaryRef} surface={surface}>
            <Suspense fallback={<FullScreenSpinner label="Chargement" />}>
              {surface === 'capture' && <CaptureScreen />}
              {surface === 'analysis' && <AnalysisScreen />}
              {surface === 'seances' && <SeancesScreen />}
              {surface === 'exercises' && <ExercisesScreen />}
              {/* Compte (e-mail, Déconnexion), version et mise à jour vivent ici,
                  au calme : rien de tout cela n'a sa place dans le chrome
                  permanent ni en salle. App reste propriétaire de l'auth. */}
              {surface === 'reglages' && <ReglagesScreen email={email} onSignOut={onSignOut} />}
            </Suspense>
          </ErrorBoundary>
        </SheetSlotContext.Provider>
      </SurfaceActiveContext.Provider>
    </div>
  )
})

function FullScreenSpinner({ label }: { label: string }) {
  // Une phrase plutôt qu'une toupie (kit E, `Loading`).
  return (
    <main className="min-h-screen bg-bg text-ink">
      <Loading label={`${label}…`} />
    </main>
  )
}

export default App
