// Détection des records personnels (issue #34), logique pure extraite de la
// Capture (testée par record-flags.test.ts ; fast-refresh propre côté composant).
// Le record « avance » au fil des séries du jour : on part du record historique,
// chaque série qui le dépasse le remplace, donc une SEULE série par mesure porte
// le marqueur (la première à dépasser), pas toutes celles qui battent l'ancien.
import { estimateE1rm } from '../../domain/e1rm';
import { isE1rmRecord, isWeightRepsRecord, type PersonalRecord } from '../../domain/pr';
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
