// Éditeur de prescriptions d'une séance (ADR 0001 : éditer crée une NOUVELLE
// version, jamais une mutation en place).
//
// Architecture (calquée sur SeancesScreen / AnalysisScreen) : on SÉPARE le
// chargement Supabase de la PRÉSENTATION. `SeanceEditorView` est PUR (props =
// données + callbacks + catalogue) et se monte tel quel dans le harness de
// screenshot, sans réseau. `SeanceEditor` est le conteneur : il charge via
// loadSeanceEditor, mappe vers l'état éditable, et sauvegarde via
// saveSeanceVersion (mapping état -> PrescriptionInput[] dans prescription-edit).
//
// Conventions DESIGN.md tenues ici :
//   - chiffres MESURÉS via le Stepper (jamais de clavier OS) ; readouts en mono.
//   - accent violet parcimonieux : bouton Enregistrer + toggle actif uniquement.
//   - AUCUN tiret long (—) affiché. La fourchette s'écrit avec deux Steppers
//     étiquetés « min » / « max » (pas de séparateur tiret du tout).
//   - info jamais par couleur seule ; tap-targets >= 44px.
//   - <select> natif pour le muscle, <input text> pour nom/recherche (le ban du
//     clavier OS ne vise QUE les chiffres mesurés).
//
// Doublons d'exos : AUTORISÉS. Une séance peut légitimement contenir deux fois le
// même mouvement avec des prescriptions différentes (ex. lourd en début, léger en
// finition). On n'empêche donc pas l'ajout en double ; chaque ligne a sa propre
// identité (rowId) pour rester éditable indépendamment.
import { useEffect, useMemo, useState } from 'react';
import { Stepper } from '../capture/Stepper';
import { listExercises } from '../capture/data';
import type { Database } from '../../lib/database.types';
import { loadSeanceEditor, saveSeanceVersion, createPersonalExercise } from './data';
import {
  type EditorRow,
  type FieldKey,
  type FieldValue,
  FIELD_FLOOR,
  defaultFields,
  rangeToField,
  setMin,
  setMax,
  toggleMode,
  rowsToPrescriptionInputs,
  moveRow,
} from './prescription-edit';

type ExerciseRow = Database['public']['Tables']['exercises']['Row'];

/** Vocabulaire canonique des 15 groupes musculaires (cf. CONTEXT.md). */
const MUSCLE_GROUPS = [
  'pectoraux',
  'avant épaule',
  'milieu épaule',
  'arrière épaule',
  'trapèzes',
  'dorsaux',
  'biceps',
  'triceps',
  'brachioradial',
  'abdominaux',
  'quadriceps',
  'ischio-jambiers',
  'adducteurs',
  'fessiers',
  'mollets',
] as const;

// =====================================================================
// Conteneur : chargement + sauvegarde
// =====================================================================

type Load =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; rows: EditorRow[]; catalogue: ExerciseRow[] };

export interface SeanceEditorProps {
  /** Id de la séance éditée (charge sa version courante, sauve une nouvelle version). */
  seanceId: string;
  /** Nom de la séance (titre). */
  seanceName: string;
  /** Retour à la liste des séances de la routine. */
  onBack: () => void;
}

let rowIdSeq = 0;
function freshRowId(): string {
  rowIdSeq += 1;
  return `row-${rowIdSeq}`;
}

export function SeanceEditor({ seanceId, seanceName, onBack }: SeanceEditorProps) {
  const [load, setLoad] = useState<Load>({ phase: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);

  useEffect(() => {
    let active = true;
    setLoad({ phase: 'loading' });

    void (async () => {
      try {
        // Prescriptions et catalogue sont indépendants : on parallélise.
        const [prescriptions, catalogue] = await Promise.all([
          loadSeanceEditor(seanceId),
          listExercises(),
        ]);
        if (!active) return;
        const rows: EditorRow[] = prescriptions.map((p) => ({
          rowId: freshRowId(),
          exerciseId: p.exerciseId,
          exerciseName: p.exerciseName,
          muscleGroup: p.muscleGroup,
          sets: rangeToField(p.sets),
          reps: rangeToField(p.reps),
          rir: rangeToField(p.rir),
        }));
        setLoad({ phase: 'ready', rows, catalogue });
      } catch (err) {
        if (!active) return;
        setLoad({ phase: 'error', message: errMessage(err) });
      }
    })();

    return () => {
      active = false;
    };
  }, [seanceId, reloadKey]);

  if (load.phase === 'loading') {
    return <ScreenSpinner label="Chargement de la séance" />;
  }

  if (load.phase === 'error') {
    return (
      <ScreenError
        message={load.message}
        intro="Impossible de charger cette séance."
        onRetry={reload}
      />
    );
  }

  return (
    <SeanceEditorView
      seanceName={seanceName}
      initialRows={load.rows}
      catalogue={load.catalogue}
      onBack={onBack}
      onSave={(rows) => saveSeanceVersion(seanceId, rowsToPrescriptionInputs(rows))}
      onCreatePersonal={async (input) => {
        const created = await createPersonalExercise(input);
        return { id: created.id, name: created.name, muscleGroup: created.muscle_group };
      }}
      makeRowId={freshRowId}
    />
  );
}

// =====================================================================
// Présentation pure (montable sans réseau dans le harness)
// =====================================================================

/** Un exo du catalogue, réduit à ce dont la vue a besoin. */
export interface CatalogueExercise {
  id: string;
  name: string;
  muscleGroup: string;
}

export interface SeanceEditorViewProps {
  seanceName: string;
  initialRows: EditorRow[];
  /** Catalogue complet (base + perso) pour le sélecteur d'ajout. */
  catalogue: ExerciseRow[];
  onBack: () => void;
  /** Crée une nouvelle version. Résolu = enregistré. */
  onSave: (rows: EditorRow[]) => Promise<string>;
  /** Crée un exo perso et renvoie sa forme réduite (pour l'ajouter aussitôt). */
  onCreatePersonal: (input: { name: string; muscleGroup: string }) => Promise<CatalogueExercise>;
  /** Fabrique de rowId (injectée pour rester déterministe en test/harness). */
  makeRowId: () => string;
}

export function SeanceEditorView({
  seanceName,
  initialRows,
  catalogue,
  onBack,
  onSave,
  onCreatePersonal,
  makeRowId,
}: SeanceEditorViewProps) {
  const [rows, setRows] = useState<EditorRow[]>(initialRows);
  // Catalogue local : on y ajoute les exos perso créés à la volée, sans recharger.
  const [catalog, setCatalog] = useState<CatalogueExercise[]>(() =>
    catalogue.map((e) => ({ id: e.id, name: e.name, muscleGroup: e.muscle_group })),
  );
  const [adding, setAdding] = useState(false);
  const [save, setSave] = useState<{ busy: boolean; error: string | null; done: boolean }>({
    busy: false,
    error: null,
    done: false,
  });

  function updateRow(rowId: string, key: FieldKey, next: FieldValue) {
    setRows((prev) =>
      prev.map((r) => (r.rowId === rowId ? { ...r, [key]: next } : r)),
    );
  }

  function addExercise(exo: CatalogueExercise) {
    setRows((prev) => [
      ...prev,
      {
        rowId: makeRowId(),
        exerciseId: exo.id,
        exerciseName: exo.name,
        muscleGroup: exo.muscleGroup,
        ...defaultFields(),
      },
    ]);
    setAdding(false);
  }

  async function handleSave() {
    setSave({ busy: true, error: null, done: false });
    try {
      await onSave(rows);
      setSave({ busy: false, error: null, done: true });
      // Laisse la confirmation visible un instant, puis retour.
      window.setTimeout(onBack, 900);
    } catch (err) {
      setSave({ busy: false, error: errMessage(err), done: false });
    }
  }

  const empty = rows.length === 0;

  if (adding) {
    return (
      <AddExerciseSheet
        catalogue={catalog}
        onCancel={() => setAdding(false)}
        onPick={addExercise}
        onCreatePersonal={async (input) => {
          const created = await onCreatePersonal(input);
          setCatalog((prev) => [...prev, created]);
          addExercise(created);
        }}
      />
    );
  }

  return (
    <div className="mx-auto flex min-h-[calc(100vh-3.5rem)] w-full max-w-md flex-col px-4 pb-40 pt-3">
      <BackButton label="Retour aux séances" onClick={onBack} />

      <h2 className="mt-1 text-2xl font-bold leading-tight tracking-tight text-ink">
        {seanceName}
      </h2>
      <p className="mb-4 mt-0.5 text-sm text-ink-muted">
        Exercices prescrits, dans l&apos;ordre. Règle séries, reps et RIR.
      </p>

      {empty ? (
        <EmptyState onAdd={() => setAdding(true)} />
      ) : (
        <>
          <ul className="flex flex-col gap-3">
            {rows.map((row, index) => (
              <li key={row.rowId}>
                <ExerciseRowCard
                  row={row}
                  position={index + 1}
                  isFirst={index === 0}
                  isLast={index === rows.length - 1}
                  onMove={(direction) => setRows((prev) => moveRow(prev, index, direction))}
                  onRemove={() => setRows((prev) => prev.filter((r) => r.rowId !== row.rowId))}
                  onField={(key, next) => updateRow(row.rowId, key, next)}
                />
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={() => setAdding(true)}
            className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-line bg-surface text-base font-medium text-ink transition active:scale-[0.99] active:bg-surface-2"
          >
            <PlusIcon />
            Ajouter un exercice
          </button>
        </>
      )}

      {/* Barre d'enregistrement fixée en bas (One Voice : seul accent fort de l'écran). */}
      <div className="fixed inset-x-0 bottom-14 z-20 border-t border-line bg-bg/95 px-4 py-3 backdrop-blur-sm">
        <div className="mx-auto w-full max-w-md">
          {save.done ? (
            <p
              className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-surface text-base font-semibold text-good"
              role="status"
              aria-live="polite"
            >
              <CheckIcon />
              Séance enregistrée.
            </p>
          ) : (
            <button
              type="button"
              onClick={handleSave}
              disabled={empty || save.busy}
              className="flex h-12 w-full items-center justify-center rounded-2xl bg-accent-strong text-base font-semibold text-on-accent transition active:scale-[0.98] active:bg-accent disabled:cursor-not-allowed disabled:bg-surface disabled:text-ink-muted disabled:active:scale-100"
            >
              {save.busy
                ? 'Enregistrement…'
                : empty
                  ? 'Ajoute au moins un exercice'
                  : 'Enregistrer'}
            </button>
          )}
          {save.error && (
            <p className="readout mt-2 break-words text-xs text-warn" role="alert">
              {save.error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// Carte d'un exo prescrit
// =====================================================================

function ExerciseRowCard({
  row,
  position,
  isFirst,
  isLast,
  onMove,
  onRemove,
  onField,
}: {
  row: EditorRow;
  position: number;
  isFirst: boolean;
  isLast: boolean;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
  onField: (key: FieldKey, next: FieldValue) => void;
}) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-3.5">
      <div className="flex items-start gap-2">
        <span
          className="readout mt-0.5 w-6 shrink-0 text-center text-sm tabular-nums text-ink-muted"
          aria-hidden="true"
        >
          {position}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-base font-semibold text-ink">{row.exerciseName}</span>
          {row.muscleGroup && (
            <span className="mt-0.5 block text-xs text-ink-muted">{row.muscleGroup}</span>
          )}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          <IconButton
            label={`Monter ${row.exerciseName}`}
            disabled={isFirst}
            onClick={() => onMove(-1)}
            icon={<path d="M18 15l-6-6-6 6" />}
          />
          <IconButton
            label={`Descendre ${row.exerciseName}`}
            disabled={isLast}
            onClick={() => onMove(1)}
            icon={<path d="M6 9l6 6 6-6" />}
          />
          <IconButton
            label={`Retirer ${row.exerciseName}`}
            disabled={false}
            onClick={onRemove}
            tone="danger"
            icon={<path d="M6 6l12 12M18 6L6 18" />}
          />
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-3">
        <RangeField
          label="Séries"
          floor={FIELD_FLOOR.sets}
          value={row.sets}
          onChange={(next) => onField('sets', next)}
        />
        <RangeField
          label="Reps"
          floor={FIELD_FLOOR.reps}
          value={row.reps}
          onChange={(next) => onField('reps', next)}
        />
        <RangeField
          label="RIR"
          floor={FIELD_FLOOR.rir}
          value={row.rir}
          onChange={(next) => onField('rir', next)}
        />
      </div>
    </div>
  );
}

// =====================================================================
// Un champ prescriptif : toggle fixe ⇄ fourchette + Stepper(s)
// =====================================================================

function RangeField({
  label,
  floor,
  value,
  onChange,
}: {
  label: string;
  floor: number;
  value: FieldValue;
  onChange: (next: FieldValue) => void;
}) {
  return (
    <div className="rounded-xl bg-surface-2/40 p-3">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-ink">{label}</span>
        <ModeToggle mode={value.mode} onToggle={() => onChange(toggleMode(value))} />
      </div>

      {value.mode === 'fixe' ? (
        <Stepper
          label="Valeur"
          value={value.min}
          step={1}
          min={floor}
          onChange={(n) => onChange(setMin(value, n, floor))}
        />
      ) : (
        // Fourchette : deux Steppers étiquetés « min » / « max ». PAS de tiret
        // long ni de séparateur tiret entre eux (DESIGN.md).
        <div className="grid grid-cols-2 gap-2.5">
          <Stepper
            label="min"
            value={value.min}
            step={1}
            min={floor}
            max={value.max}
            onChange={(n) => onChange(setMin(value, n, floor))}
          />
          <Stepper
            label="max"
            value={value.max}
            step={1}
            min={value.min}
            onChange={(n) => onChange(setMax(value, n, floor))}
          />
        </div>
      )}
    </div>
  );
}

/** Bascule fixe ⇄ fourchette. Segment actif en accent (seul accent de la carte). */
function ModeToggle({ mode, onToggle }: { mode: 'fixe' | 'fourchette'; onToggle: () => void }) {
  return (
    <div
      className="inline-flex rounded-lg bg-bg/60 p-0.5"
      role="group"
      aria-label="Type de prescription"
    >
      <SegButton label="Fixe" active={mode === 'fixe'} onClick={mode === 'fixe' ? undefined : onToggle} />
      <SegButton
        label="Fourchette"
        active={mode === 'fourchette'}
        onClick={mode === 'fourchette' ? undefined : onToggle}
      />
    </div>
  );
}

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
      className={`min-h-[36px] rounded-md px-3 text-xs font-semibold transition ${
        active
          ? 'bg-accent-strong text-on-accent'
          : 'text-ink-muted active:text-ink'
      }`}
    >
      {label}
    </button>
  );
}

// =====================================================================
// Sélecteur d'ajout d'exo : recherche + filtre muscle + créer perso
// =====================================================================

function AddExerciseSheet({
  catalogue,
  onCancel,
  onPick,
  onCreatePersonal,
}: {
  catalogue: CatalogueExercise[];
  onCancel: () => void;
  onPick: (exo: CatalogueExercise) => void;
  onCreatePersonal: (input: { name: string; muscleGroup: string }) => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [muscle, setMuscle] = useState<string>('');
  const [creating, setCreating] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalogue
      .filter((e) => (muscle ? e.muscleGroup === muscle : true))
      .filter((e) => (q ? e.name.toLowerCase().includes(q) : true))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  }, [catalogue, query, muscle]);

  return (
    <div className="mx-auto flex min-h-[calc(100vh-3.5rem)] w-full max-w-md flex-col px-4 pb-8 pt-3">
      <BackButton label="Retour à la séance" onClick={onCancel} />

      <h2 className="mt-1 text-2xl font-bold leading-tight tracking-tight text-ink">
        Ajouter un exercice
      </h2>
      <p className="mb-4 mt-0.5 text-sm text-ink-muted">
        Cherche dans ton catalogue, ou crée un exercice perso.
      </p>

      {creating ? (
        <CreatePersonalForm
          onCancel={() => setCreating(false)}
          onSubmit={onCreatePersonal}
        />
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="mb-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-line bg-surface text-base font-medium text-ink transition active:scale-[0.99] active:bg-surface-2"
        >
          <PlusIcon />
          Créer un exo perso
        </button>
      )}

      {/* Recherche (texte libre : <input> légitime). */}
      <input
        type="text"
        value={query}
        placeholder="Rechercher un exercice"
        enterKeyHint="search"
        onChange={(e) => setQuery(e.target.value)}
        className="h-11 w-full rounded-xl border border-line bg-bg px-3 text-base text-ink placeholder:text-ink-muted/70 focus:border-accent focus:outline-none"
      />

      {/* Filtre muscle : <select> natif (ce n'est pas un chiffre mesuré). */}
      <select
        value={muscle}
        onChange={(e) => setMuscle(e.target.value)}
        aria-label="Filtrer par groupe musculaire"
        className="mt-2.5 h-11 w-full rounded-xl border border-line bg-bg px-3 text-base text-ink focus:border-accent focus:outline-none"
      >
        <option value="">Tous les muscles</option>
        {MUSCLE_GROUPS.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>

      <p className="mt-4 mb-2 text-xs text-ink-muted">
        <span className="readout tabular-nums">{filtered.length}</span>{' '}
        {filtered.length > 1 ? 'exercices' : 'exercice'}
      </p>

      {filtered.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line px-4 py-8 text-center text-sm text-ink-muted">
          Aucun exercice ne correspond. Ajuste ta recherche ou crée un exo perso.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {filtered.map((exo) => (
            <li key={exo.id}>
              <button
                type="button"
                onClick={() => onPick(exo)}
                className="flex min-h-[44px] w-full items-center gap-3 rounded-xl bg-surface px-4 py-3 text-left transition active:scale-[0.99] active:bg-surface-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-base font-medium text-ink">
                    {exo.name}
                  </span>
                  {exo.muscleGroup && (
                    <span className="mt-0.5 block truncate text-xs text-ink-muted">
                      {exo.muscleGroup}
                    </span>
                  )}
                </span>
                <PlusIcon className="shrink-0 text-ink-muted" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Création d'un exo perso : nom (texte) + muscle (select natif). */
function CreatePersonalForm({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (input: { name: string; muscleGroup: string }) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [muscle, setMuscle] = useState<string>(MUSCLE_GROUPS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0 && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ name: trimmed, muscleGroup: muscle });
      // En cas de succès, le parent quitte la sheet : pas de reset nécessaire.
    } catch (err) {
      setError(errMessage(err));
      setBusy(false);
    }
  }

  return (
    <form
      className="mb-4 rounded-2xl border border-line bg-surface p-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <p className="mb-2.5 text-sm font-semibold text-ink">Nouvel exercice perso</p>

      <input
        type="text"
        value={name}
        placeholder="Nom de l'exercice"
        autoFocus
        enterKeyHint="done"
        onChange={(e) => setName(e.target.value)}
        className="h-11 w-full rounded-xl border border-line bg-bg px-3 text-base text-ink placeholder:text-ink-muted/70 focus:border-accent focus:outline-none"
      />

      <label className="mt-2.5 block text-xs font-medium text-ink-muted">
        Groupe musculaire principal
      </label>
      <select
        value={muscle}
        onChange={(e) => setMuscle(e.target.value)}
        className="mt-1 h-11 w-full rounded-xl border border-line bg-bg px-3 text-base text-ink focus:border-accent focus:outline-none"
      >
        {MUSCLE_GROUPS.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex h-11 flex-1 items-center justify-center rounded-xl bg-accent-strong px-4 text-sm font-semibold text-on-accent transition active:scale-[0.98] active:bg-accent disabled:opacity-50 disabled:active:scale-100"
        >
          {busy ? 'Création…' : 'Créer et ajouter'}
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

// =====================================================================
// État vide + primitives
// =====================================================================

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="mt-2 flex flex-col items-center gap-4 rounded-2xl border border-dashed border-line px-6 py-12 text-center">
      <span
        className="flex h-12 w-12 items-center justify-center rounded-full bg-surface text-ink-muted"
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 24 24"
          width="22"
          height="22"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 6h16M4 12h16M4 18h10" />
        </svg>
      </span>
      <p className="text-sm text-ink-muted">
        Aucun exercice prescrit. Ajoute le premier exercice de cette séance.
      </p>
      <button
        type="button"
        onClick={onAdd}
        className="inline-flex h-11 items-center gap-2 rounded-xl bg-accent-strong px-5 text-sm font-semibold text-on-accent transition active:scale-[0.98] active:bg-accent"
      >
        <PlusIcon />
        Ajouter un exercice
      </button>
    </div>
  );
}

function IconButton({
  label,
  disabled,
  onClick,
  icon,
  tone = 'neutral',
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  tone?: 'neutral' | 'danger';
}) {
  const toneClass = tone === 'danger' ? 'active:text-warn' : 'active:text-ink';
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-11 w-11 items-center justify-center rounded-lg text-ink-muted transition active:bg-surface-2 disabled:opacity-30 disabled:active:bg-transparent ${toneClass}`}
    >
      <svg
        viewBox="0 0 24 24"
        width="20"
        height="20"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {icon}
      </svg>
    </button>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

function BackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="-ml-1 inline-flex items-center gap-1.5 self-start rounded-lg py-2 pr-3 text-sm font-medium text-ink-muted transition active:text-ink"
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
      {label}
    </button>
  );
}

function ScreenSpinner({ label }: { label: string }) {
  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center">
      <div
        className="h-6 w-6 animate-spin rounded-full border-2 border-line border-t-accent"
        role="status"
        aria-label={label}
      />
    </div>
  );
}

function ScreenError({
  message,
  intro,
  onRetry,
}: {
  message: string;
  intro: string;
  onRetry: () => void;
}) {
  return (
    <div className="mx-auto flex min-h-[calc(100vh-3.5rem)] w-full max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-sm text-ink-muted">{intro}</p>
      <p className="readout max-w-full break-words text-xs text-warn">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex h-11 items-center rounded-xl bg-accent-strong px-5 text-sm font-semibold text-on-accent transition active:scale-[0.98] active:bg-accent"
      >
        Réessayer
      </button>
    </div>
  );
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
