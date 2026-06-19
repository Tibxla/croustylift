// Fonctions pures de parse/clamp pour la saisie au pavé numérique du Stepper.
// Séparées du composant pour rester testables sans DOM.

/**
 * Arrondit `value` au multiple de `step` le plus proche.
 * Utilise `toFixed` sur le nombre de décimales de `step` pour éviter
 * les erreurs de virgule flottante JS (ex. 0.1 + 0.2 = 0.300...4).
 */
export function roundToStep(value: number, step: number): number {
  // Nombre de décimales de step (ex. step=0.5 → 1, step=2.5 → 1, step=1.25 → 2)
  const decimals = (step.toString().split('.')[1] ?? '').length;
  // Diviser par step, arrondir, remultiplier — sans approximation 1/step
  return parseFloat((Math.round(value / step) * step).toFixed(decimals));
}

/**
 * Parse une chaîne saisie par l'utilisateur (virgule ou point décimal),
 * arrondit au `step` et clamp dans [min, max].
 * Retourne `fallback` si la saisie est invalide ou NaN.
 */
export function parseAndClamp(
  raw: string,
  step: number,
  min: number,
  max: number,
  fallback: number,
): number {
  const normalized = raw.trim().replace(',', '.');
  if (normalized === '') return fallback;

  const parsed = parseFloat(normalized);
  if (!isFinite(parsed)) return fallback;

  const rounded = roundToStep(parsed, step);
  return Math.min(max, Math.max(min, rounded));
}
