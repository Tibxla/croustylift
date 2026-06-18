import { useState, type FormEvent } from 'react'
import { useAuth } from './useAuth'

type Mode = 'signin' | 'signup'

/** Traduit les messages d'erreur Supabase courants en français lisible. */
function frenchError(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('invalid login credentials')) {
    return 'Email ou mot de passe incorrect.'
  }
  if (m.includes('email not confirmed')) {
    return 'Email non confirmé. Vérifie ta boîte de réception.'
  }
  if (m.includes('user already registered') || m.includes('already been registered')) {
    return 'Un compte existe déjà avec cet email.'
  }
  if (m.includes('password should be at least')) {
    return 'Le mot de passe est trop court (6 caractères minimum).'
  }
  if (m.includes('unable to validate email') || m.includes('invalid email')) {
    return 'Adresse email invalide.'
  }
  if (m.includes('rate limit') || m.includes('too many requests')) {
    return 'Trop de tentatives. Réessaie dans quelques instants.'
  }
  return 'Une erreur est survenue. Réessaie.'
}

export function LoginScreen() {
  const { signIn, signUp } = useAuth()
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [info, setInfo] = useState<string | null>(null)

  const isSignup = mode === 'signup'

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setInfo(null)
    setSubmitting(true)
    try {
      if (isSignup) {
        await signUp(email, password)
        // Si « Confirm email » est actif côté Supabase, aucune session n'est ouverte
        // immédiatement : on guide l'utilisateur. Sinon onAuthStateChange prend le relais.
        setInfo(
          'Compte créé. Si la confirmation par email est activée, vérifie ta boîte de réception.',
        )
      } else {
        await signIn(email, password)
      }
    } catch (err) {
      setError(frenchError(err instanceof Error ? err.message : String(err)))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <header className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Croustylift</h1>
          <p className="mt-2 text-sm text-neutral-400">
            {isSignup ? 'Crée ton compte.' : 'Connecte-toi pour continuer.'}
          </p>
        </header>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <label htmlFor="email" className="block text-sm font-medium text-neutral-300">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg bg-neutral-900 border border-neutral-800 px-4 py-3 text-base text-neutral-100 placeholder:text-neutral-500 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-500/40"
              placeholder="toi@exemple.com"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="password" className="block text-sm font-medium text-neutral-300">
              Mot de passe
            </label>
            <input
              id="password"
              type="password"
              autoComplete={isSignup ? 'new-password' : 'current-password'}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg bg-neutral-900 border border-neutral-800 px-4 py-3 text-base text-neutral-100 placeholder:text-neutral-500 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-500/40"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p role="alert" className="text-sm text-red-400">
              {error}
            </p>
          )}
          {info && !error && <p className="text-sm text-violet-300">{info}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-violet-600 px-4 py-3 text-base font-medium text-white transition hover:bg-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting
              ? 'Patiente…'
              : isSignup
                ? 'Créer mon compte'
                : 'Se connecter'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-neutral-400">
          {isSignup ? 'Déjà un compte ?' : 'Pas encore de compte ?'}{' '}
          <button
            type="button"
            onClick={() => {
              setMode(isSignup ? 'signin' : 'signup')
              setError(null)
              setInfo(null)
            }}
            className="font-medium text-violet-400 transition hover:text-violet-300"
          >
            {isSignup ? 'Se connecter' : 'Créer un compte'}
          </button>
        </p>
      </div>
    </main>
  )
}
