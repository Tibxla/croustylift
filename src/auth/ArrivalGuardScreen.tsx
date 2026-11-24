import { useState } from 'react'
import { AuthShell } from './AuthShell'
import { Notice, PrimaryButton, SecondaryButton, TextLink } from '../ui'
import { arrivalGuardLabel } from '../features/capture/sync-label'

/**
 * Écran de la GARDE D'ARRIVÉE (ADR 0019) : un lien d'e-mail (récupération,
 * invitation) ou une session restaurée ouvre un autre compte que celui dont
 * l'appareil retient encore des saisies. Rien n'entre tant que l'utilisateur
 * n'a pas tranché : renoncer (le compte précédent se reconnecte et envoie ses
 * saisies) ou forcer (elles sont purgées). Le forçage tient en deux gestes
 * distincts, jamais un OK réflexe, comme sur l'écran de connexion (ADR 0012).
 */
export function ArrivalGuardScreen({
  heldEmail,
  arrivingEmail,
  held,
  onForce,
  onCancel,
}: {
  /** Le compte dont les saisies attendent encore sur l'appareil. */
  heldEmail: string | null
  /** Le compte que le lien vient d'ouvrir. */
  arrivingEmail: string | null
  held: number
  onForce: () => void
  onCancel: () => void
}) {
  const [confirm, setConfirm] = useState(false)
  return (
    <AuthShell
      title="Des saisies attendent"
      bottom={
        confirm ? undefined : (
          <PrimaryButton onClick={onCancel}>Revenir à la connexion</PrimaryButton>
        )
      }
    >
      <p className="px-5 text-[16px] leading-[1.5] text-ink">
        {arrivalGuardLabel({ held, heldEmail, arrivingEmail })}
      </p>
      <div className="px-5 pt-4">
        {confirm ? (
          <Notice
            role="alert"
            title="Effacer ces saisies&#8239;?"
            actions={
              <>
                <SecondaryButton onClick={() => setConfirm(false)}>Garder</SecondaryButton>
                <TextLink tone="muted" onClick={onForce}>
                  Purger et continuer
                </TextLink>
              </>
            }
          >
            Continuer efface définitivement ces saisies de l’appareil.
          </Notice>
        ) : (
          <TextLink tone="muted" onClick={() => setConfirm(true)}>
            Continuer avec ce compte…
          </TextLink>
        )}
      </div>
    </AuthShell>
  )
}
