import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { AuthContext, type AuthContextValue } from './auth-context'
import { clearQueue } from '../features/capture/outbox'
import { flushOutbox } from '../features/capture/sync'
import { clearCaptureState } from '../features/capture/state'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  // Positionné à true dès que Supabase émet PASSWORD_RECOVERY — l'app aiguille
  // alors vers ResetPasswordScreen, prioritaire sur tout autre écran.
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false)

  useEffect(() => {
    let active = true

    // Session restaurée depuis le storage par défaut de supabase-js (localStorage).
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
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
      setSession(nextSession)
      setLoading(false)
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      isPasswordRecovery,
      signIn: async (email, password) => {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      },
      signUp: async (email, password) => {
        const { error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
      },
      signOut: async () => {
        // Best-effort : on tente de remonter les écritures offline encore en file
        // AVANT de purger (BUG M5) — sinon une déconnexion juste après une série
        // loggée hors-ligne perdrait ce réalisé. Le flush ne doit pas bloquer la
        // déconnexion indéfiniment : on l'enveloppe pour qu'un échec (offline,
        // erreur réseau) NE jette PAS et laisse la suite se dérouler.
        //
        // COMPROMIS confidentialité (appareil partagé) : si on est offline, le
        // flush échoue et la purge ci-dessous efface tout de même la file. On
        // accepte de perdre ces écritures non synchronisées plutôt que de les
        // laisser en clair pour le compte suivant sur le même appareil. La
        // durabilité offline protège le reload/kill (même utilisateur), pas le
        // changement de compte — la déconnexion est une frontière de propreté.
        try {
          await flushOutbox()
        } catch {
          /* offline ou flush en échec : on purge quand même (cf. compromis ci-dessus) */
        }
        const { error } = await supabase.auth.signOut()
        if (error) throw error
        // Purge les données locales en clair (réalisé de capture + outbox, blob de
        // quarantaine inclus) : sur un appareil partagé, elles ne doivent pas
        // survivre au départ de l'utilisateur. supabase.auth.signOut() ne nettoie
        // que son propre token.
        clearCaptureState()
        clearQueue()
      },
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
    [session, loading, isPasswordRecovery],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
