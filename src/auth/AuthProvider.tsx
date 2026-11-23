import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { isAuthRetryableFetchError, type Session } from '@supabase/supabase-js'
import { arrivalHash, supabase, supabaseAuthStorageKey } from '../lib/supabase'
import {
  arrivalFromHash,
  definePassword,
  hasPasswordProof,
  offlineStartSetupOwed,
  syncPasswordSetup,
} from './arrival-link'
import { AuthContext, PendingWritesError, type AuthContextValue } from './auth-context'
import { clearLocalAccount, loadLocalAccount, type LocalAccount } from '../lib/local-account'
import { arrivalBlockedBy, recognizeAccount } from './account-switch'
import { ArrivalGuardScreen } from './ArrivalGuardScreen'
import { clearReadCache } from '../lib/read-cache'
import { setSessionUserReader } from '../lib/session-identity'
import { clearLocalPrefs } from '../lib/local-prefs'
import {
  adoptLegacyOps,
  clearOwnQueue,
  clearQueue,
  heldCounts,
} from '../features/capture/outbox'
import { foreignPendingWrites } from './pending-guard'
import { flushOutbox } from '../features/capture/sync'
import { clearCaptureState, clearOwnCaptureState } from '../features/capture/state'

/**
 * Budget d'attente du boot (ADR 0012) : au-delà, la décision est LOCALE
 * (marqueur présent → app sur les copies locales ; absent → login). Couvre le
 * wifi zombie (portail captif, DNS qui pend) où le fetch de refresh de
 * supabase-js ne répond jamais — sans cette borne, le spinner était éternel.
 */
const BOOT_TIMEOUT_MS = 3000

// Lecteur de session (cf. lib/session-identity) : posé ici, au chargement du
// module d'auth, pour que la pagination et le flush de l'outbox puissent
// vérifier QUI est connecté sans rien savoir de supabase-js.
setSessionUserReader(async () => {
  const { data } = await supabase.auth.getSession()
  return data.session?.user.id ?? null
})

// Migration douce de la file d'écritures (audit sécurité, constat 1) : les ops
// d'un bundle antérieur, sans compte, sont attribuées au compte reconnu ICI, au
// chargement, avant que le moindre événement d'auth ne réécrive le marqueur.
adoptLegacyOps()

// Arrivée par lien d'INVITATION : la session s'ouvre par un simple SIGNED_IN,
// sans PASSWORD_RECOVERY. Le premier événement porteur de session envoie donc
// l'invité définir son mot de passe (une seule fois par chargement de page).
// Ce fragment n'est que le premier signal : l'obligation elle-même est tenue
// par le serveur et relue sur chaque session (`syncPasswordSetup`).
let inviteArrivalPending = arrivalFromHash(arrivalHash).kind === 'invite'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  // Positionné à true dès que Supabase émet PASSWORD_RECOVERY, ou à l'arrivée par
  // un lien d'invitation : l'app aiguille alors vers ResetPasswordScreen,
  // prioritaire sur tout autre écran.
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false)
  // Obligation de l'INVITÉ : son mot de passe n'est pas encore défini (cf.
  // arrival-link). Tenue à part de la récupération, parce qu'elle se relit sur
  // chaque session et peut retomber seule (mot de passe défini ailleurs), ce
  // qu'un flux de récupération en cours ne doit jamais faire.
  const [passwordSetupOwed, setPasswordSetupOwed] = useState(false)
  // Marqueur d'identité local (ADR 0012) : qui est reconnu sur cet appareil.
  const [localAccount, setLocalAccount] = useState<LocalAccount | null>(() => loadLocalAccount())
  // Vrai quand la session est invérifiable (réseau) mais que la Session locale
  // fait foi : l'app s'ouvre sans validation serveur, la revalidation suivra.
  const [offlineRecognized, setOfflineRecognized] = useState(false)
  // Arrivée RETENUE par la garde (ADR 0019) : une session s'est ouverte, par lien
  // ou restauration, pour un autre compte que celui dont l'appareil retient des
  // saisies. Elle n'est ni reconnue ni montrée à l'app tant que l'utilisateur n'a
  // pas tranché (cf. ArrivalGuardScreen) : forcer, ou y renoncer.
  const [heldArrival, setHeldArrival] = useState<{
    session: Session
    /** Arrivée par un lien de récupération : l'écran de mot de passe au forçage. */
    recovery: boolean
    /** Invité sans mot de passe : l'obligation suit l'arrivée si elle est forcée. */
    setupOwed: boolean
    /** Le compte dont les saisies attendent, et combien. */
    email: string | null
    held: number
  } | null>(null)

  useEffect(() => {
    let active = true
    let settled = false

    // Démarrage en SESSION LOCALE (ADR 0012) : pas de session, donc rien à lire
    // du serveur. La copie de l'obligation écrite sur l'appareil fait foi
    // jusqu'à la première session validée, qui la confirme ou la lève.
    const recognizeOffline = () => {
      const account = loadLocalAccount()
      if (!account) return
      if (offlineStartSetupOwed(account)) setPasswordSetupOwed(true)
      setOfflineRecognized(true)
    }

    // Boot borné (ADR 0012) : si getSession() n'a pas répondu sous 3 s (wifi
    // zombie), on tranche localement. Une réponse tardive reprendra la main via
    // onAuthStateChange (TOKEN_REFRESHED / SIGNED_OUT) — jamais de fantôme.
    const timer = setTimeout(() => {
      if (!active || settled) return
      settled = true
      recognizeOffline()
      setLoading(false)
    }, BOOT_TIMEOUT_MS)

    // Session restaurée depuis le storage par défaut de supabase-js (localStorage).
    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!active || settled) return
        settled = true
        clearTimeout(timer)
        if (data.session) {
          // Sous la garde d'arrivée : c'est l'événement d'auth qui tranchera.
          if (arrivalBlockedBy(data.session.user.id) === 0) {
            // Session restaurée d'un invité qui n'a pas encore de mot de passe :
            // l'écran de mot de passe d'abord, dès ce premier rendu.
            if (syncPasswordSetup(data.session, inviteArrivalPending)) setPasswordSetupOwed(true)
            setSession(data.session)
          }
        } else if (error && isAuthRetryableFetchError(error)) {
          // Session présente mais INVÉRIFIABLE (jeton périmé + réseau injoignable) :
          // la Session locale fait foi (ADR 0012). supabase-js garde sa session en
          // storage et le refresh retente en fond — au retour du réseau, soit elle
          // se revalide (TOKEN_REFRESHED), soit elle s'avère révoquée (SIGNED_OUT).
          recognizeOffline()
        }
        // `null` SANS erreur réseau = vraiment déconnecté (jamais connecté, ou
        // révocation déjà actée) → login. Le marqueur, lui, n'est pas touché :
        // les données locales survivent à une révocation (ADR 0012).
        setLoading(false)
      })
      .catch(() => {
        if (!active || settled) return
        settled = true
        clearTimeout(timer)
        recognizeOffline()
        setLoading(false)
      })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return
      // OBLIGATION DE MOT DE PASSE de l'invité, AVANT la garde d'arrivée : elle
      // se lit sur la session (serveur), sur le fragment de ce chargement et sur
      // la copie de l'appareil, et cette copie est réécrite ici. Une arrivée
      // retenue par la garde, puis rechargée (plus de fragment), puis forcée,
      // la retrouve donc entière.
      let setupOwed = false
      if (nextSession?.user) {
        setupOwed = syncPasswordSetup(nextSession, inviteArrivalPending)
        inviteArrivalPending = false
      }
      // GARDE D'ARRIVÉE (ADR 0019), avant tout le reste : une session pour un AUTRE compte
      // que celui dont l'appareil retient des saisies n'entre pas. Elle couvre ce
      // que `signIn` ne voit pas : lien de récupération, lien d'invitation,
      // session restaurée. La session est gardée de côté, le marqueur ne bouge pas.
      if (nextSession?.user) {
        const held = arrivalBlockedBy(nextSession.user.id)
        if (held > 0) {
          const recovery = event === 'PASSWORD_RECOVERY'
          setHeldArrival((current) => ({
            session: nextSession,
            recovery: recovery || (current?.recovery ?? false),
            setupOwed: setupOwed || (current?.setupOwed ?? false),
            email: loadLocalAccount()?.email ?? null,
            held,
          }))
          setSession(null)
          setLoading(false)
          return
        }
      }
      if (nextSession?.user) {
        // Posée pour toute session qui entre ; ne retombe que sur PREUVE d'un
        // mot de passe (défini ici ou ailleurs), jamais sur une copie manquante.
        if (setupOwed) setPasswordSetupOwed(true)
        else if (hasPasswordProof(nextSession)) setPasswordSetupOwed(false)
      }
      if (event === 'PASSWORD_RECOVERY') {
        // On a une session temporaire recovery : on la garde pour pouvoir appeler
        // updateUser(), mais on signale à l'app qu'il faut afficher le reset.
        setSession(nextSession)
        setIsPasswordRecovery(true)
        setLoading(false)
        return
      }
      if (nextSession?.user) {
        // Session validée par le serveur (Connexion, refresh, restauration) : on
        // (ré)affirme le marqueur — c'est LE moment où l'appareil devient reconnu.
        const account: LocalAccount = {
          userId: nextSession.user.id,
          email: nextSession.user.email ?? null,
        }
        // Un compte DIFFÉRENT du précédent : ses copies locales sont d'abord
        // purgées, sauf écritures encore retenues (cf. account-switch).
        recognizeAccount(account)
        setLocalAccount(account)
        setOfflineRecognized(false)
        setSession(nextSession)
        setLoading(false)
        return
      }
      if (event === 'SIGNED_OUT') {
        setHeldArrival(null)
        // Plus de session : l'obligation de l'invité n'a plus d'objet ici (sans
        // quoi son écran masquerait la connexion). Elle sera relue à la suivante.
        setPasswordSetupOwed(false)
        // Déconnexion volontaire OU révocation : la session n'existe plus, la
        // reconnaissance hors-ligne tombe avec elle. Le marqueur et les données
        // locales, eux, ne partent qu'avec la Déconnexion (cf. signOut) — une
        // révocation n'est pas une Déconnexion (ADR 0012).
        setSession(null)
        setOfflineRecognized(false)
        setLoading(false)
        return
      }
      // INITIAL_SESSION sans session (boot hors-ligne) : on n'écrase PAS la
      // reconnaissance locale posée par le chemin getSession ci-dessus.
      setSession(nextSession)
      setLoading(false)
    })

    return () => {
      active = false
      clearTimeout(timer)
      subscription.unsubscribe()
    }
  }, [])

  // Forçage de purge locale (ADR 0012) : la SEULE porte par laquelle des
  // écritures non synchronisées peuvent disparaître. Toujours sur geste explicite.
  const forgetLocalData = useCallback(() => {
    clearCaptureState()
    clearQueue()
    clearReadCache()
    clearLocalPrefs()
    clearLocalAccount()
    setLocalAccount(null)
    setOfflineRecognized(false)
  }, [])

  // Purge de la DÉCONNEXION : ce qui est au compte qui part, et rien d'autre. Les
  // écritures et la capture d'un AUTRE compte encore retenues sur l'appareil
  // restent pour son retour : seul le forçage (`forgetLocalData`) les jette.
  const forgetOwnLocalData = useCallback(() => {
    clearOwnCaptureState()
    clearOwnQueue()
    clearReadCache()
    clearLocalPrefs()
    clearLocalAccount()
    setLocalAccount(null)
    setOfflineRecognized(false)
  }, [])

  // Garde d'arrivée, issue 1 : FORCER. Les saisies retenues sont purgées (geste
  // explicite, ADR 0012), puis le compte arrivé est reconnu et entre.
  const forceHeldArrival = useCallback(() => {
    if (!heldArrival) return
    forgetLocalData()
    const account: LocalAccount = {
      userId: heldArrival.session.user.id,
      email: heldArrival.session.user.email ?? null,
    }
    recognizeAccount(account)
    setLocalAccount(account)
    setSession(heldArrival.session)
    if (heldArrival.recovery) setIsPasswordRecovery(true)
    // Relue sur la session retenue, et réécrite après la purge : forcer la garde
    // ne fait pas entrer un invité sans mot de passe.
    if (syncPasswordSetup(heldArrival.session, heldArrival.setupOwed)) setPasswordSetupOwed(true)
    setHeldArrival(null)
  }, [heldArrival, forgetLocalData])

  // Garde d'arrivée, issue 2 : RENONCER. La session arrivée est fermée sur cet
  // appareil ; rien n'est purgé, le compte précédent peut se reconnecter.
  const cancelHeldArrival = useCallback(() => {
    setHeldArrival(null)
    void supabase.auth.signOut({ scope: 'local' }).then(({ error }) => {
      if (!error) return
      try {
        localStorage.removeItem(supabaseAuthStorageKey)
      } catch {
        /* stockage indisponible : rien à retirer */
      }
    })
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      isPasswordRecovery: isPasswordRecovery || passwordSetupOwed,
      localAccount,
      offlineRecognized,
      signIn: async (email, password) => {
        // Un AUTRE compte veut s'installer par-dessus des écritures non
        // synchronisées (ex. après révocation) : refus — seul le forçage
        // explicite peut les jeter (ADR 0012).
        const held = foreignPendingWrites(email)
        if (held > 0) throw new PendingWritesError(held)
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      },
      signOut: async ({ force = false } = {}) => {
        // Rien ne se perd sans geste explicite (ADR 0012) : on tente d'abord de
        // vider la file, puis on REFUSE la déconnexion s'il reste des écritures.
        // L'ancien compromis « purge quand même » (frontière de propreté sur
        // appareil partagé) vit désormais derrière le forçage : celui qui prête
        // son téléphone purge en connaissance de cause.
        try {
          await flushOutbox()
        } catch {
          /* hors-ligne ou flush en échec : le blocage ci-dessous tranche */
        }
        // Les ops en quarantaine (rejetées par la base) comptent aussi : la
        // Déconnexion les purgerait, donc seul le forçage peut les jeter. On ne
        // compte que les écritures de CE compte : celles d'un autre compte encore
        // retenues sur l'appareil ne le retiennent pas, et sa Déconnexion, forcée
        // ou non, ne les jette pas (cf. `forgetOwnLocalData`).
        const { own, ownRefused } = heldCounts()
        if (!force && own > 0) throw new PendingWritesError(own, ownRefused)

        // Portée LOCALE : seule la session de CET appareil est révoquée. La
        // portée par défaut de supabase-js (« global ») déconnectait aussi le
        // téléphone quand on se déconnectait de l'ordinateur.
        const { error } = await supabase.auth.signOut({ scope: 'local' })
        if (error) {
          // Hors-ligne, supabase-js REFUSE de retirer sa session locale (l'appel
          // réseau échoue avant sa purge interne). File vide ou forçage : la
          // Déconnexion doit pourtant aboutir sur l'appareil → on retire sa clé
          // nous-mêmes (purge de secours d'un artefact connu — la garde de route,
          // elle, ne lit jamais cette clé). Le refresh token n'est alors pas
          // révoqué côté serveur : assumé, c'est la purge locale qui compte.
          if (!force && !isAuthRetryableFetchError(error)) throw error
          try {
            localStorage.removeItem(supabaseAuthStorageKey)
          } catch {
            /* stockage indisponible : rien à retirer */
          }
          setSession(null)
        }
        // Purge les données locales en clair de CE compte (réalisé de capture,
        // outbox et blob de quarantaine, copies de lecture, marqueur) : sur un
        // appareil partagé, elles ne doivent pas survivre à son départ.
        forgetOwnLocalData()
      },
      forgetLocalData,
      requestPasswordReset: async (email) => {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin,
        })
        if (error) throw error
      },
      updatePassword: async (password) => {
        // Enregistré, puis prouvé par une session ouverte AVEC lui : c'est elle
        // (SIGNED_IN, `amr: password`) qui lève l'obligation de l'invité et sa
        // copie sur l'appareil (cf. arrival-link, `definePassword`).
        await definePassword(supabase.auth, session?.user.email, password)
      },
      clearPasswordRecovery: () => {
        setIsPasswordRecovery(false)
        setPasswordSetupOwed(false)
      },
    }),
    [
      session,
      loading,
      isPasswordRecovery,
      passwordSetupOwed,
      localAccount,
      offlineRecognized,
      forgetLocalData,
      forgetOwnLocalData,
    ],
  )

  return (
    <AuthContext.Provider value={value}>
      {heldArrival ? (
        <ArrivalGuardScreen
          heldEmail={heldArrival.email}
          arrivingEmail={heldArrival.session.user.email ?? null}
          held={heldArrival.held}
          onForce={forceHeldArrival}
          onCancel={cancelHeldArrival}
        />
      ) : (
        children
      )}
    </AuthContext.Provider>
  )
}
