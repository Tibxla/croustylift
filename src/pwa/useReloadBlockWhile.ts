// Blocage de rechargement tenu par un BROUILLON : un écran qui porte une saisie
// non enregistrée, que seule la mémoire tient, interdit tout rechargement
// automatique tant qu'elle existe (`reloadAllowed`, update.ts).
//
// Le blocage suit `active` (le drapeau « modifié » de l'écran) :
//   - posé quand `active` passe à vrai ;
//   - levé quand il repasse à faux (enregistrement réussi, saisie remise à
//     l'identique) ;
//   - levé au démontage de l'écran, quelle qu'en soit la cause ;
//   - levé tout de suite par la fonction rendue, pour un ABANDON confirmé : la
//     navigation qui suit (changement d'onglet) demande le rechargement dans le
//     même tour synchrone, avant que React n'ait démonté l'écran. Sans cette
//     levée immédiate, le rechargement que l'utilisateur vient d'accepter serait
//     refusé par son propre brouillon.
// Toutes ces levées passent par le même porteur idempotent (`holdReloadBlock`) :
// aucune ne peut compter double, aucune ne peut manquer.

import { useCallback, useEffect, useRef } from 'react'
import { holdReloadBlock } from './blockers'

/**
 * Bloque les rechargements sous `reason` tant que `active` est vrai et que le
 * composant est monté. Rend la levée immédiate, à appeler à l'abandon confirmé.
 */
export function useReloadBlockWhile(reason: string, active: boolean): () => void {
  const releaseRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    if (!active) return
    const release = holdReloadBlock(reason)
    releaseRef.current = release
    return () => {
      release()
      if (releaseRef.current === release) releaseRef.current = null
    }
  }, [reason, active])
  return useCallback(() => releaseRef.current?.(), [])
}
