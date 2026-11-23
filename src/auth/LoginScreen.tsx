import { useState, type FormEvent } from 'react'
import { useAuth } from './useAuth'
import { PendingWritesError } from './auth-context'
import { heldCounts } from '../features/capture/outbox'
import { heldWritesNotice } from '../features/capture/sync-label'
import { ForgotPasswordScreen } from './ForgotPasswordScreen'
import { AuthShell, FieldLabel, PasswordField } from './AuthShell'
import { arrivalHash } from '../lib/supabase'
import { arrivalFromHash } from './arrival-link'

/** Le lien d'e-mail suivi pour arriver ici a-t-il été refusé (expiré, déjà utilisé) ? */
const linkFailed = arrivalFromHash(arrivalHash).failed

type Mode = 'signin' | 'forgot'

/** Traduit les messages d'erreur Supabase courants en français lisible. */
function frenchError(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('invalid login credentials')) {
    return 'Email ou mot de passe incorrect.'
  }
  if (m.includes('email not confirmed')) {
    return 'Email non confirmé. Vérifie ta boîte de réception.'
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
      title="Bon retour."
      subtitle="Capture en salle. Progresse au calme."
    >
      {pendingNotice && (
        <div className="surface-card mb-6 rounded-[14px] px-4 py-3.5 text-left">
          <p className="text-sm text-ink">{pendingNotice}</p>
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
            autoComplete="current-password"
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
        {linkFailed && !error && (
          <p className="text-sm text-ink-muted">
            Ce lien a expiré ou a déjà servi. Demande un nouveau lien avec « Mot de passe
            oublié », ou une nouvelle invitation.
          </p>
        )}

        <button
          type="submit"
          disabled={submitting || !email || !password}
          className="btn btn-primary h-14 w-full rounded-2xl text-[17px]"
        >
          {submitting ? 'Connexion…' : 'Se connecter'}
        </button>
      </form>

      {/* Pas de lien « Créer un compte » : l'inscription est fermée, les comptes
          viennent par invitation (le lien d'e-mail mène à l'écran de mot de passe). */}
      <button
        type="button"
        onClick={() => setMode('forgot')}
        className="mt-5 block w-full rounded text-center text-sm font-medium text-accent-ink transition active:text-accent"
      >
        Mot de passe oublié&#8239;?
      </button>
    </AuthShell>
  )
}
