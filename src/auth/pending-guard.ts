// Garde « écritures en attente d'un autre compte » (ADR 0012) de la Connexion.
// L'inscription est fermée (comptes sur invitation) : l'écran « Créer un
// compte », qui contournait cette garde, n'existe plus.
//
// Des saisies non synchronisées appartiennent au compte que l'appareil reconnaît
// (marqueur local-account). Un AUTRE compte ne s'installe pas par-dessus : seul
// le forçage explicite peut les jeter.
import { loadLocalAccount } from '../lib/local-account';
import { heldCounts } from '../features/capture/outbox';

/**
 * Nombre d'écritures retenues sur l'appareil (file et quarantaine) qui interdisent à `email` de s'installer sur
 * l'appareil : celles d'un compte reconnu dont l'adresse diffère. `0` = rien ne
 * s'y oppose (aucun compte reconnu, file vide, ou même compte).
 */
export function foreignPendingWrites(email: string): number {
  const account = loadLocalAccount();
  if (!account) return 0;
  // Les écritures du compte RECONNU seulement : celles d'un tiers encore sur
  // l'appareil ne s'opposent à personne (elles ne partent que sous leur compte).
  const pending = heldCounts().own;
  if (pending === 0) return 0;
  return (account.email ?? '').toLowerCase() === email.trim().toLowerCase() ? 0 : pending;
}
