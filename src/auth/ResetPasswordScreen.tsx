import { useState, type FormEvent } from 'react'
import { useAuth } from './useAuth'
import { AuthShell } from './AuthShell'
import { FieldError, PasswordField, PrimaryButton } from '../ui'
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
      <AuthShell title="Mot de passe enregistré" meta="Ta session est ouverte.">
        <span className="sr-only">Mot de passe enregistré.</span>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="Ton mot de passe"
      meta={`Choisis un mot de passe d’au moins ${MIN_PASSWORD_LENGTH} caractères.`}
      onSubmit={handleSubmit}
      bottom={
        <PrimaryButton type="submit" disabled={submitting || !password || !confirm}>
          {submitting ? 'Enregistrement…' : 'Enregistrer le mot de passe'}
        </PrimaryButton>
      }
    >
      <PasswordField
        id="new-password"
        label="Mot de passe"
        autoComplete="new-password"
        required
        value={password}
        onChange={setPassword}
        enterKeyHint="next"
        className="px-5"
      />
      <PasswordField
        id="confirm-password"
        label="Confirmer le mot de passe"
        autoComplete="new-password"
        required
        value={confirm}
        onChange={setConfirm}
        enterKeyHint="go"
        className="px-5 pt-4"
      />
      {error && (
        <div className="px-5">
          <FieldError className="mt-4">{error}</FieldError>
        </div>
      )}
    </AuthShell>
  )
}
