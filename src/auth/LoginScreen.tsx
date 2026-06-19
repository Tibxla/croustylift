import { useState, type FormEvent } from 'react'
import { useAuth } from './useAuth'
import { ForgotPasswordScreen } from './ForgotPasswordScreen'

type Mode = 'signin' | 'signup' | 'forgot'

/** Longueur minimale du mot de passe, alignée sur la politique Supabase. */
const MIN_PASSWORD_LENGTH = 8

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
    // Message non-énumérant : ne pas confirmer l'existence d'une adresse (cohérent
    // avec le login neutre). Supabase n'ouvre pas de session si l'email existe déjà ;
    // l'utilisateur reçoit un mail s'il s'agit bien d'un compte connu.
    return "Si un compte peut être créé, tu recevras un email pour confirmer."
  }
  if (m.includes('password should be at least')) {
    return 'Le mot de passe est trop court (8 caractères minimum).'
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
  // TOUS les hooks AVANT le moindre return conditionnel (règle des Hooks). Avant,
  // le `if (mode === 'forgot') return …` précédait ces useState : passer en mode
  // « mot de passe oublié » rendait MOINS de hooks que le render précédent et
  // faisait planter React (« rendered fewer hooks than expected »).
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [info, setInfo] = useState<string | null>(null)

  if (mode === 'forgot') {
    return <ForgotPasswordScreen onBack={() => setMode('signin')} />
  }

  const isSignup = mode === 'signup'

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setInfo(null)
    if (isSignup && password.length < MIN_PASSWORD_LENGTH) {
      setError(`Le mot de passe est trop court (${MIN_PASSWORD_LENGTH} caractères minimum).`)
      return
    }
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
    <main className="flex min-h-screen items-center justify-center bg-bg px-6 text-ink">
      <div className="w-full max-w-sm">
        <header className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Croustylift</h1>
          <p className="mt-2 text-sm text-ink-muted">
            {isSignup ? 'Crée ton compte.' : 'Connecte-toi pour continuer.'}
          </p>
        </header>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <label htmlFor="email" className="block text-sm font-medium text-ink">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-line bg-surface px-4 py-3 text-base text-ink transition placeholder:text-ink-muted/70 focus:border-accent"
              placeholder="toi@exemple.com"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between">
              <label htmlFor="password" className="block text-sm font-medium text-ink">
                Mot de passe
              </label>
              {!isSignup && (
                <button
                  type="button"
                  onClick={() => setMode('forgot')}
                  className="rounded text-xs text-ink-muted transition hover:text-accent-ink"
                >
                  Mot de passe oublie ?
                </button>
              )}
            </div>
            <input
              id="password"
              type="password"
              autoComplete={isSignup ? 'new-password' : 'current-password'}
              required
              minLength={isSignup ? MIN_PASSWORD_LENGTH : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-line bg-surface px-4 py-3 text-base text-ink transition placeholder:text-ink-muted/70 focus:border-accent"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p role="alert" className="flex items-start gap-2 text-sm text-warn">
              {/* Glyphe d'alerte : double l'info couleur par une forme (DESIGN.md). */}
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="mt-0.5 shrink-0"
              >
                <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
              </svg>
              {error}
            </p>
          )}
          {info && !error && <p className="text-sm text-accent-ink">{info}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-accent-strong px-4 py-3 text-base font-medium text-on-accent transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting
              ? isSignup
                ? 'Création du compte…'
                : 'Connexion…'
              : isSignup
                ? 'Créer mon compte'
                : 'Se connecter'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-ink-muted">
          {isSignup ? 'Déjà un compte ?' : 'Pas encore de compte ?'}{' '}
          <button
            type="button"
            onClick={() => {
              setMode(isSignup ? 'signin' : 'signup')
              setError(null)
              setInfo(null)
            }}
            className="rounded font-medium text-accent-ink transition hover:text-accent"
          >
            {isSignup ? 'Se connecter' : 'Créer un compte'}
          </button>
        </p>
      </div>
    </main>
  )
}
