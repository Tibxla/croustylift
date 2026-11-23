// Blocages de rechargement : ce que le reste de l'app déclare pour interdire tout
// rechargement automatique (`reloadAllowed`, update.ts). Sans DOM ni service
// worker, donc testable ; `register.ts` lit `activeBlockers()` à chaque décision.
//
// Un compteur par raison : deux écritures simultanées sous la même raison, ou
// deux appels imbriqués, ne se lèvent pas l'une l'autre.

import { arrivedOnRecoveryLink, RECOVERY_LINK_BLOCK } from './recovery'

const counts = new Map<string, number>()
// Arrivée par un lien de récupération de mot de passe : bloqué d'emblée, avant
// que quoi que ce soit d'autre ne s'exécute (voir recovery.ts).
if (arrivedOnRecoveryLink) counts.set(RECOVERY_LINK_BLOCK, 1)

/**
 * Interdit les rechargements automatiques tant que `reason` n'est pas levée par
 * un `unblockReloads(reason)` par appel. Pour un état que seule la mémoire tient
 * le temps d'un écran : brouillon non enregistré, flux à usage unique.
 */
export function blockReloads(reason: string): void {
  counts.set(reason, (counts.get(reason) ?? 0) + 1)
}

/** Lève UN blocage posé sous `reason`. Sans effet s'il n'y en a pas. */
export function unblockReloads(reason: string): void {
  const count = counts.get(reason) ?? 0
  if (count <= 1) counts.delete(reason)
  else counts.set(reason, count - 1)
}

/**
 * Exécute une écriture en interdisant tout rechargement automatique jusqu'à sa
 * fin. À poser autour de toute sauvegarde faite de plusieurs requêtes : une page
 * déchargée entre deux d'entre elles laisserait une écriture à moitié faite.
 *
 * Le blocage est posé de façon SYNCHRONE, avant d'appeler `fn`, et levé dans un
 * `finally`, que `fn` réussisse, échoue ou lève en synchrone. Il ne dépend
 * d'aucun composant : l'écran peut être démonté pendant l'écriture (changement
 * d'onglet), le blocage tient jusqu'au bout.
 */
export async function withReloadBlocked<T>(reason: string, fn: () => Promise<T>): Promise<T> {
  blockReloads(reason)
  try {
    return await fn()
  } finally {
    unblockReloads(reason)
  }
}

/** Raisons actuellement posées (une entrée par raison, quel que soit son compte). */
export function activeBlockers(): string[] {
  return [...counts.keys()]
}
