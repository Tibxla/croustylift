// Panneau de capture d'un exo. Nom = roi ; « dernière fois » = co-roi à battre ;
// saisie par steppers au pouce ; « Logger la série » en 1 tap.
import { useEffect, useMemo, useState } from 'react';
import { estimateE1rm } from '../../domain/e1rm';
import { deriveDeviations } from '../../domain/deviation';
import type { PerformedSet } from '../../domain/types';
import type { SessionExercise } from './fixtures';
import type { ExerciseProgress } from './state';
import { Stepper } from './Stepper';
import { DeviationBadge, deviationVisual } from './DeviationBadge';
import { formatE1rm, formatPrescription, formatSet, formatRange, formatWeight } from './format';

interface ExerciseCaptureProps {
  exercise: SessionExercise;
  progress: ExerciseProgress;
  onUndoLast: () => void;
  onSkip: () => void;
  onBack: () => void;
  /** Remonte le brouillon de la série courante vers la barre d'action fixe (qui commit). */
  onDraftChange: (draft: { weightKg: number; reps: number; rir: number }) => void;
}

const WEIGHT_STEP = 2.5;
const WEIGHT_FINE = 1.25;

/** Valeurs pré-remplies : série N ↔ référence série N, sinon report de la dernière connue. */
function seedFor(
  exercise: SessionExercise,
  loggedCount: number,
): { weightKg: number; reps: number; rir: number } {
  const ref = exercise.reference;
  const nextOrder = loggedCount + 1;
  if (ref && ref.length > 0) {
    const atPosition = ref.find((s) => s.order === nextOrder);
    const source = atPosition ?? ref[ref.length - 1];
    return { weightKg: source.weightKg, reps: source.reps, rir: source.rir };
  }
  // Pas de référence : report de la dernière série loggée, ou un point de départ neutre.
  return { weightKg: 20, reps: 10, rir: 1 };
}

export function ExerciseCapture({
  exercise,
  progress,
  onUndoLast,
  onSkip,
  onBack,
  onDraftChange,
}: ExerciseCaptureProps) {
  const { prescription, reference } = exercise;
  const loggedCount = progress.sets.length;

  // Brouillon de la série courante (steppers). Report de la dernière série loggée si elle existe.
  const seed = useMemo(() => {
    if (loggedCount > 0) {
      const last = progress.sets[loggedCount - 1];
      const refAt = reference?.find((s) => s.order === loggedCount + 1);
      // Position suivante connue dans la référence ? on la propose ; sinon on reporte la dernière.
      return refAt
        ? { weightKg: refAt.weightKg, reps: refAt.reps, rir: refAt.rir }
        : { weightKg: last.weightKg, reps: last.reps, rir: last.rir };
    }
    return seedFor(exercise, loggedCount);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exercise.exerciseId, loggedCount]);

  const [weightKg, setWeightKg] = useState(seed.weightKg);
  const [reps, setReps] = useState(seed.reps);
  const [rir, setRir] = useState(seed.rir);

  // Quand on change d'exo ou qu'on logge/annule une série, on ré-amorce le brouillon.
  useEffect(() => {
    setWeightKg(seed.weightKg);
    setReps(seed.reps);
    setRir(seed.rir);
  }, [seed]);

  // Remonte le brouillon courant vers la barre d'action fixe (qui commit le log).
  useEffect(() => {
    onDraftChange?.({ weightKg, reps, rir });
  }, [weightKg, reps, rir, onDraftChange]);

  // La série « à battre » à la position courante (co-roi).
  const refToBeat = reference?.find((s) => s.order === loggedCount + 1) ?? null;

  // Statut de fin (si au moins le minimum prescrit est atteint).
  const reachedMin = loggedCount >= prescription.sets.min;
  const deviations = deriveDeviations(prescription, progress.sets);
  const finishVisual = deviationVisual(deviations, prescription.sets, loggedCount);

  // e1RM de la 1ʳᵉ série loggée (touche domaine, readout discret).
  const firstSet = progress.sets[0];
  const firstE1rm =
    firstSet && firstSet.reps >= 1
      ? estimateE1rm(firstSet.weightKg, firstSet.reps, firstSet.rir)
      : null;

  return (
    <div className="mx-auto flex w-full max-w-md flex-col px-4 pb-32 pt-3">
      {/* Retour au sélecteur */}
      <button
        type="button"
        onClick={onBack}
        className="-ml-1 mb-2 inline-flex items-center gap-1.5 self-start rounded-lg py-2 pr-3 text-sm font-medium text-ink-muted transition active:text-ink"
      >
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M15 6l-6 6 6 6" />
        </svg>
        Tous les exercices
      </button>

      {/* Nom = roi */}
      <h2 className="text-3xl font-bold leading-tight tracking-tight text-ink">
        {exercise.name}
      </h2>

      {/* Cible prescrite */}
      <p className="readout mt-1.5 text-sm text-ink-muted">
        Cible{' '}
        {formatPrescription(prescription.sets, prescription.reps, prescription.rir)}
      </p>

      {/* Co-roi : « dernière fois » à battre */}
      <div className="mt-3 rounded-2xl bg-surface px-4 py-3">
        {refToBeat ? (
          <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-sm text-ink-muted">À battre · dernière fois</span>
            <span className="readout text-base font-medium text-ink">
              {formatSet(refToBeat)}
            </span>
          </p>
        ) : reference ? (
          <p className="text-sm text-ink-muted">
            Dernière fois : <span className="readout">{reference.length}</span> séries
            seulement. Au-delà, surpasse-toi.
          </p>
        ) : (
          <p className="text-sm text-ink-muted">
            Premier passage sur cet exercice. Aucune référence à battre.
          </p>
        )}
      </div>

      {/* Séries déjà loggées (mono, alignées) */}
      {loggedCount > 0 && (
        <ol className="mt-4 flex flex-col gap-1.5">
          {progress.sets.map((s) => {
            const beats =
              refToBeatAt(reference, s.order) &&
              estimateE1rm(s.weightKg, s.reps, s.rir) >=
                estimateE1rm(
                  refToBeatAt(reference, s.order)!.weightKg,
                  refToBeatAt(reference, s.order)!.reps,
                  refToBeatAt(reference, s.order)!.rir,
                );
            return (
              <li
                key={s.order}
                className="flex items-center gap-3 rounded-xl bg-surface px-4 py-2.5"
              >
                <span className="readout w-6 shrink-0 text-sm text-ink-muted tabular-nums">
                  {s.order}
                </span>
                <span className="readout flex-1 text-base text-ink tabular-nums">
                  {formatSet(s)}
                </span>
                {beats && (
                  <span
                    className="inline-flex items-center gap-1 text-xs font-medium text-ink-muted"
                    title="Référence battue"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      width="14"
                      height="14"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                      className="text-accent-ink"
                    >
                      <path d="M12 19V5M6 11l6-6 6 6" />
                    </svg>
                    battu
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {/* e1RM de la 1ʳᵉ série + badge de fin */}
      {(firstE1rm != null || reachedMin) && (
        <div className="mt-3 flex items-center justify-between gap-3">
          {firstE1rm != null ? (
            <span className="text-sm text-ink-muted">
              e1RM{' '}
              <span className="readout font-medium text-ink">{formatE1rm(firstE1rm)} kg</span>
            </span>
          ) : (
            <span />
          )}
          {reachedMin && <DeviationBadge visual={finishVisual} />}
        </div>
      )}

      {/* Compteur de série courante */}
      <p className="mt-6 mb-3" aria-live="polite">
        <span className="text-sm font-medium text-ink-muted">
          Série{' '}
          <span className="readout text-ink">{loggedCount + 1}</span> /{' '}
          <span className="readout text-ink">{formatRange(prescription.sets)}</span>
        </span>
      </p>

      {/* Saisie par steppers */}
      <div className="grid grid-cols-1 gap-4">
        <Stepper
          label="Poids"
          unit="kg"
          value={weightKg}
          step={WEIGHT_STEP}
          fineStep={WEIGHT_FINE}
          min={0}
          format={formatWeight}
          onChange={setWeightKg}
        />
        <div className="grid grid-cols-2 gap-4">
          <Stepper label="Reps" value={reps} step={1} min={1} onChange={setReps} />
          <Stepper label="RIR" value={rir} step={1} min={0} onChange={setRir} />
        </div>
      </div>

      {/* Actions secondaires */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        {loggedCount > 0 && (
          <button
            type="button"
            onClick={onUndoLast}
            className="inline-flex h-11 items-center gap-1.5 rounded-xl bg-surface px-4 text-sm font-medium text-ink-muted transition active:bg-surface-2 active:text-ink"
          >
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M9 14L4 9l5-5" />
              <path d="M4 9h11a5 5 0 0 1 0 10h-1" />
            </svg>
            Annuler la dernière
          </button>
        )}
        <button
          type="button"
          onClick={onSkip}
          className="inline-flex h-11 items-center rounded-xl bg-surface px-4 text-sm font-medium text-ink-muted transition active:bg-surface-2 active:text-ink"
        >
          Passer l&apos;exercice
        </button>
      </div>
    </div>
  );
}

function refToBeatAt(
  reference: SessionExercise['reference'],
  order: number,
): PerformedSet | null {
  return reference?.find((s) => s.order === order) ?? null;
}
