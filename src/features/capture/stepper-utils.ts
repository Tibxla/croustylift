// Fonction pure de parse/clamp de la SAISIE TAPÉE au pavé numérique du Stepper.
// Séparée du composant pour rester testable sans DOM.

/**
 * Plafonds de saisie, alignés sur les colonnes de `performed_sets` : `weight_kg`
 * est un `numeric(6,2)` (9999,99 au plus), `reps` et `rir` des entiers. Au-delà
 * la base refuse la ligne (22003) et la série part en quarantaine : la borne se
 * pose donc à la saisie. Les plafonds des compteurs sont larges mais finis.
 */
export const WEIGHT_MAX_KG = 9999.99;
export const REPS_MAX = 999;
export const RIR_MAX = 99;

/**
 * Ramène une série dans les bornes que la base accepte (cf. plafonds ci-dessus).
 * Dernier filet avant l'enfilement : une valeur hors bornes venue d'un état
 * restauré ou d'un composant sans `max` ne part pas en file telle quelle.
 */
export function boundSetValues<T extends { weightKg: number; reps: number; rir: number }>(
  set: T,
): T {
  const within = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
  return {
    ...set,
    weightKg: within(set.weightKg, 0, WEIGHT_MAX_KG),
    reps: within(Math.round(set.reps), 1, REPS_MAX),
    rir: within(Math.round(set.rir), 0, RIR_MAX),
  };
}

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
