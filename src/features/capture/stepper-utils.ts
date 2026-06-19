// Fonction pure de parse/clamp de la SAISIE TAPÉE au pavé numérique du Stepper.
// Séparée du composant pour rester testable sans DOM.

/**
 * Parse une valeur TAPÉE au pavé numérique et la borne à [min, max].
 *
 * Contrairement au pas des boutons +/− (incrément/décrément fixe, ex. 2,5 kg),
 * la valeur tapée PRÉSERVE sa précision décimale : taper « 13,25 » donne 13,25,
 * on ne la « snappe » JAMAIS au pas d'incrément (issue #58). Le pas ne concerne
 * que les boutons +/−, jamais la saisie directe.
 *
 *   - normalise la virgule décimale FR en point (« 13,25 » comme « 13.25 ») ;
 *   - `allowDecimals=false` (reps, RIR) : arrondit à l'entier le plus proche
 *     (pas de demi-répétition) ; `true` (poids) : précision libre, juste
 *     dégrossie à 3 décimales pour ne pas traîner d'artefact de virgule
 *     flottante (couvre .25 / .5 / .125 sans déformer) ;
 *   - borne le résultat à [min, max] ;
 *   - retourne `fallback` (la valeur courante) si la saisie est vide ou invalide.
 */
export function parseTypedValue(
  raw: string,
  min: number,
  max: number,
  fallback: number,
  allowDecimals: boolean,
): number {
  const normalized = raw.trim().replace(',', '.');
  if (normalized === '') return fallback;

  const parsed = parseFloat(normalized);
  if (!isFinite(parsed)) return fallback;

  // Reps/RIR : entiers. Poids : précision libre, nettoyée du bruit flottant.
  const precise = allowDecimals ? Math.round(parsed * 1000) / 1000 : Math.round(parsed);

  return Math.min(max, Math.max(min, precise));
}
