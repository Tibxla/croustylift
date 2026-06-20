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
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-[30px] pb-8 pt-12">
      {/* Progression d'entrée : on amorce le parcours (routine → séance). Le 1ᵉʳ
          segment porte la « voix » accent (glow discret), le 2ᵉ reste en palier. */}
      <div className="mb-[30px] flex gap-1.5" aria-hidden="true">
        <span className="h-1 flex-1 rounded-full bg-accent shadow-[0_0_10px_var(--color-accent-soft)]" />
        <span className="h-1 flex-1 rounded-full bg-surface-2" />
      </div>

      <h1 className="text-[33px] font-semibold leading-[1.08] tracking-[-0.025em] text-ink">
        Crée ta première routine.
      </h1>
      <p className="mt-3.5 text-[15px] leading-[1.5] text-ink-muted">
        Une routine regroupe les séances que tu tournes. Tu pourras tout ajuster après.
      </p>

      <form
        className="mt-8 flex flex-1 flex-col"
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
          onChange={setRoutineName}
        />

        <div className="mt-5">
          <Field
            id="seance-name"
            label="Première séance"
            value={seanceName}
            placeholder="Nom de la séance"
            autoFocus
            onChange={setSeanceName}
          />
        </div>

        <fieldset className="mt-7">
          <legend className="mb-3 block text-xs font-medium uppercase tracking-[0.04em] text-ink-faint">
            Point de départ
          </legend>
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
              subtitle="Tu ajoutes les exercices et leurs prescriptions juste après, dans l’onglet Séances."
              onSelect={() => setWithTemplate(false)}
            />
          </div>
        </fieldset>

        {error && (
          <p className="mt-4 break-words text-xs text-warn" role="alert">
            {error}
          </p>
        )}

        <div className="mt-auto pt-8">
          <button
            type="submit"
            disabled={!canSubmit}
            className="btn btn-primary h-14 w-full rounded-2xl text-[17px]"
          >
            {busy ? 'Création…' : 'Créer ma routine'}
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
      <span className="mb-2 block text-xs font-medium uppercase tracking-[0.04em] text-ink-faint">
        {label}
      </span>
      <input
        id={id}
        type="text"
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        enterKeyHint="next"
        onChange={(e) => onChange(e.target.value)}
        className="field h-[54px] w-full rounded-[14px] px-4 text-[17px] font-medium"
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
      className={`panel flex items-center gap-3 rounded-2xl p-4 text-left transition active:scale-[0.99] ${
        selected
          ? 'border-accent bg-[linear-gradient(160deg,var(--color-accent-soft),transparent)]'
          : ''
      }`}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-base font-semibold text-ink">{title}</span>
        <span className="mt-1 block text-[13px] leading-[1.45] text-ink-muted">{subtitle}</span>
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
        selected ? 'border-accent bg-accent-strong text-on-accent' : 'border-hair-strong text-transparent'
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
