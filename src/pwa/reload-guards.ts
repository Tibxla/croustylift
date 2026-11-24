// Les raisons qui interdisent de recharger la page, relevées à l'instant de la
// décision (`currentGuards`, register.ts). Sans DOM ni service worker, donc
// testable.
//
// Trois sources :
//   - ce que le reste de l'app DÉCLARE (`blockReloads`, blockers.ts) : brouillon
//     non enregistré, écriture directe en cours, récupération de mot de passe ;
//   - ce que la file d'écritures de la Capture tient en MÉMOIRE seulement. Quand
//     le stockage de l'appareil est plein, les ops enfilées ne sont écrites
//     nulle part (repli mémoire, features/capture/outbox.ts). La séance close,
//     plus rien ne signalait une séance en cours : avec une mise à jour en
//     attente, le changement d'onglet rechargeait la page et détruisait les
//     séries et la clôture pas encore envoyées ;
//   - l'ÉTAT de la séance en cours quand le stockage l'a refusé
//     (features/capture/state.ts) : un exo ajouté à la séance ne passe pas par
//     la file, il ne vit que là.
// Les deux dernières ne sont pas des blocages posés puis levés à la main : elles
// sont lues à la source, donc vraies exactement tant que ces données n'existent
// qu'en mémoire, et fausses dès qu'elles sont écrites sur l'appareil (ou, pour
// la file, acquittées par la base ; pour l'état, sa séance close). Chaque
// question retente d'abord l'écriture.

import { hasUnpersistedOps, retryPersistQueue } from '../features/capture/outbox'
import { hasUnpersistedCaptureState, retryPersistCaptureState } from '../features/capture/state'
import { activeBlockers } from './blockers'

/** Des écritures en attente ne tiennent qu'en mémoire (stockage de l'appareil plein). */
export const UNPERSISTED_WRITES_BLOCK = 'ecritures-non-persistees'
/** L'état de la séance en cours ne tient qu'en mémoire (stockage de l'appareil plein). */
export const UNPERSISTED_CAPTURE_BLOCK = 'seance-non-persistee'

/**
 * Toutes les raisons qui interdisent de recharger maintenant.
 *
 * Si des écritures ne tiennent qu'en mémoire, leur persistance est RETENTÉE ici,
 * avant de répondre : l'utilisateur a peut-être libéré de la place depuis le
 * refus. Sans cela, « Mettre à jour » restait refusé tant qu'aucune écriture
 * nouvelle ne passait par la file, stockage rétabli ou non. La garde est
 * réévaluée dans le même appel ; elle tient si l'appareil refuse toujours.
 */
export function currentBlockers(): string[] {
  const blockers = activeBlockers()
  if (hasUnpersistedOps()) retryPersistQueue()
  if (hasUnpersistedOps()) blockers.push(UNPERSISTED_WRITES_BLOCK)
  // Même règle pour l'état de la séance en cours : un exo ajouté n'alimente pas
  // la file, il ne vit que dans cet état. Refusé par le stockage, il est retenu
  // en mémoire (features/capture/state.ts) : on retente de l'écrire, et le
  // rechargement attend tant qu'il reste volatile. Levé dès qu'il est écrit ou
  // que sa séance est close ; borné à la veille, pour ne jamais retenir la mise
  // à jour sans fin.
  if (hasUnpersistedCaptureState()) retryPersistCaptureState()
  if (hasUnpersistedCaptureState()) blockers.push(UNPERSISTED_CAPTURE_BLOCK)
  return blockers
}
