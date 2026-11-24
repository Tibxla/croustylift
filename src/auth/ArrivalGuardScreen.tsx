import { useState } from 'react'
import { AuthShell } from './AuthShell'
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
    <AuthShell mark={false} footer={false} titleSize={30} title="Des saisies attendent.">
      <p className="text-sm leading-[1.5] text-ink">
        {arrivalGuardLabel({ held, heldEmail, arrivingEmail })}
      </p>
      {confirm ? (
        <div className="mt-6 flex flex-col gap-3">
          <p role="alert" className="text-sm text-warn">
            Continuer efface définitivement ces saisies de l’appareil.
          </p>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setConfirm(false)}
              className="btn btn-secondary h-11 rounded-xl px-4 text-sm"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={onForce}
              className="btn btn-ghost h-11 rounded-xl px-4 text-sm font-medium text-warn"
            >
              Purger et continuer
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="btn btn-primary h-14 w-full rounded-2xl text-base"
          >
            Revenir à la connexion
          </button>
          <button
            type="button"
            onClick={() => setConfirm(true)}
            className="h-11 rounded text-sm font-medium text-ink-muted transition active:text-ink"
          >
            Continuer avec ce compte…
          </button>
        </div>
      )}
    </AuthShell>
  )
}
