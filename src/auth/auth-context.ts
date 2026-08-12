import { createContext } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import type { LocalAccount } from '../lib/local-account'

/**
 * Déconnexion REFUSÉE : des écritures locales attendent encore la synchro
 * (ADR 0012). L'UI la rattrape pour proposer le forçage explicite — la seule
 * porte de purge de l'app — au lieu de perdre des saisies en silence.
 */
export class PendingWritesError extends Error {
  /** Nombre d'écritures encore en file au moment du refus. */
  readonly pending: number

  constructor(pending: number) {
    super(`${pending} écriture(s) locale(s) en attente de synchronisation.`)
    this.name = 'PendingWritesError'
    this.pending = pending
  }
}

export interface AuthContextValue {
  session: Session | null
  user: User | null
  loading: boolean
  /** Vrai quand Supabase a emit PASSWORD_RECOVERY — l'app affiche l'écran de reset. */
  isPasswordRecovery: boolean
  /** Marqueur d'identité local (ADR 0012) : posé à la Connexion, retiré à la Déconnexion. */
  localAccount: LocalAccount | null
  /**
   * Vrai quand la session est INVÉRIFIABLE (réseau injoignable / boot borné à
   * 3 s) mais que la Session locale fait foi (ADR 0012) : l'app s'ouvre sur les
   * copies locales, la revalidation attend le retour du réseau.
   */
  offlineRecognized: boolean
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string) => Promise<void>
  /**
   * Déconnexion. Jette `PendingWritesError` si des écritures locales attendent
   * encore (ADR 0012) ; `force: true` assume la perte et purge quand même.
   */
  signOut: (options?: { force?: boolean }) => Promise<void>
  /**
   * Forçage de purge locale (la SEULE porte, ADR 0012) : outbox, capture du
   * jour, copies de lecture et marqueur. À n'appeler que sur geste explicite.
   */
  forgetLocalData: () => void
  requestPasswordReset: (email: string) => Promise<void>
  updatePassword: (password: string) => Promise<void>
  /** Appelé après le succès de updatePassword pour quitter le mode recovery. */
  clearPasswordRecovery: () => void
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined)
