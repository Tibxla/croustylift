import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

/** Traduit les erreurs Supabase de réinitialisation en français lisible. */
function frenchError(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('rate limit') || m.includes('too many requests') || m.includes('email rate limit')) {
    return 'Trop de demandes. Réessaie dans quelques instants.'
  }
  if (m.includes('unable to validate email') || m.includes('invalid email')) {
    return 'Adresse email invalide.'
  }
  return 'Une erreur est survenue. Réessaie.'
}

interface Props {
  onBack: () => void
}

export function ForgotPasswordScreen({ onBack }: Props) {
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const { error: supaErr } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin,
      })
      if (supaErr) throw supaErr
      setSent(true)
    } catch (err) {
      setError(frenchError(err instanceof Error ? err.message : String(err)))
    } finally {
      setSubmitting(false)
    }
  }

  if (sent) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg px-6 text-ink">
        <div className="w-full max-w-sm text-center">
          <header className="mb-8">
            <h1 className="text-2xl font-semibold tracking-tight">Email envoyé</h1>
            <p className="mt-2 text-sm text-ink-muted">
              Si un compte existe pour cette adresse, tu recevras un lien de réinitialisation.
            </p>
          </header>
          <button
            type="button"
            onClick={onBack}
            className="rounded font-medium text-accent-ink transition hover:text-accent text-sm"
          >
            Retour a la connexion
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-6 text-ink">
      <div className="w-full max-w-sm">
        <header className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Mot de passe oublie</h1>
          <p className="mt-2 text-sm text-ink-muted">
            Saisis ton email pour recevoir un lien de reinitialisation.
          </p>
        </header>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <label htmlFor="forgot-email" className="block text-sm font-medium text-ink">
              Email
            </label>
            <input
              id="forgot-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-line bg-surface px-4 py-3 text-base text-ink transition placeholder:text-ink-muted/70 focus:border-accent"
              placeholder="toi@exemple.com"
            />
          </div>

          {error && (
            <p role="alert" className="flex items-start gap-2 text-sm text-warn">
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

          <button
            type="submit"
            disabled={submitting || !email}
            className="w-full rounded-lg bg-accent-strong px-4 py-3 text-base font-medium text-on-accent transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? 'Envoi en cours...' : 'Envoyer le lien'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-ink-muted">
          <button
            type="button"
            onClick={onBack}
            className="rounded font-medium text-accent-ink transition hover:text-accent"
          >
            Retour a la connexion
          </button>
        </p>
      </div>
    </main>
  )
}
