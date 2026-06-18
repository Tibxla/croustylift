// Édition d'une séance PASSÉE (issue #38), ouverte depuis le journal.
//
// On corrige le réalisé d'un jour antérieur : ajouter / modifier / supprimer des
// séries d'un exo déjà loggé. La saisie réutilise le Stepper au pouce de la
// capture (jamais d'<input>/clavier OS, cf. DESIGN.md). L'écriture passe par le
// MÊME chemin que la capture du jour : on dérive les ops d'outbox (logique pure
// `diffSetsToOps`) et on les enfile/flush via `flushOps` (outbox FIFO,
// idempotent par id, cf. ADR 0003). Aucun second chemin d'écriture, aucune
// mutation des autres jours : chaque op porte l'id de SA ligne, scopée à cette
// exécution.
import { useEffect, useMemo, useState } from 'react';
import { Stepper } from '../capture/Stepper';
import { formatWeight } from '../capture/format';
import { newId } from '../capture/state';
import { loadExecutionForEdit, type EditableExecution } from '../capture/data';
import {
  addSet,
  updateSet,
  removeSet,
  diffSetsToOps,
  type EditableSet,
} from '../capture/past-session-edit';
import { flushOps } from '../capture/sync';
import type { OutboxOp } from '../capture/outbox';

const WEIGHT_STEP = 2.5;
const WEIGHT_FINE = 1.25;

/** 'YYYY-MM-DD' -> 'mer. 8 janv. 2026' (date longue lisible, locale fr). */
function formatDateLong(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** État d'édition par exo : l'original (base) gardé pour le diff + l'édité courant. */
interface ExerciseEditState {
  exerciseId: string;
  name: string;
  /** Séries telles qu'en base (ids réels) : référence stable du diff. */
  original: EditableSet[];
  /** Séries après éditions de l'user. */
  edited: EditableSet[];
}

type LoadPhase =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; date: string; exercises: ExerciseEditState[] };

type SavePhase =
  | { phase: 'idle' }
  | { phase: 'saving' }
  | { phase: 'error'; message: string };

export function PastSessionEditor({
  executionId,
  onClose,
  onSaved,
}: {
  executionId: string;
  /** Fermer l'éditeur sans rien changer (retour au journal). */
  onClose: () => void;
  /** Appelé après une sauvegarde réussie : le parent recharge le journal/l'analyse. */
  onSaved: () => void;
}) {
  const [load, setLoad] = useState<LoadPhase>({ phase: 'loading' });
  const [save, setSave] = useState<SavePhase>({ phase: 'idle' });

  useEffect(() => {
    let active = true;
    setLoad({ phase: 'loading' });

    void (async () => {
      try {
        const exec = await loadExecutionForEdit(executionId);
        if (!active) return;
        setLoad({ phase: 'ready', date: exec.date, exercises: toEditStates(exec) });
      } catch (err) {
        if (!active) return;
        setLoad({
          phase: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    })();

    return () => {
      active = false;
    };
  }, [executionId]);

  // Une édition est en cours dès qu'un exo diffère de son original.
  const dirty = useMemo(() => {
    if (load.phase !== 'ready') return false;
    return load.exercises.some((ex) => buildOps(ex, executionId).length > 0);
  }, [load, executionId]);

  function patchExercise(
    exerciseId: string,
    fn: (sets: EditableSet[]) => EditableSet[],
  ) {
    setLoad((prev) => {
      if (prev.phase !== 'ready') return prev;
      return {
        ...prev,
        exercises: prev.exercises.map((ex) =>
          ex.exerciseId === exerciseId ? { ...ex, edited: fn(ex.edited) } : ex,
        ),
      };
    });
    // Une nouvelle édition annule un éventuel message d'erreur de sauvegarde.
    setSave((s) => (s.phase === 'error' ? { phase: 'idle' } : s));
  }

  async function handleSave() {
    if (load.phase !== 'ready') return;
    const ops: OutboxOp[] = load.exercises.flatMap((ex) => buildOps(ex, executionId));
    if (ops.length === 0) {
      onClose();
      return;
    }
    setSave({ phase: 'saving' });
    try {
      // `flush` ne REJETTE PAS sur une coupure réseau : il s'arrête à l'op en
      // échec et renvoie `remaining > 0` (cf. outbox.ts). On inspecte donc le
      // résultat, pas seulement les exceptions, sinon on fermerait l'éditeur en
      // croyant la sauvegarde passée alors que les corrections sont encore en
      // file (le journal rechargé montrerait l'ancien réalisé).
      const result = await flushOps(ops);
      if (result.remaining > 0) {
        // Ops durables (déjà enfilées) mais pas encore remontées : on garde
        // l'éditeur ouvert et on explique qu'elles partiront au retour du réseau.
        setSave({ phase: 'error', message: 'Pas de réseau pour le moment.' });
        return;
      }
      onSaved();
    } catch (err) {
      // Erreur inattendue (pas une simple coupure) : les ops restent durables et
      // remonteront au prochain flush ; on garde l'éditeur ouvert pour réessayer.
      setSave({
        phase: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (load.phase === 'loading') {
    return <EditorShell onClose={onClose}>{<EditorSkeleton />}</EditorShell>;
  }

  if (load.phase === 'error') {
    return (
      <EditorShell onClose={onClose}>
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-sm text-ink-muted">Impossible de charger cette séance.</p>
          <p className="readout max-w-full break-words text-xs text-warn">
            {load.message}
          </p>
        </div>
      </EditorShell>
    );
  }

  return (
    <EditorShell onClose={onClose} date={load.date}>
      <div className="flex flex-col gap-5 pb-40">
        {load.exercises.map((ex) => (
          <ExerciseEditor
            key={ex.exerciseId}
            exercise={ex}
            onUpdateSet={(id, values) =>
              patchExercise(ex.exerciseId, (sets) => updateSet(sets, id, values))
            }
            onRemoveSet={(id) =>
              patchExercise(ex.exerciseId, (sets) => removeSet(sets, id))
            }
            onAddSet={() =>
              patchExercise(ex.exerciseId, (sets) => addSet(sets, seedNewSet(sets)))
            }
          />
        ))}

        {load.exercises.length === 0 && (
          <p className="px-1 text-sm text-ink-muted">
            Aucune série loggée ce jour. Rien à corriger.
          </p>
        )}
      </div>

      {/* Barre d'action fixe : enregistrer les corrections. L'éditeur couvre la
          tab bar (modal z-30) donc on s'ancre tout en bas, pas sur --nav-offset,
          en réservant la safe-area iOS comme les barres de la capture. */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/95 pb-[env(safe-area-inset-bottom,0px)] backdrop-blur">
        <div className="mx-auto w-full max-w-md px-4 py-3">
          {save.phase === 'error' && (
            <p className="readout mb-2 break-words text-xs text-warn">
              La synchronisation a échoué. Tes corrections sont enregistrées en local
              et remonteront au retour du réseau. {save.message}
            </p>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={save.phase === 'saving' || (!dirty && save.phase !== 'error')}
            className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-accent-strong text-base font-semibold text-on-accent transition active:scale-[0.99] active:bg-accent disabled:cursor-not-allowed disabled:bg-surface disabled:text-ink-muted disabled:active:scale-100"
          >
            {save.phase === 'saving'
              ? 'Enregistrement...'
              : dirty
                ? 'Enregistrer les corrections'
                : 'Aucune correction'}
          </button>
        </div>
      </div>
    </EditorShell>
  );
}

// --- Édition d'un exo --------------------------------------------------------

function ExerciseEditor({
  exercise,
  onUpdateSet,
  onRemoveSet,
  onAddSet,
}: {
  exercise: ExerciseEditState;
  onUpdateSet: (id: string, values: Pick<EditableSet, 'weightKg' | 'reps' | 'rir'>) => void;
  onRemoveSet: (id: string) => void;
  onAddSet: () => void;
}) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <h3 className="text-base font-semibold leading-tight text-ink">{exercise.name}</h3>

      <ol className="mt-3 flex flex-col gap-4">
        {exercise.edited.map((set, index) => (
          <li key={set.id} className="rounded-xl bg-surface-2/60 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="readout text-sm font-medium tabular-nums text-ink-muted">
                Série <span className="text-ink">{index + 1}</span>
              </span>
              <button
                type="button"
                onClick={() => onRemoveSet(set.id)}
                className="inline-flex h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-ink-muted transition active:bg-surface active:text-ink"
                aria-label={`Supprimer la série ${index + 1}`}
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
                  <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
                </svg>
                Supprimer
              </button>
            </div>

            <Stepper
              label="Poids"
              unit="kg"
              value={set.weightKg}
              step={WEIGHT_STEP}
              fineStep={WEIGHT_FINE}
              min={0}
              format={formatWeight}
              onChange={(weightKg) =>
                onUpdateSet(set.id, { weightKg, reps: set.reps, rir: set.rir })
              }
            />
            <div className="mt-3 grid grid-cols-2 gap-4">
              <Stepper
                label="Reps"
                value={set.reps}
                step={1}
                min={1}
                onChange={(reps) =>
                  onUpdateSet(set.id, { weightKg: set.weightKg, reps, rir: set.rir })
                }
              />
              <Stepper
                label="RIR"
                value={set.rir}
                step={1}
                min={0}
                onChange={(rir) =>
                  onUpdateSet(set.id, { weightKg: set.weightKg, reps: set.reps, rir })
                }
              />
            </div>
          </li>
        ))}
      </ol>

      <button
        type="button"
        onClick={onAddSet}
        className="mt-3 inline-flex min-h-[3rem] w-full items-center justify-center gap-2 rounded-xl bg-surface-2 text-sm font-semibold text-ink transition active:scale-[0.99] active:bg-surface"
      >
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
        Ajouter une série
      </button>
    </section>
  );
}

// --- Chrome de l'éditeur (plein écran modal) --------------------------------

function EditorShell({
  children,
  onClose,
  date,
}: {
  children: React.ReactNode;
  onClose: () => void;
  date?: string;
}) {
  return (
    <div className="fixed inset-0 z-30 overflow-y-auto bg-bg">
      <div className="mx-auto w-full max-w-md px-4 pb-8 pt-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-xl font-bold leading-tight text-ink">
              Corriger la séance
            </h2>
            {date && (
              <p className="readout mt-0.5 text-sm tabular-nums text-ink-muted">
                {formatDateLong(date)}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="-mr-1 inline-flex h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-ink-muted transition active:text-ink"
            aria-label="Fermer sans enregistrer"
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
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
            Fermer
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function EditorSkeleton() {
  return (
    <ul className="flex flex-col gap-5" role="status" aria-label="Chargement de la séance">
      {[0, 1].map((i) => (
        <li key={i} className="rounded-2xl border border-line bg-surface p-4">
          <div className="mb-3 h-5 w-40 animate-pulse rounded bg-surface-2" />
          <div className="h-24 w-full animate-pulse rounded-xl bg-surface-2" />
        </li>
      ))}
    </ul>
  );
}

// --- Helpers (pas de logique métier ici : tout le diff vit dans le module pur) ---

/** Transforme l'exécution chargée en états d'édition (original figé = édité au départ). */
function toEditStates(exec: EditableExecution): ExerciseEditState[] {
  return exec.exercises.map((ex) => ({
    exerciseId: ex.exerciseId,
    name: ex.name,
    original: ex.sets,
    // Copie distincte : l'édition ne doit jamais muter la référence du diff.
    edited: ex.sets.map((s) => ({ ...s })),
  }));
}

/** Ops d'outbox d'un exo : diff (original -> édité), scopé à cette exécution/exo. */
function buildOps(ex: ExerciseEditState, executionId: string): OutboxOp[] {
  return diffSetsToOps(ex.original, ex.edited, {
    executionId,
    exerciseId: ex.exerciseId,
  });
}

/**
 * Valeurs de la série ajoutée : report de la dernière série (le plus probable
 * en muscu, on reprend la même charge), sinon un point de départ neutre. L'id
 * est un UUID client neuf (cf. ADR 0003) pour que l'insert ne collisionne pas.
 */
function seedNewSet(sets: EditableSet[]): EditableSet {
  const last = sets[sets.length - 1];
  if (last) {
    return { id: newId(), weightKg: last.weightKg, reps: last.reps, rir: last.rir };
  }
  return { id: newId(), weightKg: 20, reps: 10, rir: 1 };
}
