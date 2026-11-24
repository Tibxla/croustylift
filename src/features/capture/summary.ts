// Chrono de la séance, logique pure extraite de CaptureScreen pour être testable
// en isolation (pas de DOM, pas de React). Le récap de fin de séance est
// `buildSessionRecap` (session-recap.ts).

/**
 * Durée maximale d'une séance, en minutes (10 h) : le même plafond que l'éditeur
 * de séance passée. Au-delà, le chrono n'a pas mesuré une séance.
 */
export const SESSION_DURATION_MAX_MIN = 600;

/**
 * Durée écoulée en minutes (arrondi) depuis le lancement de la séance, ou `null`
 * si elle n'est pas MESURABLE : `startedAt` absent ou invalide, ou durée au-delà
 * du plafond. Ce second cas est celui d'une séance oubliée sans clôture puis
 * terminée le lendemain : le chrono affichait de l'ordre de 1 400 min, valeur
 * jamais mesurée qui écrasait l'échelle du graphe de durée. On n'envoie ni
 * n'affiche alors de durée, plutôt qu'une valeur inventée (elle reste
 * saisissable depuis le journal).
 */
export function elapsedMinutesSince(startedAt: number | undefined): number | null {
  if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) return null;
  // Clampé à 0 : un `startedAt` dans le futur (horloge qui recule, cache restauré
  // d'un autre appareil) donnerait une durée NÉGATIVE, que la base rejette — et
  // une op de clôture rejetée empoisonne l'outbox (incident 2026-07-30 : la
  // contrainte refusait aussi 0, cf. migration 0012). 0 = « moins de 30 s »,
  // mesure honnête d'un faux départ.
  const minutes = Math.max(0, Math.round((Date.now() - startedAt) / 60000));
  return minutes > SESSION_DURATION_MAX_MIN ? null : minutes;
}
