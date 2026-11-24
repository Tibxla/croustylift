// Le statut des séries du Journal face à leur Référence, recalculé sur
// l'historique (UX 12) : la Salle a dit « ▲ 2 battues · record », le Journal le
// redit, série par série et sur la ligne de la séance.
//
// Mêmes règles qu'en salle, par les mêmes fonctions (`computeSetBadges`,
// `computeSetBadgesBySide`, ADR 0010) :
//   - la Référence d'un exo est sa DERNIÈRE exécution dans la MÊME séance, avant
//     celle-ci (GLOSSARY, « Référence ») ; sans séance (exécution hors plan) ni
//     passage antérieur dans la séance, il n'y en a pas ;
//   - le record est celui de tout l'historique de l'exo avant cette exécution,
//     toutes séances confondues, par côté en unilatéral ;
//   - un seul statut par série, record > battue > égalée. Une série qui bat le
//     record n'est pas AUSSI comptée battue : le compte de la ligne est celui de
//     la fin de séance ;
//   - le nombre de records de la ligne est celui de la clôture (`dayRecords`) :
//     au plus un par axe et par côté, même si deux séries ont passé tour à tour
//     le record provisoire (chacune garde son badge dans le détail).
// S'y ajoute « en deçà » (▼), que la Salle ne montre pas sur ses badges : la
// série avait une Référence à son rang et ne l'a ni battue ni égalée. Sans
// Référence à ce rang, aucun statut (rien à battre n'est pas un échec).
//
// Pure, sans réseau. Les entrées arrivent la plus récente en tête
// (`buildRawLog`) : on les parcourt à rebours, dans l'ordre du temps.
import type { ExerciseExecution, PerformedSet } from '../../domain/types';
import { personalRecord, personalRecordBySide } from '../../domain/pr';
import { computeSetBadges, computeSetBadgesBySide, dayRecords, type SetBadge } from '../capture/set-badges';
import type { RawLogEntry } from './raw-log';

/**
 * Le statut d'une série : 'record' (e1RM, ou e1RM et charge), 'record-charge'
 * (la charge seule), 'battue', 'egalee', 'en-deca', ou `null` (rien à quoi la
 * comparer).
 */
export type JournalSetStatus = 'record' | 'record-charge' | 'battue' | 'egalee' | 'en-deca' | null;

/** Les statuts d'une séance du journal. */
export interface ExecutionVerdicts {
  /** Par exo (`exerciseId`), alignés sur `exercise.sets`. */
  sets: Map<string, JournalSetStatus[]>;
  /** Séries battues (hors records), comme le compte de la fin de séance. */
  beaten: number;
  /** Records du jour, comptés comme la fin de séance (`dayRecords` : au plus
   *  un par axe et par côté). Le détail, lui, badge chaque série. */
  records: number;
}

function statusOf(badge: SetBadge, set: PerformedSet, reference: PerformedSet[] | null): JournalSetStatus {
  if (badge?.axis === 'record') return badge.record === 'weight-reps' ? 'record-charge' : 'record';
  if (badge?.axis === 'reference') return badge.verdict === 'battu' ? 'battue' : 'egalee';
  const hadReference = reference?.some((r) => r.order === set.order && r.side === set.side) ?? false;
  return hadReference ? 'en-deca' : null;
}

/** Statuts de chaque série de chaque séance, par `executionId`. */
export function journalVerdicts(entries: readonly RawLogEntry[]): Map<string, ExecutionVerdicts> {
  const out = new Map<string, ExecutionVerdicts>();
  /** Tout l'historique de chaque exo, pour son record. */
  const past = new Map<string, ExerciseExecution[]>();
  /** Dernières séries de chaque exo dans chaque séance : sa Référence. */
  const lastInSeance = new Map<string, PerformedSet[]>();

  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i]!;
    const verdicts: ExecutionVerdicts = { sets: new Map(), beaten: 0, records: 0 };
    for (const exercise of entry.exercises) {
      const sets: PerformedSet[] = exercise.sets;
      const history = past.get(exercise.exerciseId) ?? [];
      const refKey = entry.seanceId ? `${entry.seanceId}|${exercise.exerciseId}` : null;
      const reference = refKey ? (lastInSeance.get(refKey) ?? null) : null;
      const unilateral = sets.some((s) => s.side !== undefined);
      const badges = unilateral
        ? computeSetBadgesBySide(sets, reference, personalRecordBySide(history, exercise.exerciseId))
        : computeSetBadges(sets, reference, history.length > 0 ? personalRecord(history, exercise.exerciseId) : null);
      const statuses = sets.map((s, k) => statusOf(badges[k] ?? null, s, reference));
      for (const status of statuses) if (status === 'battue') verdicts.beaten += 1;
      // Le décompte de la fin de séance : au plus un record par axe et par côté.
      verdicts.records += dayRecords(sets, badges, unilateral).length;
      verdicts.sets.set(exercise.exerciseId, statuses);

      history.push({ date: entry.date, exerciseId: exercise.exerciseId, sets });
      past.set(exercise.exerciseId, history);
      if (refKey) lastInSeance.set(refKey, [...sets].sort((a, b) => a.order - b.order));
    }
    out.set(entry.executionId, verdicts);
  }
  return out;
}
