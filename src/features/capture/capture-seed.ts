// Préremplissage du brouillon de la série courante en Capture (issue #58).
// Pur, séparé du composant pour rester testable sans DOM.
//
// Règles (cf. issue #58) :
//   - POIDS : dès la 2ᵉ série, on reprend le poids de la DERNIÈRE série loggée
//     (on enchaîne souvent à charge identique ; ne pas faire re-saisir). 1ʳᵉ
//     série : report de la référence (« dernière fois ») à la position courante,
//     ou de sa dernière série connue, sinon un point de départ neutre.
//   - REPS : toujours la borne BASSE de la fourchette prescrite (`reps.min`),
//     ou la valeur fixe (`min === max`). C'est l'objectif minimal à viser, plus
//     prévisible qu'un report des reps réellement faites.
//   - RIR : report de la référence à la position courante si elle la couvre,
//     sinon de la dernière série loggée, sinon un point de départ neutre
//     (comportement préservé : l'issue ne touche pas au RIR).

import type { Prescription, PerformedSet } from '../../domain/types';

/** Point de départ neutre quand ni référence ni série loggée n'éclaire le défaut. */
const NEUTRAL = { weightKg: 20, reps: 10, rir: 1 } as const;

export interface SeedInput {
  prescription: Prescription;
  /** La « dernière fois » par position, ou `null` si premier passage. */
  reference: PerformedSet[] | null;
  /** Les séries déjà loggées aujourd'hui pour cet exo (ordre = index + 1). */
  loggedSets: PerformedSet[];
}

export interface SeedDraft {
  weightKg: number;
  reps: number;
  rir: number;
}

/** La série de référence à la position `order`, ou `null` si absente. */
function refAt(reference: PerformedSet[] | null, order: number): PerformedSet | null {
  return reference?.find((s) => s.order === order) ?? null;
}

/**
 * Valeurs pré-remplies pour la PROCHAINE série à saisir. La position visée est
 * `loggedSets.length + 1` (1-indexée), de sorte que les G/D unilatéraux comptés
 * dans `loggedSets` font simplement avancer le report — la logique reste
 * positionnelle, pas par côté.
 */
export function seedDraft({ prescription, reference, loggedSets }: SeedInput): SeedDraft {
  const last = loggedSets.length > 0 ? loggedSets[loggedSets.length - 1] : null;
  const nextOrder = loggedSets.length + 1;
  const atPosition = refAt(reference, nextOrder);
  const lastRef =
    reference && reference.length > 0 ? reference[reference.length - 1] : null;

  // POIDS : dès la 2ᵉ série, report de la dernière loggée. Sinon référence
  // (position courante, à défaut dernière connue), sinon neutre.
  const weightKg = last
    ? last.weightKg
    : atPosition?.weightKg ?? lastRef?.weightKg ?? NEUTRAL.weightKg;

  // REPS : toujours la borne basse prescrite (valeur fixe si min === max).
  const reps = prescription.reps.min;

  // RIR : référence à la position courante, sinon dernière loggée, sinon neutre.
  const rir = atPosition?.rir ?? last?.rir ?? lastRef?.rir ?? NEUTRAL.rir;

  return { weightKg, reps, rir };
}
