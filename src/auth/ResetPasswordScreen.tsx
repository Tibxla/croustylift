import { useState, type FormEvent } from 'react'
import { useAuth } from './useAuth'

/** Longueur minimale du mot de passe, alignée sur la politique Supabase et le signup. */
const MIN_PASSWORD_LENGTH = 10

/** Traduit les erreurs Supabase de mise a jour en français lisible. */
function frenchError(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('password should be at least')) {
    return 'Le mot de passe est trop court (8 caracteres minimum).'
  }
  if (m.includes('same password')) {
    return 'Le nouveau mot de passe doit etre different de l\'ancien.'
  }
  if (m.includes('session') || m.includes('expired') || m.includes('token')) {
    return 'Le lien de reinitialisation a expire. Demande un nouveau lien.'
  }
  return 'Une erreur est survenue. Reessaie.'
}

export function ResetPasswordScreen() {
  const { updatePassword, clearPasswordRecovery } = useAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Le mot de passe est trop court (${MIN_PASSWORD_LENGTH} caracteres minimum).`)
      return
    }
    if (password !== confirm) {
      setError('Les deux mots de passe ne correspondent pas.')
      return
    }

    setSubmitting(true)
    try {
      await updatePassword(password)
      setDone(true)
      // Après succès, on sort du mode recovery — onAuthStateChange aura déjà
      // émis SIGNED_IN et ouvert la session normale ; on efface juste le flag.
      clearPasswordRecovery()
    } catch (err) {
      setError(frenchError(err instanceof Error ? err.message : String(err)))
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg px-6 text-ink">
        <div className="w-full max-w-sm text-center">
          <header className="mb-8">
            <h1 className="text-2xl font-semibold tracking-tight">Mot de passe mis a jour</h1>
            <p className="mt-2 text-sm text-ink-muted">
              Ton mot de passe a ete change. Tu es maintenant connecte.
            </p>
          </header>
        </div>
      </main>
    )
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-6 text-ink">
      <div className="w-full max-w-sm">
        <header className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Nouveau mot de passe</h1>
          <p className="mt-2 text-sm text-ink-muted">
            Choisis un mot de passe d'au moins {MIN_PASSWORD_LENGTH} caracteres.
          </p>
        </header>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <label htmlFor="new-password" className="block text-sm font-medium text-ink">
              Nouveau mot de passe
            </label>
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={MIN_PASSWORD_LENGTH}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-line bg-surface px-4 py-3 text-base text-ink transition placeholder:text-ink-muted/70 focus:border-accent"
              placeholder="••••••••"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="confirm-password" className="block text-sm font-medium text-ink">
              Confirmer le mot de passe
            </label>
            <input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={MIN_PASSWORD_LENGTH}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full rounded-lg border border-line bg-surface px-4 py-3 text-base text-ink transition placeholder:text-ink-muted/70 focus:border-accent"
              placeholder="••••••••"
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
            disabled={submitting || !password || !confirm}
            className="w-full rounded-lg bg-accent-strong px-4 py-3 text-base font-medium text-on-accent transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? 'Mise a jour...' : 'Mettre a jour le mot de passe'}
          </button>
        </form>
      </div>
    </main>
  )
}
