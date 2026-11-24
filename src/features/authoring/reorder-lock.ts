// Monter et Descendre, en mode « Réordonner » d'une routine : quand répondent-ils ?
//
// La RPC `reorder_seances` réécrit TOUTES les positions qu'on lui envoie, à
// partir de l'ordre affiché. Affiché depuis une copie locale pas encore
// revalidée, cet ordre peut dater d'avant un déplacement fait sur un autre
// appareil : un geste l'aurait écrasé. Tant que la revalidation n'est pas
// arrivée, les deux boutons attendent, et l'écran dit pourquoi. Pur, testé.
//
// LIMITE : ce verrou réduit la fenêtre sans la fermer (un autre appareil peut
// réordonner entre la revalidation et le geste). La fermer demande une révision
// côté base, que la RPC vérifierait.

export interface ReorderLock {
  /** Les deux boutons de chaque ligne sont inactifs. */
  disabled: boolean;
  /** La phrase sous la liste, `null` quand l'ordre est revalidé. */
  note: string | null;
  /** « Réessayer » à côté de la phrase. */
  retry: boolean;
}

export function reorderLock({ moving, verified, online, late }: { moving: boolean; verified: boolean; online: boolean; late: boolean }): ReorderLock {
  if (verified) return { disabled: moving, note: null, retry: false };
  // En ligne, sans revalidation arrivée dans le délai (`late`, relecture en
  // échec ou trop lente) : « Réessayer » relance la vérification sur place.
  return { disabled: true, note: online ? 'Ordre en cours de vérification.' : 'Ordre à vérifier avec le réseau.', retry: online && late };
}
