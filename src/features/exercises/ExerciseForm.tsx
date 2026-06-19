// Formulaire de saisie d'un exo perso, PARTAGÉ entre la création (sélecteur
// d'ajout d'une séance, SeanceEditor) et la création/édition de l'onglet
// « Exercices » (issue #49). Un seul endroit pour : nom (texte), LISTE de muscles
// principaux (>= 1, chips cochables) et drapeau unilatéral (segment).
//
// DESIGN.md tenu ici :
//   - l'info n'est jamais portée par la couleur seule : un muscle sélectionné
//     porte une coche « ✓ » EN PLUS de l'accent ; le segment unilatéral a un
//     libellé texte explicite ("Bilatéral" / "Unilatéral") et aria-pressed ;
//   - accent violet réservé aux états actifs (chip cochée, segment actif, action
//     primaire) ; tap-targets >= 44px (chips à 36px : densité assumée dans une
//     grille de 15, comme l'éditeur de séance) ;
//   - aucun tiret long affiché.
//
// Validation mutualisée avec la couche data via validatePersonalExercise
// (exercise-input.ts) : une seule source de vérité pour le message.
import { useState } from 'react';
import {
  MUSCLE_GROUPS,
  toggleMuscle,
  validatePersonalExercise,
} from '../authoring/exercise-input';

/** Saisie d'un exo perso : nom, muscles principaux (canoniques), unilatéral. */
export interface ExerciseFormValue {
  name: string;
  primaryMuscles: string[];
  unilateral: boolean;
}

export interface ExerciseFormProps {
  /** Valeurs de départ (édition). Absent = formulaire de création vide. */
  initial?: ExerciseFormValue;
  /** Libellé du bouton primaire (ex. « Créer et ajouter », « Enregistrer »). */
  submitLabel: string;
  /** Libellé pendant l'enregistrement (ex. « Création… », « Enregistrement… »). */
  submitBusyLabel: string;
  /** Soumission validée. Résolu = enregistré (le parent ferme alors le form). */
  onSubmit: (value: ExerciseFormValue) => Promise<void>;
  /** Retour sans enregistrer. */
  onCancel: () => void;
  /** Donne le focus au champ nom au montage (création surtout). Défaut true. */
  autoFocusName?: boolean;
}

export function ExerciseForm({
  initial,
  submitLabel,
  submitBusyLabel,
  onSubmit,
  onCancel,
  autoFocusName = true,
}: ExerciseFormProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [muscles, setMuscles] = useState<string[]>(initial?.primaryMuscles ?? []);
  const [unilateral, setUnilateral] = useState(initial?.unilateral ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = name.trim();
  // validatePersonalExercise renvoie null quand la saisie est valide.
  const canSubmit =
    !busy &&
    validatePersonalExercise({ name: trimmed, primaryMuscles: muscles }) === null;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ name: trimmed, primaryMuscles: muscles, unilateral });
      // Succès : le parent ferme le formulaire, pas de reset nécessaire ici.
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <form
      className="rounded-2xl border border-line bg-surface p-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <input
        type="text"
        value={name}
        placeholder="Nom de l'exercice"
        autoFocus={autoFocusName}
        enterKeyHint="done"
        maxLength={80}
        onChange={(e) => setName(e.target.value)}
        aria-label="Nom de l'exercice"
        className="h-11 w-full rounded-xl border border-line bg-bg px-3 text-base text-ink placeholder:text-ink-muted/85 focus:border-accent focus:outline-none"
      />

      <p className="mt-3 mb-1.5 text-xs font-medium text-ink-muted">Type de mouvement</p>
      <div
        className="inline-flex rounded-lg bg-bg/60 p-0.5"
        role="group"
        aria-label="Type de mouvement"
      >
        <SegButton
          label="Bilatéral"
          active={!unilateral}
          onClick={unilateral ? () => setUnilateral(false) : undefined}
        />
        <SegButton
          label="Unilatéral"
          active={unilateral}
          onClick={unilateral ? undefined : () => setUnilateral(true)}
        />
      </div>

      <p id="exercise-form-muscles" className="mt-3 mb-1.5 text-xs font-medium text-ink-muted">
        Muscles principaux{' '}
        <span className="readout tabular-nums">({muscles.length})</span>
      </p>
      <div
        className="flex flex-wrap gap-1.5"
        role="group"
        aria-labelledby="exercise-form-muscles"
      >
        {MUSCLE_GROUPS.map((m) => {
          const active = muscles.includes(m);
          return (
            <button
              key={m}
              type="button"
              aria-pressed={active}
              onClick={() => setMuscles((prev) => toggleMuscle(prev, m))}
              className={`min-h-[36px] rounded-lg px-2.5 text-xs font-medium transition active:scale-[0.97] ${
                active
                  ? 'bg-accent-strong text-on-accent'
                  : 'bg-bg text-ink-muted active:text-ink'
              }`}
            >
              {active ? `✓ ${m}` : m}
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex h-11 flex-1 items-center justify-center rounded-xl bg-accent-strong px-4 text-sm font-semibold text-on-accent transition active:scale-[0.98] active:bg-accent disabled:opacity-50 disabled:active:scale-100"
        >
          {busy ? submitBusyLabel : submitLabel}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="inline-flex h-11 items-center justify-center rounded-xl px-4 text-sm font-medium text-ink-muted transition active:text-ink disabled:opacity-50"
        >
          Annuler
        </button>
      </div>
      {error && (
        <p className="readout mt-2 break-words text-xs text-warn" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

/** Segment d'un groupe de bascule. Actif en accent ; tap-target >= 44px. */
function SegButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`min-h-[44px] rounded-md px-3 text-xs font-semibold transition ${
        active ? 'bg-accent-strong text-on-accent' : 'text-ink-muted active:text-ink'
      }`}
    >
      {label}
    </button>
  );
}
