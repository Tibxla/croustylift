import { createContext } from 'react'
import type { Session, User } from '@supabase/supabase-js'

export interface AuthContextValue {
  session: Session | null
  user: User | null
  loading: boolean
  /** Vrai quand Supabase a emit PASSWORD_RECOVERY — l'app affiche l'écran de reset. */
  isPasswordRecovery: boolean
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  requestPasswordReset: (email: string) => Promise<void>
  updatePassword: (password: string) => Promise<void>
  /** Appelé après le succès de updatePassword pour quitter le mode recovery. */
  clearPasswordRecovery: () => void
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined)
