import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { isAuthRetryableFetchError, type Session } from '@supabase/supabase-js'
import { arrivalHash, supabase, supabaseAuthStorageKey } from '../lib/supabase'
import { arrivalFromHash } from './arrival-link'
import { AuthContext, PendingWritesError, type AuthContextValue } from './auth-context'
import { clearLocalAccount, loadLocalAccount, type LocalAccount } from '../lib/local-account'
import { recognizeAccount } from './account-switch'
import { clearReadCache } from '../lib/read-cache'
import { setSessionUserReader } from '../lib/session-identity'
import { clearLocalPrefs } from '../lib/local-prefs'
import {
  adoptLegacyOps,
  clearQueue,
  heldCount,
  quarantineCount,
} from '../features/capture/outbox'
import { foreignPendingWrites } from './pending-guard'
import { flushOutbox } from '../features/capture/sync'
import { clearCaptureState } from '../features/capture/state'

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
let inviteArrivalPending = arrivalFromHash(arrivalHash).kind === 'invite'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  // Positionné à true dès que Supabase émet PASSWORD_RECOVERY, ou à l'arrivée par
  // un lien d'invitation : l'app aiguille alors vers ResetPasswordScreen,
  // prioritaire sur tout autre écran.
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false)
  // Marqueur d'identité local (ADR 0012) : qui est reconnu sur cet appareil.
  const [localAccount, setLocalAccount] = useState<LocalAccount | null>(() => loadLocalAccount())
  // Vrai quand la session est invérifiable (réseau) mais que la Session locale
  // fait foi : l'app s'ouvre sans validation serveur, la revalidation suivra.
  const [offlineRecognized, setOfflineRecognized] = useState(false)

  useEffect(() => {
    let active = true
    let settled = false

    // Boot borné (ADR 0012) : si getSession() n'a pas répondu sous 3 s (wifi
    // zombie), on tranche localement. Une réponse tardive reprendra la main via
    // onAuthStateChange (TOKEN_REFRESHED / SIGNED_OUT) — jamais de fantôme.
    const timer = setTimeout(() => {
      if (!active || settled) return
      settled = true
      if (loadLocalAccount()) setOfflineRecognized(true)
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
          setSession(data.session)
        } else if (error && isAuthRetryableFetchError(error) && loadLocalAccount()) {
          // Session présente mais INVÉRIFIABLE (jeton périmé + réseau injoignable) :
          // la Session locale fait foi (ADR 0012). supabase-js garde sa session en
          // storage et le refresh retente en fond — au retour du réseau, soit elle
          // se revalide (TOKEN_REFRESHED), soit elle s'avère révoquée (SIGNED_OUT).
          setOfflineRecognized(true)
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
        if (loadLocalAccount()) setOfflineRecognized(true)
        setLoading(false)
      })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return
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
        if (inviteArrivalPending) {
          inviteArrivalPending = false
          setIsPasswordRecovery(true)
        }
        setLoading(false)
        return
      }
      if (event === 'SIGNED_OUT') {
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

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      isPasswordRecovery,
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
        // Déconnexion les purgerait, donc seul le forçage peut les jeter.
        const pending = heldCount()
        if (!force && pending > 0) throw new PendingWritesError(pending, quarantineCount())

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
        // Purge les données locales en clair (réalisé de capture, outbox et blob
        // de quarantaine, copies de lecture, marqueur) : sur un appareil partagé,
        // elles ne doivent pas survivre au départ de l'utilisateur.
        forgetLocalData()
      },
      forgetLocalData,
      requestPasswordReset: async (email) => {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin,
        })
        if (error) throw error
      },
      updatePassword: async (password) => {
        const { error } = await supabase.auth.updateUser({ password })
        if (error) throw error
      },
      clearPasswordRecovery: () => {
        setIsPasswordRecovery(false)
      },
    }),
    [session, loading, isPasswordRecovery, localAccount, offlineRecognized, forgetLocalData],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
