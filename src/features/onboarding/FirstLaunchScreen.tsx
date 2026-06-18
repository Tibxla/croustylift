// Écran de premier lancement.
//
// Affiché à un utilisateur SANS routine (cf. App.tsx). Remplace l'ancienne
// création silencieuse de « Ma routine » / « Upper A » : ici l'utilisateur NOMME
// sa 1ʳᵉ routine et sa 1ʳᵉ séance, et choisit de partir d'un modèle pré-rempli
// (renommable) ou d'une séance vierge. Lève la confusion « je n'ai pas pu nommer
// ma routine » (issue #3).
//
// Conventions DESIGN.md tenues : fond sombre, accent violet parcimonieux (un seul
// bouton primaire), tap-targets >= 44px, aucun tiret long (—) dans le texte, pas
// de clavier custom (les noms sont du texte libre, <input> légitime).
import { useState } from 'react';
import {
  createFirstRoutine,
  DEFAULT_ROUTINE_NAME,
  STARTER_TEMPLATE,
  type FirstRoutineResult,
} from './data';

/** Présentation pure (montable sans réseau) : la création est injectée. */
export interface FirstLaunchViewProps {
  /** Crée la 1ʳᵉ routine + séance. Rejette en cas d'échec (affiché inline). */
  onCreate: (input: {
    routineName: string;
    seanceName: string;
    withTemplate: boolean;
  }) => Promise<void>;
}

export function FirstLaunchView({ onCreate }: FirstLaunchViewProps) {
  const [routineName, setRoutineName] = useState(DEFAULT_ROUTINE_NAME);
  const [seanceName, setSeanceName] = useState(STARTER_TEMPLATE.seanceName);
  const [withTemplate, setWithTemplate] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const routineTrimmed = routineName.trim();
  const seanceTrimmed = seanceName.trim();
  const canSubmit = routineTrimmed.length > 0 && seanceTrimmed.length > 0 && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate({
        routineName: routineTrimmed,
        seanceName: seanceTrimmed,
        withTemplate,
      });
      // En cas de succès, App recharge et démonte cet écran : pas de reset d'état.
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[calc(100vh-3.5rem)] w-full max-w-md flex-col px-4 pb-8 pt-8">
      <h2 className="text-xl font-semibold tracking-tight text-ink">Bienvenue.</h2>
      <p className="mt-1.5 text-sm text-ink-muted">
        Crée ta première routine et ta première séance. Tu pourras tout renommer et
        ajuster ensuite.
      </p>

      <form
        className="mt-6 flex flex-1 flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field
          id="routine-name"
          label="Nom de la routine"
          value={routineName}
          placeholder="Nom de la routine"
          autoFocus
          onChange={setRoutineName}
        />

        <div className="mt-4">
          <Field
            id="seance-name"
            label="Nom de la première séance"
            value={seanceName}
            placeholder="Nom de la séance"
            onChange={setSeanceName}
          />
        </div>

        <fieldset className="mt-6">
          <legend className="text-sm font-medium text-ink">Point de départ</legend>
          <p className="mt-0.5 mb-2.5 text-xs text-ink-muted">
            Tu pourras modifier les exercices à tout moment.
          </p>
          <div className="flex flex-col gap-2.5">
            <ChoiceCard
              selected={withTemplate}
              title="Modèle de départ"
              subtitle={`Séance pré-remplie avec ${STARTER_TEMPLATE.exercises.length} exercices de base.`}
              onSelect={() => setWithTemplate(true)}
            />
            <ChoiceCard
              selected={!withTemplate}
              title="Séance vierge"
              subtitle="Tu ajoutes tes exercices toi-même."
              onSelect={() => setWithTemplate(false)}
            />
          </div>
        </fieldset>

        {error && (
          <p className="readout mt-4 break-words text-xs text-warn" role="alert">
            {error}
          </p>
        )}

        <div className="mt-8">
          <button
            type="submit"
            disabled={!canSubmit}
            className="flex h-14 w-full items-center justify-center rounded-2xl bg-accent-strong text-base font-semibold text-on-accent transition active:scale-[0.98] active:bg-accent disabled:opacity-50 disabled:active:scale-100"
          >
            {busy ? 'Création…' : 'Commencer'}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * Conteneur : branche la présentation sur la création réelle (réseau). C'est ce
 * que monte App. `onCreated` est rappelé après succès pour recharger l'app et
 * basculer sur la capture.
 */
export function FirstLaunchScreen({
  onCreated,
}: {
  onCreated: (result: FirstRoutineResult) => void;
}) {
  return (
    <FirstLaunchView
      onCreate={async (input) => {
        const result = await createFirstRoutine(input);
        onCreated(result);
      }}
    />
  );
}

// --- Primitives locales -----------------------------------------------------

/**
 * Un champ texte libre (nom). Le ban du clavier OS de DESIGN.md vise les CHIFFRES
 * mesurés, pas les noms : un <input> texte est légitime ici (cf. SeancesScreen).
 */
function Field({
  id,
  label,
  value,
  placeholder,
  autoFocus = false,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  autoFocus?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label htmlFor={id} className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink">{label}</span>
      <input
        id={id}
        type="text"
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        enterKeyHint="next"
        onChange={(e) => onChange(e.target.value)}
        className="h-11 w-full rounded-xl border border-line bg-bg px-3 text-base text-ink placeholder:text-ink-muted/70 focus:border-accent focus:outline-none"
      />
    </label>
  );
}

/**
 * Une carte de choix (modèle vs vierge). État sélectionné porté par couleur ET
 * coche, jamais par la couleur seule (DESIGN.md). Tap-target pleine carte.
 */
function ChoiceCard({
  selected,
  title,
  subtitle,
  onSelect,
}: {
  selected: boolean;
  title: string;
  subtitle: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex items-center gap-3 rounded-2xl border p-3.5 text-left transition active:scale-[0.99] ${
        selected ? 'border-accent bg-surface' : 'border-line bg-surface'
      }`}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-base font-medium text-ink">{title}</span>
        <span className="mt-0.5 block text-xs text-ink-muted">{subtitle}</span>
      </span>
      <CheckMark selected={selected} />
    </button>
  );
}

/** Indicateur de sélection : un cercle qui se remplit d'accent + coche. */
function CheckMark({ selected }: { selected: boolean }) {
  return (
    <span
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition ${
        selected ? 'border-accent bg-accent-strong text-on-accent' : 'border-line text-transparent'
      }`}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 24 24"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M5 13l4 4L19 7" />
      </svg>
    </span>
  );
}
