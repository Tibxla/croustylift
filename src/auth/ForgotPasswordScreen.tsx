import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { AuthShell } from './AuthShell'
import { PrimaryButton, TextField } from '../ui'

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
        title="E-mail envoyé"
        back={{ label: 'Connexion', onClick: onBack }}
        bottom={<PrimaryButton onClick={onBack}>Retour à la connexion</PrimaryButton>}
      >
        <div className="px-5">
          <p className="text-[16px] leading-[1.5] text-ink">
            Si un compte existe pour <span className="font-semibold">{email.trim()}</span>, tu
            recevras un lien de réinitialisation.
          </p>
          <p className="mt-2 text-[15px] leading-[1.5] text-muted">
            Il ouvre l’écran du nouveau mot de passe et ne sert qu’une fois.
          </p>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="Mot de passe oublié"
      meta="Saisis ton e-mail pour recevoir un lien de réinitialisation."
      back={{ label: 'Connexion', onClick: onBack }}
      onSubmit={handleSubmit}
      bottom={
        <PrimaryButton type="submit" disabled={submitting || !email}>
          {submitting ? 'Envoi en cours…' : 'Envoyer le lien'}
        </PrimaryButton>
      }
    >
      <TextField
        id="forgot-email"
        label="E-mail"
        type="email"
        inputMode="email"
        autoComplete="email"
        required
        value={email}
        onChange={setEmail}
        placeholder="toi@exemple.com"
        enterKeyHint="send"
        error={error}
        className="px-5"
      />
    </AuthShell>
  )
}
