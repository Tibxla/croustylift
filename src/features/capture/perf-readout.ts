// Le chiffre de perf d'une série tel que la Capture l'affiche (ADR 0013,
// amendement du 2026-11-23) : son e1RM, ou ses REPS EFFECTIVES (reps + RIR)
// quand elle est à 0 kg. Un exo au poids du corps saisi à 0 kg a un e1RM nul
// quelle que soit la perf : l'écran dit alors « reps », jamais « e1RM 0 ».
//
// Même mesure que le juge des badges (`comparePerformance`, domain/e1rm.ts) : ce
// qu'on lit est ce qui est comparé. Pur.
import { effectiveReps, isZeroLoad } from '../../domain/e1rm';
import { draftE1rm } from './draft-e1rm';
import { formatE1rm } from './format';

export interface PerfReadout {
  /** Le nom de la mesure. */
  label: 'e1RM' | 'reps eff.';
  /** Le chiffre, déjà formaté : « 94,5 », « 12 ». */
  value: string;
  /** L'unité à écrire après le chiffre ; les reps n'en ont pas (le libellé la dit). */
  unit: 'kg' | null;
}

/**
 * La mesure des valeurs données, ou `null` quand il n'y a rien de sensé à
 * afficher (saisie invalide en cours de réglage). Ne jette jamais.
 */
export function perfReadout(weightKg: number, reps: number, rir: number): PerfReadout | null {
  if (Number.isFinite(weightKg) && isZeroLoad(weightKg)) {
    if (!Number.isInteger(reps) || reps < 1 || !Number.isInteger(rir) || rir < 0) return null;
    return { label: 'reps eff.', value: `${effectiveReps(reps, rir)}`, unit: null };
  }
  const e1rm = draftE1rm(weightKg, reps, rir);
  return e1rm === null ? null : { label: 'e1RM', value: formatE1rm(e1rm), unit: 'kg' };
}

/** La mesure en une ligne, pour un repère : « e1RM 94,5 », « reps eff. 12 ». */
export function formatPerf(set: { weightKg: number; reps: number; rir: number }): string | null {
  const readout = perfReadout(set.weightKg, set.reps, set.rir);
  return readout === null ? null : `${readout.label} ${readout.value}`;
}
