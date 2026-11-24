import { useState, type FormEvent } from 'react'
import { useAuth } from './useAuth'
import { PendingWritesError } from './auth-context'
import { heldCounts } from '../features/capture/outbox'
import { heldWritesNotice } from '../features/capture/sync-label'
import { ForgotPasswordScreen } from './ForgotPasswordScreen'
import { AuthShell } from './AuthShell'
import { FieldError, Notice, PasswordField, PrimaryButton, SecondaryButton, TextField, TextLink } from '../ui'
import { arrivalHash } from '../lib/supabase'
import { arrivalFromHash } from './arrival-link'

/** Le lien d'e-mail suivi pour arriver ici a-t-il été refusé (expiré, déjà utilisé) ? */
const linkFailed = arrivalFromHash(arrivalHash).failed

type Mode = 'signin' | 'forgot'

/** Traduit les messages d'erreur Supabase courants en français lisible. */
function frenchError(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('invalid login credentials')) {
    return 'E-mail ou mot de passe incorrect.'
  }
  if (m.includes('email not confirmed')) {
    return 'E-mail non confirmé. Vérifie ta boîte de réception.'
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
  const { signIn, localAccount, forgetLocalData } = useAuth()
  // TOUS les hooks AVANT le moindre return conditionnel (règle des Hooks). Avant,
  // le `if (mode === 'forgot') return …` précédait ces useState : passer en mode
  // « mot de passe oublié » rendait MOINS de hooks que le render précédent et
  // faisait planter React (« rendered fewer hooks than expected »).
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // Étape de confirmation du forçage de purge (ADR 0012) : deux gestes distincts,
  // jamais un OK réflexe, la perte est nommée avant d'être possible.
  const [confirmPurge, setConfirmPurge] = useState(false)

  if (mode === 'forgot') {
    return <ForgotPasswordScreen onBack={() => setMode('signin')} />
  }

  // Des écritures locales attendent encore leur synchro (révocation, session
  // retirée…) : on l'affiche AVANT le formulaire — se reconnecter avec le même
  // compte les remontera, un autre compte exige le forçage (ADR 0012).
  // Ops en quarantaine comprises : la garde d'un autre compte les compte aussi,
  // et la purge proposée ici est leur seule sortie.
  // Elles sont dites PAR COMPTE (ADR 0019) : celles du compte reconnu, et celles
  // d'un autre compte passé sur l'appareil, que sa Déconnexion n'a pas jetées.
  const counts = heldCounts()
  const pendingNotice = heldWritesNotice({
    own: counts.own,
    foreign: counts.foreign,
    email: localAccount?.email ?? null,
  })

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await signIn(email, password)
    } catch (err) {
      if (err instanceof PendingWritesError) {
        // Autre compte par-dessus des saisies non synchronisées : refus (ADR 0012).
        setError(
          `Des saisies de ${localAccount?.email ?? 'un autre compte'} attendent encore leur synchronisation. Connecte-toi avec ce compte pour les envoyer, ou purge-les d'abord ci-dessus.`,
        )
      } else {
        setError(frenchError(err instanceof Error ? err.message : String(err)))
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthShell
      title="Connexion"
      meta="Une fois par appareil. Ensuite l’app s’ouvre même sans réseau."
      onSubmit={handleSubmit}
      bottom={
        <PrimaryButton type="submit" disabled={submitting || !email || !password}>
          {submitting ? 'Connexion…' : 'Se connecter'}
        </PrimaryButton>
      }
    >
      {pendingNotice && (
        <div className="px-5 pb-2">
          {confirmPurge ? (
            <Notice
              role="alert"
              title="Effacer ces saisies&#8239;?"
              actions={
                <>
                  <SecondaryButton onClick={() => setConfirmPurge(false)}>Garder</SecondaryButton>
                  <TextLink
                    tone="muted"
                    onClick={() => {
                      forgetLocalData()
                      setConfirmPurge(false)
                      setError(null)
                    }}
                  >
                    Purger et changer de compte
                  </TextLink>
                </>
              }
            >
              Changer de compte efface définitivement ces saisies de l’appareil.
            </Notice>
          ) : (
            <Notice
              actions={
                <SecondaryButton onClick={() => setConfirmPurge(true)}>
                  Changer de compte
                </SecondaryButton>
              }
            >
              <span className="text-ink">{pendingNotice}</span>
            </Notice>
          )}
        </div>
      )}

      <TextField
        id="email"
        label="E-mail"
        type="email"
        inputMode="email"
        autoComplete="email"
        required
        value={email}
        onChange={setEmail}
        placeholder="toi@exemple.com"
        enterKeyHint="next"
        className="px-5 pt-4"
      />
      <PasswordField
        id="password"
        label="Mot de passe"
        autoComplete="current-password"
        required
        value={password}
        onChange={setPassword}
        enterKeyHint="go"
        className="px-5 pt-4"
      />

      {error && (
        <div className="px-5">
          <FieldError className="mt-4">{error}</FieldError>
        </div>
      )}
      {linkFailed && !error && (
        <p className="px-5 pt-4 text-[15px] leading-[1.45] text-muted">
          Ce lien a expiré ou a déjà servi. Demande un nouveau lien avec « Mot de passe
          oublié », ou une nouvelle invitation.
        </p>
      )}

      {/* Pas de lien « Créer un compte » : l'inscription est fermée, les comptes
          viennent par invitation (le lien d'e-mail mène à l'écran de mot de passe). */}
      <div className="px-5 pt-3">
        <TextLink tone="muted" onClick={() => setMode('forgot')}>
          Mot de passe oublié&#8239;?
        </TextLink>
      </div>
    </AuthShell>
  )
}
