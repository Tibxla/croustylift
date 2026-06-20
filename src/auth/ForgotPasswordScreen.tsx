import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { AuthShell, FieldLabel } from './AuthShell'

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
      <AuthShell
        mark={false}
        footer={false}
        titleSize={30}
        title="E-mail envoyé."
        subtitle="Si un compte existe pour cette adresse, tu recevras un lien de réinitialisation."
      >
        <button
          type="button"
          onClick={onBack}
          className="block w-full rounded text-center text-sm font-medium text-accent-ink transition active:text-accent"
        >
          Retour à la connexion
        </button>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      mark={false}
      footer={false}
      titleSize={30}
      backLabel="Connexion"
      onBack={onBack}
      title="Mot de passe oublié."
      subtitle="Saisis ton e-mail pour recevoir un lien de réinitialisation."
    >
      <form onSubmit={handleSubmit} className="space-y-[18px]" noValidate>
        <div>
          <FieldLabel htmlFor="forgot-email">E-mail</FieldLabel>
          <input
            id="forgot-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="field h-[54px] w-full rounded-[14px] px-4 text-base"
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
          className="btn btn-primary h-14 w-full rounded-2xl text-[17px]"
        >
          {submitting ? 'Envoi en cours…' : 'Envoyer le lien'}
        </button>
      </form>
    </AuthShell>
  )
}
