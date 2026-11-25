// Les graduations de la règle des poids (ExerciseCapture, SetEditSheet,
// PastSessionEditor), en CRANS du pas réglé. Pur (testé).
//
// La grande graduation, étiquetée, tombe sur un poids rond, choisi dans cet
// ordre :
//   1. le premier multiple de 5 kg que le pas atteint (5 kg pour un pas qui le
//      divise, 10 kg pour un pas de 2) ;
//   2. sinon le premier multiple de 2,5 kg (7,5 kg pour 1,5 ou 0,75), puis du
//      kilo (7 kg pour 1,75, 9 kg pour 2,25) ;
//   3. sinon chaque cran.
// Sous 5 kg de pas, deux étiquettes sont séparées d'au moins deux crans : une
// étiquette à chaque cran se serrait (34 px pour un pas de 3, nombres à trois
// chiffres). Un pas de 3 donne donc 6 kg, un pas de 4 donne 8 kg.
// Chaque candidat doit tenir dans 10 kg : plus loin, l'écran n'affiche que deux
// étiquettes (15 kg pour un pas de 1,5 : 165 et 180 seulement sur 390 px ; la
// règle compte environ 11 px par kilo). L'ancienne règle (`Math.round(5 / pas)`
// crans) mettait les étiquettes sur 4,5 ; 9 ; 13,5 kg pour un pas de 1,5.
//
// La graduation moyenne, sans étiquette, coupe la grande en deux quand la
// moitié tombe sur un cran (2,5 kg pour un pas de 1,25).

/** Les poids ronds candidats, en centièmes de kg, du plus rond au moins rond. */
const ROUND_BASES = [500, 250, 100];
/** L'écart le plus grand entre deux grandes graduations, en centièmes de kg. */
const MAX_MAJOR = 1000;
/** Sous ce pas (centièmes de kg), deux crans au moins entre deux étiquettes. */
const TWO_STEPS_BELOW = 500;

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

export interface WeightGraduations {
  /** Une grande graduation tous les `majorEvery` crans (1 au moins). */
  majorEvery: number;
  /** Une moyenne tous les `midEvery` crans, ou 0 pour aucune. */
  midEvery: number;
}

export function weightGraduations(stepKg: number): WeightGraduations {
  // En centièmes de kg entiers (la précision des poids) : pas de calcul flottant.
  const step = Math.round(stepKg * 100);
  if (!Number.isFinite(step) || step <= 0) return { majorEvery: 1, midEvery: 0 };
  let majorEvery = 1;
  for (const base of ROUND_BASES) {
    const lcm = (step / gcd(step, base)) * base;
    if (lcm <= MAX_MAJOR) {
      majorEvery = lcm / step;
      break;
    }
  }
  if (step < TWO_STEPS_BELOW) majorEvery = Math.max(2, majorEvery);
  return { majorEvery, midEvery: majorEvery % 2 === 0 ? majorEvery / 2 : 0 };
}
