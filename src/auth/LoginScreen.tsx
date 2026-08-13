import { useState, type FormEvent } from 'react'
import { useAuth } from './useAuth'
import { PendingWritesError } from './auth-context'
import { pendingCount } from '../features/capture/outbox'
import { ForgotPasswordScreen } from './ForgotPasswordScreen'
import { AuthShell, FieldLabel, PasswordField } from './AuthShell'

type Mode = 'signin' | 'signup' | 'forgot'

/** Longueur minimale du mot de passe, alignée sur la politique Supabase. */
const MIN_PASSWORD_LENGTH = 10

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
    return `Le mot de passe est trop court (${MIN_PASSWORD_LENGTH} caractères minimum).`
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
  const { signIn, signUp, localAccount, forgetLocalData } = useAuth()
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
  // Étape de confirmation du forçage de purge (ADR 0012) : deux gestes distincts,
  // jamais un OK réflexe, la perte est nommée avant d'être possible.
  const [confirmPurge, setConfirmPurge] = useState(false)

  if (mode === 'forgot') {
    return <ForgotPasswordScreen onBack={() => setMode('signin')} />
  }

  // Des écritures locales attendent encore leur synchro (révocation, session
  // retirée…) : on l'affiche AVANT le formulaire — se reconnecter avec le même
  // compte les remontera, un autre compte exige le forçage (ADR 0012).
  const pendingWrites = localAccount ? pendingCount() : 0

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
        setInfo('Compte créé. Vérifie ta boîte de réception pour confirmer.')
      } else {
        await signIn(email, password)
      }
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
      title={isSignup ? 'Crée ton compte.' : 'Bon retour.'}
      subtitle="Capture en salle. Progresse au calme."
    >
      {pendingWrites > 0 && (
        <div className="surface-card mb-6 rounded-[14px] px-4 py-3.5 text-left">
          <p className="text-sm text-ink">
            {pendingWrites} saisie{pendingWrites > 1 ? 's' : ''} de{' '}
            <span className="font-medium">{localAccount?.email ?? 'ton compte'}</span> attend
            {pendingWrites > 1 ? 'ent' : ''} encore la synchronisation. Connecte-toi avec ce
            compte pour les envoyer.
          </p>
          {confirmPurge ? (
            <div className="mt-3 flex flex-col gap-2">
              <p className="text-xs text-warn">
                Changer de compte efface définitivement ces saisies de l'appareil.
              </p>
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setConfirmPurge(false)}
                  className="btn btn-secondary h-9 rounded-lg px-3 text-sm"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={() => {
                    forgetLocalData()
                    setConfirmPurge(false)
                    setError(null)
                  }}
                  className="btn btn-ghost h-9 rounded-lg px-3 text-sm font-medium text-warn"
                >
                  Purger et changer de compte
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmPurge(true)}
              className="mt-2 rounded text-xs font-medium text-ink-muted transition active:text-ink"
            >
              Changer de compte…
            </button>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-[18px]" noValidate>
        <div>
          <FieldLabel htmlFor="email">E-mail</FieldLabel>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="field h-[54px] w-full rounded-[14px] px-4 text-base"
            placeholder="toi@exemple.com"
          />
        </div>

        <div>
          <FieldLabel htmlFor="password">Mot de passe</FieldLabel>
          <PasswordField
            id="password"
            value={password}
            onChange={setPassword}
            autoComplete={isSignup ? 'new-password' : 'current-password'}
            minLength={isSignup ? MIN_PASSWORD_LENGTH : undefined}
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
          disabled={submitting || !email || !password}
          className="btn btn-primary h-14 w-full rounded-2xl text-[17px]"
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

      {!isSignup && (
        <button
          type="button"
          onClick={() => setMode('forgot')}
          className="mt-5 block w-full rounded text-center text-sm font-medium text-accent-ink transition active:text-accent"
        >
          Mot de passe oublié&#8239;?
        </button>
      )}

      <p className="mt-6 text-center text-sm text-ink-muted">
        {isSignup ? 'Déjà un compte ?' : 'Pas encore de compte ?'}{' '}
        <button
          type="button"
          onClick={() => {
            setMode(isSignup ? 'signin' : 'signup')
            setError(null)
            setInfo(null)
          }}
          className="rounded font-medium text-accent-ink transition active:text-accent"
        >
          {isSignup ? 'Se connecter' : 'Créer un compte'}
        </button>
      </p>
    </AuthShell>
  )
}
