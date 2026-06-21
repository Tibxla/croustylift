// Détection des records personnels (issue #34), logique pure extraite de la
// Capture (testée par record-flags.test.ts ; fast-refresh propre côté composant).
// Le record « avance » au fil des séries du jour : on part du record historique,
// chaque série qui le dépasse le remplace, donc une SEULE série par mesure porte
// le marqueur (la première à dépasser), pas toutes celles qui battent l'ancien.
import { estimateE1rm } from '../../domain/e1rm';
import {
  isE1rmRecord,
  isWeightRepsRecord,
  type PersonalRecord,
  type PersonalRecordBySide,
} from '../../domain/pr';
import type { PerformedSet } from '../../domain/types';

/** Le type de record qu'une série bat : e1RM, charge, ou les deux. */
export type RecordKind = 'e1rm' | 'weight-reps' | 'both';

/**
 * Pour chaque série loggée du jour, dit si (et comment) elle bat le record
 * personnel — `null` sinon. Pur, testé séparément.
 */
export function computeRecordFlags(
  sets: PerformedSet[],
  historical: PersonalRecord | null,
): (RecordKind | null)[] {
  // Premier passage (aucun historique) : on ne crie pas « record » sur la toute
  // première série jamais faite. Le record se construit, sans marqueur.
  if (historical === null) {
    let running: PersonalRecord = { bestE1rm: null, bestWeightReps: null };
    return sets.map((s) => {
      running = absorb(running, s);
      return null;
    });
  }

  let running = historical;
  return sets.map((s) => {
    const e1rm = isE1rmRecord(running, s);
    const weightReps = isWeightRepsRecord(running, s);
    running = absorb(running, s);
    if (e1rm && weightReps) return 'both';
    if (e1rm) return 'e1rm';
    if (weightReps) return 'weight-reps';
    return null;
  });
}

/**
 * Comme `computeRecordFlags`, mais PAR CÔTÉ (ADR 0010, exo unilatéral) : chaque
 * ligne G/D se compare au record de SON côté, qui avance indépendamment. Le record
 * courant est tenu séparément pour gauche et droite ; un côté sans historique
 * (`bySide.left/right` vierge) construit le sien sans crier « record » sur sa 1ʳᵉ
 * série jamais faite. L'ordre du tableau renvoyé suit `sets` (G et D mêlés au fil
 * de la saisie).
 */
export function computeRecordFlagsBySide(
  sets: PerformedSet[],
  bySide: PersonalRecordBySide,
): (RecordKind | null)[] {
  // Record courant par côté + mémoire des côtés « premier passage » (historique
  // nul) : sur ceux-là, aucune série ne porte de marqueur (on ne bat pas un record
  // qui n'existe pas encore), le record se construit en silence.
  const running: Record<'left' | 'right', PersonalRecord> = {
    left: bySide.left,
    right: bySide.right,
  };
  const virgin: Record<'left' | 'right', boolean> = {
    left: bySide.left.bestE1rm === null && bySide.left.bestWeightReps === null,
    right: bySide.right.bestE1rm === null && bySide.right.bestWeightReps === null,
  };

  return sets.map((s) => {
    // Une série unilatérale porte toujours un côté ; un set sans côté (donnée
    // inattendue) retombe sur 'left' sans planter.
    const side: 'left' | 'right' = s.side === 'right' ? 'right' : 'left';
    const rec = running[side];
    if (virgin[side]) {
      running[side] = absorb(rec, s);
      return null;
    }
    const e1rm = isE1rmRecord(rec, s);
    const weightReps = isWeightRepsRecord(rec, s);
    running[side] = absorb(rec, s);
    if (e1rm && weightReps) return 'both';
    if (e1rm) return 'e1rm';
    if (weightReps) return 'weight-reps';
    return null;
  });
}

/** Intègre une série dans un record courant (pour faire avancer la comparaison). */
function absorb(record: PersonalRecord, s: PerformedSet): PersonalRecord {
  const e1rm = estimateE1rm(s.weightKg, s.reps, s.rir);
  const bestE1rm =
    record.bestE1rm === null || e1rm > record.bestE1rm ? e1rm : record.bestE1rm;
  const bestWeightReps = isWeightRepsRecord(record, s)
    ? { weightKg: s.weightKg, reps: s.reps }
    : record.bestWeightReps;
  return { bestE1rm, bestWeightReps };
}
