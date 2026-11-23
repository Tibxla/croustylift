import { useState, type FormEvent } from 'react'
import { useAuth } from './useAuth'
import { AuthShell, FieldLabel, PasswordField } from './AuthShell'
import { networkErrorMessage } from '../lib/error-message'

/** Longueur minimale du mot de passe, alignée sur la politique Supabase. */
const MIN_PASSWORD_LENGTH = 10

/** Traduit les erreurs Supabase de mise à jour en français lisible. */
function frenchError(message: string): string {
  // Hors ligne (invité qui rouvre l'app sans réseau) : ce n'est pas le lien.
  const network = networkErrorMessage(message)
  if (network) return network
  const m = message.toLowerCase()
  if (m.includes('password should be at least')) {
    return `Le mot de passe est trop court (${MIN_PASSWORD_LENGTH} caractères minimum).`
  }
  if (m.includes('same password')) {
    return 'Le nouveau mot de passe doit être différent de l’ancien.'
  }
  if (m.includes('session') || m.includes('expired') || m.includes('token')) {
    return 'Le lien a expiré. Demande un nouveau lien.'
  }
  return 'Une erreur est survenue. Réessaie.'
}

/**
 * Écran de définition du mot de passe, commun aux deux arrivées par lien
 * d'e-mail : récupération (mot de passe oublié) et invitation (premier mot de
 * passe d'un compte créé depuis le tableau de bord, l'inscription étant fermée).
 */
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
      setError(`Le mot de passe est trop court (${MIN_PASSWORD_LENGTH} caractères minimum).`)
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
      <AuthShell
        mark={false}
        footer={false}
        titleSize={30}
        title="Mot de passe enregistré."
        subtitle="Tu es maintenant connecté."
      >
        <span className="sr-only">Mot de passe enregistré.</span>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      mark={false}
      footer={false}
      titleSize={30}
      title="Ton mot de passe."
      subtitle={`Choisis un mot de passe d’au moins ${MIN_PASSWORD_LENGTH} caractères.`}
    >
      <form onSubmit={handleSubmit} className="space-y-[18px]" noValidate>
        <div>
          <FieldLabel htmlFor="new-password">Mot de passe</FieldLabel>
          <PasswordField
            id="new-password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
          />
        </div>

        <div>
          <FieldLabel htmlFor="confirm-password">Confirmer le mot de passe</FieldLabel>
          <PasswordField
            id="confirm-password"
            value={confirm}
            onChange={setConfirm}
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
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
          className="btn btn-primary h-14 w-full rounded-2xl text-base"
        >
          {submitting ? 'Enregistrement…' : 'Enregistrer le mot de passe'}
        </button>
      </form>
    </AuthShell>
  )
}
