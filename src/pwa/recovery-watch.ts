// Suit le sort d'un lien de récupération de mot de passe pour lever, s'il
// n'aboutit pas, le blocage de rechargement posé à l'arrivée (blockers.ts).
// Décision dans `recoveryLinkOutcome` (recovery.ts, testée) ; ici le câblage au
// client Supabase.

import { supabase } from '../lib/supabase'
import { unblockReloads } from './blockers'
import { arrivedOnRecoveryLink, RECOVERY_LINK_BLOCK, recoveryLinkOutcome } from './recovery'

/**
 * Délai laissé à PASSWORD_RECOVERY après la fin de l'initialisation : le client
 * l'émet dans une tâche différée (`setTimeout(…, 0)` dans `_initialize`), donc
 * juste APRÈS que `initialize()` a rendu la main.
 */
const RECOVERY_EVENT_GRACE_MS = 1500

/**
 * À appeler une fois, au démarrage (main.tsx). Sans effet hors lien de
 * récupération. `onReleased` : appelé quand le blocage est levé faute de flux,
 * pour reposer la question d'un rechargement resté en attente.
 */
export function watchRecoveryLink(onReleased: () => void): void {
  if (!arrivedOnRecoveryLink) return
  let recoverySeen = false
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') recoverySeen = true
  })
  const settle = () => {
    window.setTimeout(() => {
      subscription.unsubscribe()
      // `handover` : App.tsx tient son propre blocage pendant l'écran de nouveau
      // mot de passe et lève celui-ci quand l'écran se referme.
      if (recoveryLinkOutcome({ initialized: true, recoverySeen }) === 'release') {
        unblockReloads(RECOVERY_LINK_BLOCK)
        onReleased()
      }
    }, RECOVERY_EVENT_GRACE_MS)
  }
  // Initialisation réussie ou en erreur : dans les deux cas le lien a été traité.
  supabase.auth.initialize().then(settle, settle)
}
