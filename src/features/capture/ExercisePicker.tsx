// Sélecteur d'exo : « je tape l'exo que j'attaque » (ordre libre).
// Chaque ligne : nom, cible prescrite, état (à faire / en cours / fait + compteur).
import type { Session } from './fixtures';
import type { CaptureState } from './state';
import { getProgress, statusOf } from './state';
import { formatPrescription, formatRange } from './format';

interface ExercisePickerProps {
  session: Session;
  state: CaptureState;
  onPick: (exerciseId: string) => void;
}

const STATUS_DOT: Record<string, string> = {
  todo: 'bg-line',
  'in-progress': 'bg-accent',
  done: 'bg-good',
  skipped: 'bg-warn',
};

const STATUS_LABEL: Record<string, string> = {
  todo: 'À faire',
  'in-progress': 'En cours',
  done: 'Fait',
  skipped: 'Passé',
};

export function ExercisePicker({ session, state, onPick }: ExercisePickerProps) {
  const doneCount = session.exercises.filter((ex) => {
    const p = getProgress(state, ex.exerciseId);
    return p.skipped || p.sets.length >= ex.prescription.sets.min;
  }).length;
  const allDone = doneCount === session.exercises.length;

  return (
    <div className="mx-auto flex w-full max-w-md flex-col px-4 pb-28 pt-5">
      <header className="mb-5">
        <h2 className="text-2xl font-semibold tracking-tight text-ink">{session.name}</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Tape l&apos;exercice que tu attaques.{' '}
          <span className="readout tabular-nums">
            {doneCount}/{session.exercises.length}
          </span>{' '}
          fait{doneCount > 1 ? 's' : ''}.
        </p>
      </header>

      {allDone && (
        <div
          className="mb-4 rounded-2xl bg-surface px-4 py-3 text-sm text-good"
          role="status"
          aria-live="polite"
        >
          <span className="font-medium">Séance terminée.</span> Tous les exercices sont
          traités — tu peux ranger le téléphone.
        </div>
      )}

      {session.exercises.length === 0 ? (
        <p className="rounded-2xl bg-surface px-4 py-8 text-center text-sm text-ink-muted">
          Aucun exercice dans cette séance.
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {session.exercises.map((ex) => {
            const progress = getProgress(state, ex.exerciseId);
            const status = statusOf(progress, ex.prescription.sets.min);
            const count = progress.sets.length;
            return (
              <li key={ex.exerciseId}>
                <button
                  type="button"
                  onClick={() => onPick(ex.exerciseId)}
                  className="group flex w-full items-center gap-3 rounded-2xl bg-surface px-4 py-3.5 text-left transition active:scale-[0.99] active:bg-surface-2"
                >
                  <span
                    className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${STATUS_DOT[status]}`}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base font-semibold text-ink">
                      {ex.name}
                    </span>
                    <span className="readout mt-0.5 block truncate text-sm text-ink-muted">
                      {formatPrescription(
                        ex.prescription.sets,
                        ex.prescription.reps,
                        ex.prescription.rir,
                      )}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-0.5">
                    <span className="text-xs font-medium text-ink-muted">
                      {STATUS_LABEL[status]}
                    </span>
                    {count > 0 && (
                      <span className="readout text-sm font-medium text-ink tabular-nums">
                        {count}/{formatRange(ex.prescription.sets)}
                      </span>
                    )}
                  </span>
                  <svg
                    viewBox="0 0 24 24"
                    width="18"
                    height="18"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="shrink-0 text-ink-muted"
                    aria-hidden="true"
                  >
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
