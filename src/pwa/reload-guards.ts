// Les raisons qui interdisent de recharger la page, relevées à l'instant de la
// décision (`currentGuards`, register.ts). Sans DOM ni service worker, donc
// testable.
//
// Deux sources :
//   - ce que le reste de l'app DÉCLARE (`blockReloads`, blockers.ts) : brouillon
//     non enregistré, écriture directe en cours, récupération de mot de passe ;
//   - ce que la file d'écritures de la Capture tient en MÉMOIRE seulement. Quand
//     le stockage de l'appareil est plein, les ops enfilées ne sont écrites
//     nulle part (repli mémoire, features/capture/outbox.ts). La séance close,
//     plus rien ne signalait une séance en cours : avec une mise à jour en
//     attente, le changement d'onglet rechargeait la page et détruisait les
//     séries et la clôture pas encore envoyées. Ce n'est pas un blocage posé
//     puis levé à la main : il est lu dans la file, donc vrai exactement tant
//     que ces ops existent, et faux dès qu'elles sont écrites sur l'appareil ou
//     acquittées par la base.

import { hasUnpersistedOps } from '../features/capture/outbox'
import { activeBlockers } from './blockers'

/** Des écritures en attente ne tiennent qu'en mémoire (stockage de l'appareil plein). */
export const UNPERSISTED_WRITES_BLOCK = 'ecritures-non-persistees'

/** Toutes les raisons qui interdisent de recharger maintenant. */
export function currentBlockers(): string[] {
  const declared = activeBlockers()
  return hasUnpersistedOps() ? [...declared, UNPERSISTED_WRITES_BLOCK] : declared
}
