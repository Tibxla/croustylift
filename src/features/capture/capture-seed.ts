// Préremplissage du brouillon de la série courante en Capture (issue #58).
// Pur, séparé du composant pour rester testable sans DOM.
//
// UNILATÉRAL (issue #46/#63) : chaque série logique porte DEUX lignes G/D au même
// `order`. Le repère doit donc viser la série LOGIQUE courante (et non le simple
// `loggedSets.length + 1` qui double les rangs) ET le bon côté — sans quoi il
// piochait la mauvaise ligne de référence (mauvais order et mauvais côté). C'est
// le rôle du paramètre `side` : présent => unilatéral, absent => bilatéral
// (comportement strictement inchangé). Voir `seedDraft`.
//
// Règles (cf. issue #58) :
//   - POIDS : dès la 2ᵉ série, on reprend le poids de la DERNIÈRE série loggée
//     (on enchaîne souvent à charge identique ; ne pas faire re-saisir) — du MÊME
//     côté en unilatéral, G et D pouvant porter des charges distinctes. 1ʳᵉ
//     série : report de la référence (« dernière fois ») à la position courante,
//     ou de sa dernière série connue, sinon un point de départ neutre.
//   - REPS : toujours la borne BASSE de la fourchette prescrite (`reps.min`),
//     ou la valeur fixe (`min === max`). C'est l'objectif minimal à viser, plus
//     prévisible qu'un report des reps réellement faites.
//   - RIR : report de la référence à la position courante si elle la couvre,
//     sinon de la dernière série loggée, sinon un point de départ neutre
//     (comportement préservé : l'issue ne touche pas au RIR).

import { currentSetOrder } from '../../domain/unilateral';
import type { Prescription, PerformedSet, Side } from '../../domain/types';

/** Point de départ neutre quand ni référence ni série loggée n'éclaire le défaut. */
const NEUTRAL = { weightKg: 20, reps: 10, rir: 1 } as const;

export interface SeedInput {
  prescription: Prescription;
  /** La « dernière fois » par position (et par côté en unilatéral), ou `null` si premier passage. */
  reference: PerformedSet[] | null;
  /**
   * Les séries déjà loggées aujourd'hui pour cet exo. En bilatéral, une ligne par
   * série (ordre = index + 1) ; en unilatéral, deux lignes G/D par série au même
   * `order` (cf. `side`), d'où le besoin de la série logique courante.
   */
  loggedSets: PerformedSet[];
  /**
   * Le côté visé pour la PROCHAINE saisie (issue #63), ou `undefined` pour un exo
   * BILATÉRAL. En unilatéral, il aligne le repère sur la bonne ligne G/D : la
   * série logique courante (`currentSetOrder`, pas `loggedSets.length + 1` qui
   * double les rangs) et le report « dernière loggée du MÊME côté ».
   */
  side?: Side;
}

export interface SeedDraft {
  weightKg: number;
  reps: number;
  rir: number;
}

/**
 * La série de référence à la position `order`, filtrée par `side` en unilatéral
 * (chaque rang porte deux lignes G/D). En bilatéral (`side` absent), la première
 * série à cet `order`. `null` si absente.
 */
function refAt(
  reference: PerformedSet[] | null,
  order: number,
  side: Side | undefined,
): PerformedSet | null {
  return (
    reference?.find((s) => s.order === order && (side === undefined || s.side === side)) ?? null
  );
}

/**
 * La dernière série loggée à reporter pour le report « à charge identique ». En
 * unilatéral, c'est la dernière saisie du MÊME côté (G et D peuvent porter des
 * charges différentes — côté faible) ; en bilatéral, la dernière tout court.
 * `null` si aucune (1ʳᵉ série, ou 1ʳᵉ saisie de ce côté).
 */
function lastLoggedFor(loggedSets: PerformedSet[], side: Side | undefined): PerformedSet | null {
  for (let i = loggedSets.length - 1; i >= 0; i--) {
    const s = loggedSets[i];
    if (side === undefined || s.side === side) return s;
  }
  return null;
}

/**
 * La dernière série de référence connue, filtrée par `side` en unilatéral (la
 * dernière ligne du même côté), pour le repli quand la position courante dépasse
 * la référence. `null` si la référence est absente ou vide pour ce côté.
 */
function lastRefFor(reference: PerformedSet[] | null, side: Side | undefined): PerformedSet | null {
  if (!reference || reference.length === 0) return null;
  for (let i = reference.length - 1; i >= 0; i--) {
    const s = reference[i];
    if (side === undefined || s.side === side) return s;
  }
  return null;
}

/**
 * Valeurs pré-remplies pour la PROCHAINE série à saisir. La position visée est la
 * série LOGIQUE courante (`currentSetOrder` en unilatéral, où chaque rang porte
 * deux lignes G/D ; `loggedSets.length + 1` en bilatéral, une ligne par série),
 * et le repère est filtré par `side` quand l'exo est unilatéral — sans quoi le
 * report piocherait la mauvaise ligne (mauvais order ET mauvais côté).
 */
export function seedDraft({ prescription, reference, loggedSets, side }: SeedInput): SeedDraft {
  const last = lastLoggedFor(loggedSets, side);
  const nextOrder =
    side === undefined ? loggedSets.length + 1 : currentSetOrder(loggedSets);
  const atPosition = refAt(reference, nextOrder, side);
  const lastRef = lastRefFor(reference, side);

  // POIDS : dès la 2ᵉ série (du même côté en unilatéral), report de la dernière
  // loggée. Sinon référence (position courante, à défaut dernière connue), sinon neutre.
  const weightKg = last
    ? last.weightKg
    : atPosition?.weightKg ?? lastRef?.weightKg ?? NEUTRAL.weightKg;

  // REPS : toujours la borne basse prescrite (valeur fixe si min === max).
  const reps = prescription.reps.min;

  // RIR : référence à la position courante, sinon dernière loggée, sinon neutre.
  const rir = atPosition?.rir ?? last?.rir ?? lastRef?.rir ?? NEUTRAL.rir;

  return { weightKg, reps, rir };
}
