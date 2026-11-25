// Ce que l'instrument de la Salle lit au-dessus des réglages : « Cette série »
// (la mesure du brouillon), « Dernière fois » et « Record », chacun avec la
// position du brouillon en direct. La décision et le risque accepté sont en tête
// de draft-e1rm.ts (25/11, ADR 0010 amendé le 2026-11-25).
//
// Règles :
//   - le signe vient du juge des badges, `comparePerformance`, et de lui seul ;
//   - l'écart est signé dans la mesure du juge, au dixième de kg d'e1RM ou en
//     reps entières à 0 kg des deux côtés ;
//   - un écart qui s'arrondit à zéro sans l'être (0,03 kg) ne s'écrit pas : le
//     signe et le mot suffisent, jamais « +0 » ;
//   - mesures mêlées (0 kg face à une série chargée, ou l'inverse) : le signe et
//     le mot, sans chiffre, on ne soustrait pas des reps à des kilos ;
//   - à égalité stricte, « à égalité » sans chiffre.
//
// Pur : aucune dépendance à React ni à l'écran.
import { comparePerformance, e1rmBeats, e1rmEquals, effectiveReps, isZeroLoad, type Performance } from '../../domain/e1rm';
import { isRepsRecord, type PersonalRecord } from '../../domain/pr';
import type { PerformedSet } from '../../domain/types';
import { draftE1rm } from './draft-e1rm';
import { formatE1rm } from './format';
import { perfReadout, type PerfReadout } from './perf-readout';

/** Où se tient le brouillon face à un repère : signe, mot, écart signé ou rien. */
export interface Standing {
  v: 'up' | 'eq' | 'down';
  word: 'au-dessus' | 'à égalité' | 'en dessous';
  /** « +3,2 », « −6 », « +1 » ; `null` à égalité, sous l'arrondi, ou mesures mêlées. */
  gap: string | null;
}

/** Écart signé, virgule, signe moins typographique ; `null` s'il s'arrondit à zéro. */
function signed(n: number, decimals: number): string | null {
  const r = Math.round(n * 10 ** decimals) / 10 ** decimals;
  if (r === 0) return null;
  return `${r > 0 ? '+' : '−'}${Math.abs(r).toFixed(decimals).replace('.', ',').replace(/,0+$/, '')}`;
}

function standingOf(order: number, gap: string | null): Standing {
  if (order > 0) return { v: 'up', word: 'au-dessus', gap };
  if (order < 0) return { v: 'down', word: 'en dessous', gap };
  return { v: 'eq', word: 'à égalité', gap: null };
}

/** Le brouillon a-t-il une mesure (une perf que le juge sait lire) ? */
function measurable(draft: Performance): boolean {
  return perfReadout(draft.weightKg, draft.reps, draft.rir) !== null;
}

/**
 * Le brouillon face à une série repère (Référence, ou la série qui tient le
 * record). `null` si le brouillon n'a pas de mesure (réglage invalide).
 */
export function standingVs(draft: Performance, target: Performance): Standing | null {
  if (!measurable(draft)) return null;
  const order = comparePerformance(draft, target);
  let gap: string | null = null;
  if (isZeroLoad(draft.weightKg) && isZeroLoad(target.weightKg)) {
    gap = signed(effectiveReps(draft.reps, draft.rir) - effectiveReps(target.reps, target.rir), 0);
  } else if (!isZeroLoad(draft.weightKg) && !isZeroLoad(target.weightKg)) {
    const a = draftE1rm(draft.weightKg, draft.reps, draft.rir);
    const b = draftE1rm(target.weightKg, target.reps, target.rir);
    gap = a === null || b === null ? null : signed(a - b, 1);
  }
  return standingOf(order, gap);
}

/** Face à l'e1RM d'un record chargé : la règle stricte de `isE1rmRecord`, sur la
 *  mesure entière. La série du record ne sert qu'au record tenu à 0 kg. */
function standingVsE1rm(draft: Performance, best: number): Standing | null {
  if (!measurable(draft)) return null;
  const e1rm = draftE1rm(draft.weightKg, draft.reps, draft.rir) ?? 0;
  const order = e1rmBeats(e1rm, best) ? 1 : e1rmEquals(e1rm, best) ? 0 : -1;
  return standingOf(order, isZeroLoad(draft.weightKg) ? null : signed(e1rm - best, 1));
}

export interface DraftScore {
  /** « Cette série » : la mesure du brouillon, ou `null` (réglage invalide). */
  live: PerfReadout | null;
  /** « Dernière fois » : la série du même rang et du même côté, ou ce qui manque. */
  last: { kind: 'set'; set: PerformedSet; standing: Standing | null } | { kind: 'none'; word: 'rien à cette série' | 'pas encore' };
  /** « Record » : le record e1RM courant, ou « aucun encore ». */
  record:
    | { kind: 'record'; label: 'e1RM' | 'reps eff.'; value: string; standing: Standing | null }
    | { kind: 'none'; word: 'aucun encore' };
}

/**
 * Le tableau du brouillon. `refSet` : la série de la Référence à ce rang et ce
 * côté ; `hasReference` : la séance a une Référence (sinon premier passage,
 * « pas encore ») ; `record` : le record COURANT du côté visé (`currentRecord`,
 * record-flags.ts), `null` sans aucun.
 */
export function draftScore({
  draft,
  refSet,
  hasReference,
  record,
}: {
  draft: Performance;
  refSet: PerformedSet | null;
  hasReference: boolean;
  record: PersonalRecord | null;
}): DraftScore {
  const last: DraftScore['last'] = refSet
    ? { kind: 'set', set: refSet, standing: standingVs(draft, refSet) }
    : { kind: 'none', word: hasReference ? 'rien à cette série' : 'pas encore' };

  let rec: DraftScore['record'] = { kind: 'none', word: 'aucun encore' };
  if (record && record.bestE1rm !== null) {
    const holder = record.bestE1rmSet ? { weightKg: record.bestE1rmSet.weightKg, reps: record.bestE1rmSet.reps, rir: record.bestE1rmSet.rir ?? 0 } : null;
    rec =
      holder && isRepsRecord(record)
        ? { kind: 'record', label: 'reps eff.', value: `${effectiveReps(holder.reps, holder.rir)}`, standing: standingVs(draft, holder) }
        : {
            kind: 'record',
            label: 'e1RM',
            value: formatE1rm(record.bestE1rm),
            // Jugé sur l'e1RM du record, comme les badges (`isE1rmRecord`) : la
            // série porteuse peut avoir perdu son RIR, et relue à RIR 0 elle
            // vaudrait moins que le record affiché.
            standing: standingVsE1rm(draft, record.bestE1rm),
          };
  }

  return { live: perfReadout(draft.weightKg, draft.reps, draft.rir), last, record: rec };
}
