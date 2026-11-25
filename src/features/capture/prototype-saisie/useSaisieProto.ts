// PROTOTYPE JETABLE · la logique commune aux variantes de saisie, sans aucune
// mise en page : brouillon amorcé comme l'instrument réel (`seedDraft`), rang de
// la série, Référence à battre, écart, badges, record, côté en unilatéral.
// Version simplifiée d'ExerciseCapture (pas de garde « brouillon touché » face
// aux réponses tardives de la base : le prototype n'écrit rien).
import { useEffect, useMemo, useRef, useState } from 'react';
import { effectiveReps, isZeroLoad } from '../../../domain/e1rm';
import { isRepsRecord } from '../../../domain/pr';
import { currentSetOrder, defaultSide, pairSidesByOrder, sidesDoneAt, targetSlotForSide } from '../../../domain/unilateral';
import type { PerformedSet, Side } from '../../../domain/types';
import { useReglages } from '../../../settings/reglages';
import { seedDraft } from '../capture-seed';
import { draftE1rm } from '../draft-e1rm';
import type { SessionExercise } from '../fixtures';
import { formatE1rm } from '../format';
import { perfReadout } from '../perf-readout';
import { computeSetBadges, computeSetBadgesBySide, type SetBadge } from '../set-badges';
import type { ExerciseProgress } from '../state';
import { roundWeightKg } from '../stepper-utils';

function signed(n: number, decimals: number): string {
  const r = Math.round(n * 10 ** decimals) / 10 ** decimals;
  if (r === 0) return '0';
  return `${r > 0 ? '+' : '−'}${Math.abs(r).toFixed(decimals).replace('.', ',')}`;
}

/** Écart signé brut entre deux nombres, « ±0 » à égalité (en-têtes de cadrans). */
export function delta(a: number, b: number, decimals = 0): string {
  const r = Math.round((a - b) * 10 ** decimals) / 10 ** decimals;
  if (r === 0) return '±0';
  return `${r > 0 ? '+' : '−'}${Math.abs(r).toFixed(decimals).replace('.', ',').replace(/,0+$/, '')}`;
}

export interface Saisie {
  unilateral: boolean;
  side: Side | null;
  chooseSide: (s: Side) => void;
  doneSides: Side[];
  completedSets: number;
  /** Rang de la série en cours (celle que Logger écrirait). */
  rank: number;
  plannedMax: number;
  weightKg: number;
  reps: number;
  rir: number;
  setWeight: (kg: number) => void;
  setReps: (n: number) => void;
  setRir: (n: number) => void;
  stepKg: number;
  refToBeat: PerformedSet | null;
  hasReference: boolean;
  gap: { measure: 'e1RM' | 'reps eff.'; value: string; unit: string } | null;
  live: ReturnType<typeof perfReadout>;
  record: { value: string; unit: string } | null;
  badges: SetBadge[];
  /** Clé qui change à chaque nouvelle saisie (exo, série, côté). */
  draftKey: string;
}

export function useSaisieProto(exercise: SessionExercise, progress: ExerciseProgress): Saisie {
  const { prescription, reference } = exercise;
  const unilateral = exercise.unilateral ?? false;
  const loggedCount = progress.sets.length;
  const completedSets = unilateral
    ? pairSidesByOrder(progress.sets).filter((p) => p.left !== null && p.right !== null).length
    : loggedCount;

  const [selectedSide, setSelectedSide] = useState<Side>(() => defaultSide(progress.sets));
  const sidesKey = unilateral ? progress.sets.map((s) => `${s.order}${s.side ?? ''}`).join(',') : '';
  useEffect(() => {
    if (unilateral) setSelectedSide(defaultSide(progress.sets));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sidesKey, loggedCount, unilateral]);
  const side: Side | null = unilateral ? selectedSide : null;

  const badges = useMemo<SetBadge[]>(
    () =>
      unilateral
        ? computeSetBadgesBySide(
            progress.sets,
            reference ?? null,
            exercise.personalRecordBySide ?? {
              left: { bestE1rm: null, bestE1rmSet: null, bestWeightReps: null },
              right: { bestE1rm: null, bestE1rmSet: null, bestWeightReps: null },
            },
          )
        : computeSetBadges(progress.sets, reference ?? null, exercise.personalRecord ?? null),
    [unilateral, progress.sets, reference, exercise.personalRecordBySide, exercise.personalRecord],
  );

  const seed = useMemo(
    () =>
      seedDraft({
        prescription,
        reference: reference ?? null,
        fallbackReference: exercise.fallbackReference ?? null,
        loggedSets: progress.sets,
        side: side ?? undefined,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [exercise.exerciseId, loggedCount, side, reference, exercise.fallbackReference],
  );
  const [weightKg, setWeightKg] = useState(seed.weightKg);
  const [reps, setReps] = useState(seed.reps);
  const [rir, setRir] = useState(seed.rir);
  const draftKey = `${exercise.exerciseId}:${loggedCount}:${side ?? ''}`;
  const seededKey = useRef(draftKey);
  useEffect(() => {
    if (seededKey.current === draftKey) return;
    seededKey.current = draftKey;
    setWeightKg(seed.weightKg);
    setReps(seed.reps);
    setRir(seed.rir);
  }, [seed, draftKey]);

  const rank = unilateral && side ? targetSlotForSide(progress.sets, side) + 1 : loggedCount + 1;
  const refToBeat = unilateral
    ? reference?.find((s) => s.order === rank && s.side === side) ?? null
    : reference?.find((s) => s.order === rank) ?? null;

  const draft: PerformedSet = { order: rank, weightKg, reps, rir, side: side ?? undefined };
  let gap: Saisie['gap'] = null;
  if (refToBeat) {
    if (isZeroLoad(draft.weightKg) && isZeroLoad(refToBeat.weightKg)) {
      gap = { measure: 'reps eff.', value: signed(effectiveReps(draft.reps, draft.rir) - effectiveReps(refToBeat.reps, refToBeat.rir), 0), unit: 'reps' };
    } else {
      const a = draftE1rm(draft.weightKg, draft.reps, draft.rir);
      const b = draftE1rm(refToBeat.weightKg, refToBeat.reps, refToBeat.rir);
      gap = a === null || b === null ? null : { measure: 'e1RM', value: signed(a - b, 1), unit: 'kg' };
    }
  }

  const displayRecord = unilateral ? exercise.personalRecordBySide?.[selectedSide] ?? null : exercise.personalRecord ?? null;
  const record =
    displayRecord?.bestE1rm != null && displayRecord.bestE1rmSet
      ? isRepsRecord(displayRecord)
        ? { value: `${effectiveReps(displayRecord.bestE1rmSet.reps, displayRecord.bestE1rmSet.rir ?? 0)}`, unit: 'reps' }
        : { value: formatE1rm(displayRecord.bestE1rm), unit: 'kg' }
      : null;

  const { stepKg } = useReglages();
  const doneSides = unilateral ? sidesDoneAt(progress.sets, currentSetOrder(progress.sets)) : [];

  return {
    unilateral,
    side,
    chooseSide: setSelectedSide,
    doneSides,
    completedSets,
    rank,
    plannedMax: prescription.sets.max,
    weightKg,
    reps,
    rir,
    setWeight: (kg) => setWeightKg(roundWeightKg(kg)),
    setReps,
    setRir,
    stepKg,
    refToBeat,
    hasReference: reference != null,
    gap,
    live: perfReadout(weightKg, reps, rir),
    record,
    badges,
    draftKey,
  };
}
