// Masquage des courbes de séance sur la carte d'un exo (grilling du 2026-09-13).
//
// La légende sert de contrôle : toucher une entrée masque ou affiche sa courbe.
// La séance en accent (readout héros, pente, « Séries 2+ ») est la plus récente
// des courbes AFFICHÉES : ce qui est chiffré est toujours ce qu'on voit. On garde
// la liste des courbes MASQUÉES, pas celle des affichées, pour qu'une séance
// neuve (nouvelle routine) apparaisse d'elle-même. Pur, sans stockage.

/** Clé d'une courbe : l'id de la séance, ou une clé stable pour « Hors séance ». */
export function curveKey(seanceId: string | null): string {
  return seanceId ?? 'hors-seance';
}

/**
 * Les courbes affichées, dans l'ordre reçu. Si le masquage retirait tout (une
 * préférence périmée, par exemple), tout revient : une carte n'est jamais vide.
 */
export function visibleCurves<T extends { seanceId: string | null }>(
  curves: readonly T[],
  hidden: ReadonlySet<string>,
): T[] {
  const shown = curves.filter((c) => !hidden.has(curveKey(c.seanceId)));
  return shown.length > 0 ? shown : [...curves];
}

/**
 * Bascule le masquage de `key`. Refuse de masquer la dernière courbe visible
 * parmi `allKeys` (les courbes de la carte) : les clés périmées ne comptent pas.
 * Rend un nouvel ensemble, sans muter l'entrée.
 */
export function toggleHidden(
  hidden: ReadonlySet<string>,
  key: string,
  allKeys: readonly string[],
): Set<string> {
  const next = new Set(hidden);
  if (next.has(key)) {
    next.delete(key);
    return next;
  }
  const visibleCount = allKeys.filter((k) => !next.has(k)).length;
  if (visibleCount <= 1) return next;
  next.add(key);
  return next;
}
