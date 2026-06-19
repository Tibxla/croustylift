// Surface « Séances » : gestion des routines et de leurs séances (authoring).
//
// Architecture (calquée sur AnalysisScreen) : on SÉPARE le chargement Supabase
// de la PRÉSENTATION. `RoutinesView` et `SeancesView` sont des composants PURS
// (props : données + callbacks) qui se montent tels quels dans le harness de
// screenshot, sans réseau ni user de test. `SeancesScreen` est le conteneur :
// il charge, mute, recharge, et porte la navigation routines <-> séances en
// state local (routine sélectionnée), sans lib de routing (deux vues suffisent,
// l'éditeur d'une séance est une troisième vue locale).
//
// Conventions DESIGN.md tenues ici :
//   - accent violet parcimonieux : action primaire + badge « courante » + (la nav
//     active vit dans App.tsx). Le reste est neutre.
//   - statut « courante » = couleur + MOT, jamais la couleur seule.
//   - aucun tiret long (—) dans le texte affiché ; point ou virgule.
//   - tap-targets >= 44px, confirmations de suppression INLINE (pas de
//     window.confirm), édition des noms INLINE.
import { useEffect, useState } from 'react';
import type { Database } from '../../lib/database.types';
import {
  listRoutines,
  createRoutine,
  renameRoutine,
  deleteRoutine,
  setCurrentRoutine,
  getCurrentRoutineId,
  listSeances,
  createSeance,
  renameSeance,
  deleteSeance,
  reorderSeances,
} from './data';
import { SeanceEditor } from './SeanceEditor';
import { ExportButton } from '../export/ExportButton';
import { ImportButton } from '../export/ImportButton';

type RoutineRow = Database['public']['Tables']['routines']['Row'];
type SeanceRow = Database['public']['Tables']['seances']['Row'];

// =====================================================================
// Conteneur : chargement + mutations + navigation locale
// =====================================================================

type RoutinesLoad =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; routines: RoutineRow[]; currentRoutineId: string | null };

type SeancesLoad =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; seances: SeanceRow[] };

/** Où l'utilisateur se trouve dans l'arbre routines -> séances -> éditeur. */
type View =
  | { kind: 'routines' }
  | { kind: 'seances'; routine: RoutineRow }
  | { kind: 'editor'; routine: RoutineRow; seance: SeanceRow };

export function SeancesScreen() {
  const [view, setView] = useState<View>({ kind: 'routines' });

  if (view.kind === 'editor') {
    return (
      <SeanceEditor
        seanceId={view.seance.id}
        seanceName={view.seance.name}
        onBack={() => setView({ kind: 'seances', routine: view.routine })}
      />
    );
  }

  if (view.kind === 'seances') {
    return (
      <SeancesContainer
        routine={view.routine}
        onBack={() => setView({ kind: 'routines' })}
        onEdit={(seance) => setView({ kind: 'editor', routine: view.routine, seance })}
      />
    );
  }

  return (
    <RoutinesContainer onOpen={(routine) => setView({ kind: 'seances', routine })} />
  );
}

// --- Conteneur Routines -----------------------------------------------------

function RoutinesContainer({ onOpen }: { onOpen: (routine: RoutineRow) => void }) {
  const [load, setLoad] = useState<RoutinesLoad>({ phase: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);

  useEffect(() => {
    let active = true;
    // Loader au 1er chargement seulement ; un rafraîchissement (reload() après
    // un save) garde le contenu monté → pas de saut de scroll en haut.
    if (reloadKey === 0) setLoad({ phase: 'loading' });

    void (async () => {
      try {
        // Les deux lectures sont indépendantes : on les parallélise.
        const [routines, currentRoutineId] = await Promise.all([
          listRoutines(),
          getCurrentRoutineId(),
        ]);
        if (!active) return;
        setLoad({ phase: 'ready', routines, currentRoutineId });
      } catch (err) {
        if (!active) return;
        setLoad({ phase: 'error', message: errMessage(err) });
      }
    })();

    return () => {
      active = false;
    };
  }, [reloadKey]);

  if (load.phase === 'loading') {
    return <ScreenSpinner label="Chargement des routines" />;
  }

  if (load.phase === 'error') {
    return (
      <ScreenError
        message={load.message}
        intro="Impossible de charger tes routines."
        onRetry={reload}
      />
    );
  }

  return (
    <RoutinesView
      routines={load.routines}
      currentRoutineId={load.currentRoutineId}
      onOpen={onOpen}
      onCreate={async (name) => {
        await createRoutine({ name });
        reload();
      }}
      onRename={async (id, name) => {
        await renameRoutine(id, name);
        reload();
      }}
      onDelete={async (id) => {
        await deleteRoutine(id);
        reload();
      }}
      onSetCurrent={async (id) => {
        await setCurrentRoutine(id);
        reload();
      }}
    />
  );
}

// --- Conteneur Séances d'une routine ----------------------------------------

function SeancesContainer({
  routine,
  onBack,
  onEdit,
}: {
  routine: RoutineRow;
  onBack: () => void;
  onEdit: (seance: SeanceRow) => void;
}) {
  const [load, setLoad] = useState<SeancesLoad>({ phase: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);

  useEffect(() => {
    let active = true;
    // Loader au 1er chargement seulement ; un rafraîchissement (reload() après
    // un save) garde le contenu monté → pas de saut de scroll en haut.
    if (reloadKey === 0) setLoad({ phase: 'loading' });

    void (async () => {
      try {
        const seances = await listSeances(routine.id);
        if (!active) return;
        setLoad({ phase: 'ready', seances });
      } catch (err) {
        if (!active) return;
        setLoad({ phase: 'error', message: errMessage(err) });
      }
    })();

    return () => {
      active = false;
    };
  }, [reloadKey, routine.id]);

  if (load.phase === 'loading') {
    return <ScreenSpinner label="Chargement des séances" />;
  }

  if (load.phase === 'error') {
    return (
      <ScreenError
        message={load.message}
        intro="Impossible de charger les séances."
        onRetry={reload}
      />
    );
  }

  return (
    <SeancesView
      routineName={routine.name}
      seances={load.seances}
      onBack={onBack}
      onEdit={onEdit}
      onCreate={async (name) => {
        await createSeance(routine.id, { name });
        reload();
      }}
      onRename={async (id, name) => {
        await renameSeance(id, name);
        reload();
      }}
      onDelete={async (id) => {
        await deleteSeance(id);
        reload();
      }}
      onReorder={async (orderedIds) => {
        await reorderSeances(routine.id, orderedIds);
        reload();
      }}
    />
  );
}

// =====================================================================
// Présentation pure (montable sans réseau dans le harness)
// =====================================================================

// Les callbacks renvoient une Promise : les sous-composants attendent la
// résolution avant de quitter l'état d'édition / de confirmation, ce qui couvre
// loading/error au niveau de l'action sans recharger toute la vue.

export interface RoutinesViewProps {
  routines: RoutineRow[];
  currentRoutineId: string | null;
  onOpen: (routine: RoutineRow) => void;
  onCreate: (name: string) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onSetCurrent: (id: string) => Promise<void>;
}

export function RoutinesView({
  routines,
  currentRoutineId,
  onOpen,
  onCreate,
  onRename,
  onDelete,
  onSetCurrent,
}: RoutinesViewProps) {
  const [creating, setCreating] = useState(false);

  return (
    <div className="mx-auto w-full max-w-md px-4 pb-8 pt-5">
      <h2 className="mb-1 text-2xl font-bold tracking-tight">Routines</h2>
      <p className="mb-4 text-sm text-ink-muted">
        Tes programmes. Choisis ta routine courante, ouvre une routine pour gérer ses
        séances.
      </p>

      {routines.length === 0 && !creating ? (
        <EmptyState
          message="Aucune routine. Crée ta première routine."
          actionLabel="Créer une routine"
          onAction={() => setCreating(true)}
        />
      ) : (
        <>
          <ul className="flex flex-col gap-2.5">
            {routines.map((routine) => (
              <li key={routine.id}>
                <RoutineRowItem
                  routine={routine}
                  isCurrent={routine.id === currentRoutineId}
                  onOpen={() => onOpen(routine)}
                  onRename={(name) => onRename(routine.id, name)}
                  onDelete={() => onDelete(routine.id)}
                  onSetCurrent={() => onSetCurrent(routine.id)}
                />
              </li>
            ))}
          </ul>

          <div className="mt-4">
            {creating ? (
              <CreateForm
                placeholder="Nom de la routine"
                submitLabel="Créer"
                onSubmit={async (name) => {
                  await onCreate(name);
                  setCreating(false);
                }}
                onCancel={() => setCreating(false)}
              />
            ) : (
              <PrimaryAddButton label="Créer une routine" onClick={() => setCreating(true)} />
            )}
          </div>
        </>
      )}

      <DataSection />
    </div>
  );
}

/**
 * Section « Données » : backup JSON de tout le compte (issue #8). Discrète, en
 * bas de l'écran d'accueil des routines : c'est l'endroit « au calme » naturel
 * pour exporter, sans alourdir la capture en salle.
 */
function DataSection() {
  return (
    <section className="mt-8 border-t border-line pt-5">
      <h3 className="mb-1 text-sm font-semibold tracking-tight text-ink">Données</h3>
      <p className="mb-3 text-sm text-ink-muted">
        Télécharge une sauvegarde JSON de tes exos perso, routines, séances et historique.
        Garde-la en cas de perte du stockage local. Pour restaurer, importe le fichier
        de sauvegarde.
      </p>
      <div className="flex flex-col gap-2.5">
        <ExportButton />
        <ImportButton />
      </div>
    </section>
  );
}

/** Une routine : nom + badge courante, et actions (étendues à la demande). */
function RoutineRowItem({
  routine,
  isCurrent,
  onOpen,
  onRename,
  onDelete,
  onSetCurrent,
}: {
  routine: RoutineRow;
  isCurrent: boolean;
  onOpen: () => void;
  onRename: (name: string) => Promise<void>;
  onDelete: () => Promise<void>;
  onSetCurrent: () => Promise<void>;
}) {
  const [mode, setMode] = useState<'idle' | 'rename' | 'confirmDelete'>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errMessage(err));
      setBusy(false);
    }
    // En cas de succès, la vue parente recharge et démonte ce composant : pas de
    // setBusy(false) nécessaire (et il provoquerait un warning si déjà démonté).
  }

  if (mode === 'rename') {
    return (
      <RowCard>
        <InlineNameForm
          initial={routine.name}
          submitLabel="Renommer"
          onSubmit={(name) => run(() => onRename(name))}
          onCancel={() => setMode('idle')}
          busy={busy}
          error={error}
        />
      </RowCard>
    );
  }

  return (
    <RowCard>
      <div className="flex items-center gap-2">
        {/* Le nom est cliquable : il ouvre les séances de la routine. */}
        <button
          type="button"
          onClick={onOpen}
          className="flex min-h-[44px] min-w-0 flex-1 items-center gap-2 rounded-lg py-1 text-left transition active:opacity-80"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-base font-medium text-ink">
              {routine.name}
            </span>
            {isCurrent && <CurrentBadge />}
          </span>
          <Chevron />
        </button>
      </div>

      {mode === 'confirmDelete' ? (
        <ConfirmDelete
          question="Supprimer cette routine et ses séances ?"
          busy={busy}
          error={error}
          onConfirm={() => run(onDelete)}
          onCancel={() => setMode('idle')}
        />
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {isCurrent ? (
            <span className="inline-flex h-9 items-center px-1 text-xs text-ink-muted">
              Routine courante.
            </span>
          ) : (
            <RowAction
              label="Définir courante"
              busy={busy}
              onClick={() => run(onSetCurrent)}
            />
          )}
          <RowAction label="Renommer" onClick={() => setMode('rename')} />
          <RowAction label="Supprimer" tone="danger" onClick={() => setMode('confirmDelete')} />
        </div>
      )}

      {error && mode === 'idle' && <RowError message={error} />}
    </RowCard>
  );
}

// --- Vue Séances d'une routine ----------------------------------------------

export interface SeancesViewProps {
  routineName: string;
  seances: SeanceRow[];
  onBack: () => void;
  onEdit: (seance: SeanceRow) => void;
  onCreate: (name: string) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onReorder: (orderedIds: string[]) => Promise<void>;
}

export function SeancesView({
  routineName,
  seances,
  onBack,
  onEdit,
  onCreate,
  onRename,
  onDelete,
  onReorder,
}: SeancesViewProps) {
  const [creating, setCreating] = useState(false);

  function moveSeance(index: number, direction: -1 | 1): Promise<void> {
    const target = index + direction;
    if (target < 0 || target >= seances.length) return Promise.resolve();
    const orderedIds = seances.map((s) => s.id);
    [orderedIds[index], orderedIds[target]] = [orderedIds[target], orderedIds[index]];
    return onReorder(orderedIds);
  }

  return (
    <div className="mx-auto w-full max-w-md px-4 pb-8 pt-3">
      <BackButton label="Retour aux routines" onClick={onBack} />

      <h2 className="mt-1 text-2xl font-bold tracking-tight">{routineName}</h2>
      <p className="mb-4 text-sm text-ink-muted">Séances de cette routine, dans l'ordre.</p>

      {seances.length === 0 && !creating ? (
        <EmptyState
          message="Aucune séance. Ajoute la première séance de cette routine."
          actionLabel="Créer une séance"
          onAction={() => setCreating(true)}
        />
      ) : (
        <>
          <ul className="flex flex-col gap-2.5">
            {seances.map((seance, index) => (
              <li key={seance.id}>
                <SeanceRowItem
                  seance={seance}
                  index={index}
                  isFirst={index === 0}
                  isLast={index === seances.length - 1}
                  onEdit={() => onEdit(seance)}
                  onMove={(direction) => moveSeance(index, direction)}
                  onRename={(name) => onRename(seance.id, name)}
                  onDelete={() => onDelete(seance.id)}
                />
              </li>
            ))}
          </ul>

          <div className="mt-4">
            {creating ? (
              <CreateForm
                placeholder="Nom de la séance"
                submitLabel="Créer"
                onSubmit={async (name) => {
                  await onCreate(name);
                  setCreating(false);
                }}
                onCancel={() => setCreating(false)}
              />
            ) : (
              <PrimaryAddButton label="Créer une séance" onClick={() => setCreating(true)} />
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** Une séance : nom, réordonnancement, et actions. Position en readout mono. */
function SeanceRowItem({
  seance,
  index,
  isFirst,
  isLast,
  onEdit,
  onMove,
  onRename,
  onDelete,
}: {
  seance: SeanceRow;
  index: number;
  isFirst: boolean;
  isLast: boolean;
  onEdit: () => void;
  onMove: (direction: -1 | 1) => Promise<void>;
  onRename: (name: string) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [mode, setMode] = useState<'idle' | 'rename' | 'confirmDelete'>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errMessage(err));
      setBusy(false);
    }
  }

  if (mode === 'rename') {
    return (
      <RowCard>
        <InlineNameForm
          initial={seance.name}
          submitLabel="Renommer"
          onSubmit={(name) => run(() => onRename(name))}
          onCancel={() => setMode('idle')}
          busy={busy}
          error={error}
        />
      </RowCard>
    );
  }

  return (
    <RowCard>
      <div className="flex items-center gap-2">
        <span
          className="readout w-6 shrink-0 text-center text-sm tabular-nums text-ink-muted"
          aria-hidden="true"
        >
          {index + 1}
        </span>
        <span className="min-w-0 flex-1 truncate text-base font-medium text-ink">
          {seance.name}
        </span>
        <ReorderControls
          isFirst={isFirst}
          isLast={isLast}
          busy={busy}
          onUp={() => run(() => onMove(-1))}
          onDown={() => run(() => onMove(1))}
        />
      </div>

      {mode === 'confirmDelete' ? (
        <ConfirmDelete
          question="Supprimer cette séance ?"
          busy={busy}
          error={error}
          onConfirm={() => run(onDelete)}
          onCancel={() => setMode('idle')}
        />
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <RowAction label="Éditer" tone="accent" onClick={onEdit} />
          <RowAction label="Renommer" onClick={() => setMode('rename')} />
          <RowAction label="Supprimer" tone="danger" onClick={() => setMode('confirmDelete')} />
        </div>
      )}

      {error && mode === 'idle' && <RowError message={error} />}
    </RowCard>
  );
}

// =====================================================================
// Primitives partagées
// =====================================================================

/** Badge « courante » : couleur (accent) ET mot, jamais la couleur seule. */
function CurrentBadge() {
  return (
    <span className="mt-1 inline-flex items-center gap-1 rounded-md border border-accent/40 px-1.5 py-0.5 text-xs font-medium text-accent-ink">
      <svg
        viewBox="0 0 24 24"
        width="12"
        height="12"
        fill="currentColor"
        stroke="none"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="6" />
      </svg>
      Courante
    </span>
  );
}

function RowCard({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-line bg-surface p-3.5">{children}</div>;
}

/** Action secondaire d'une ligne. Neutre par défaut ; accent ou danger au besoin. */
function RowAction({
  label,
  onClick,
  tone = 'neutral',
  busy = false,
}: {
  label: string;
  onClick: () => void;
  tone?: 'neutral' | 'accent' | 'danger';
  busy?: boolean;
}) {
  const toneClass =
    tone === 'accent'
      ? 'text-accent-ink'
      : tone === 'danger'
        ? 'text-warn'
        : 'text-ink-muted active:text-ink';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={`inline-flex h-9 min-h-[44px] items-center rounded-lg bg-surface-2/60 px-3 text-sm font-medium transition active:scale-[0.98] disabled:opacity-50 ${toneClass}`}
    >
      {label}
    </button>
  );
}

function RowError({ message }: { message: string }) {
  return (
    <p className="mt-2 break-words text-xs text-warn" role="alert">
      {message}
    </p>
  );
}

/** Flèches haut/bas de réordonnancement. Désactivées aux extrémités. */
function ReorderControls({
  isFirst,
  isLast,
  busy,
  onUp,
  onDown,
}: {
  isFirst: boolean;
  isLast: boolean;
  busy: boolean;
  onUp: () => void;
  onDown: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <IconButton
        label="Monter"
        disabled={isFirst || busy}
        onClick={onUp}
        icon={<path d="M18 15l-6-6-6 6" />}
      />
      <IconButton
        label="Descendre"
        disabled={isLast || busy}
        onClick={onDown}
        icon={<path d="M6 9l6 6 6-6" />}
      />
    </div>
  );
}

function IconButton({
  label,
  disabled,
  onClick,
  icon,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-11 w-11 items-center justify-center rounded-lg text-ink-muted transition active:bg-surface-2 active:text-ink disabled:opacity-30 disabled:active:bg-transparent"
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

function Chevron() {
  return (
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
      className="shrink-0 text-ink-muted"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

/** Confirmation de suppression INLINE (pas de window.confirm, cf. brief). */
function ConfirmDelete({
  question,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  question: string;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="mt-2 rounded-xl bg-surface-2/60 p-3">
      <p className="text-sm text-ink">{question}</p>
      <p className="mt-0.5 text-xs text-ink-muted">Cette action est définitive.</p>
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onConfirm}
          className="inline-flex h-11 flex-1 items-center justify-center rounded-xl bg-warn px-4 text-sm font-semibold text-bg transition active:scale-[0.98] disabled:opacity-50"
        >
          {busy ? 'Suppression…' : 'Supprimer'}
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
      {error && <RowError message={error} />}
    </div>
  );
}

/**
 * Formulaire de saisie d'un nom (texte libre, donc <input> légitime : le ban du
 * clavier OS de DESIGN.md vise les chiffres mesurés, pas les noms). Réutilisé
 * pour la création et le renommage inline.
 */
function InlineNameForm({
  initial = '',
  placeholder,
  submitLabel,
  onSubmit,
  onCancel,
  busy = false,
  error = null,
}: {
  initial?: string;
  placeholder?: string;
  submitLabel: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
  busy?: boolean;
  error?: string | null;
}) {
  const [value, setValue] = useState(initial);
  const trimmed = value.trim();
  const canSubmit = trimmed.length > 0 && !busy;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) onSubmit(trimmed);
      }}
    >
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        autoFocus
        enterKeyHint="done"
        maxLength={80}
        onChange={(e) => setValue(e.target.value)}
        className="h-11 w-full rounded-xl border border-line bg-bg px-3 text-base text-ink placeholder:text-ink-muted/85 focus:border-accent focus:outline-none"
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex h-11 flex-1 items-center justify-center rounded-xl bg-accent-strong px-4 text-sm font-semibold text-on-accent transition active:scale-[0.98] active:bg-accent disabled:opacity-50 disabled:active:scale-100"
        >
          {busy ? 'Enregistrement…' : submitLabel}
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
      {error && <RowError message={error} />}
    </form>
  );
}

/** Formulaire de création (encadré, dans un RowCard) avec gestion d'erreur. */
function CreateForm({
  placeholder,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  placeholder: string;
  submitLabel: string;
  onSubmit: (name: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <RowCard>
      <InlineNameForm
        placeholder={placeholder}
        submitLabel={submitLabel}
        busy={busy}
        error={error}
        onCancel={onCancel}
        onSubmit={async (name) => {
          setBusy(true);
          setError(null);
          try {
            await onSubmit(name);
          } catch (err) {
            setError(errMessage(err));
            setBusy(false);
          }
        }}
      />
    </RowCard>
  );
}

/** Bouton d'action primaire « + Créer… » pleine largeur (accent violet). */
function PrimaryAddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-accent-strong text-base font-semibold text-on-accent transition active:scale-[0.98] active:bg-accent"
    >
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
        <path d="M12 5v14M5 12h14" />
      </svg>
      {label}
    </button>
  );
}

/** État vide : message + action primaire de création. */
function EmptyState({
  message,
  actionLabel,
  onAction,
}: {
  message: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div className="mt-2 flex flex-col items-center gap-4 rounded-2xl border border-dashed border-line px-6 py-10 text-center">
      <p className="text-sm text-ink-muted">{message}</p>
      <button
        type="button"
        onClick={onAction}
        className="inline-flex h-11 items-center rounded-xl bg-accent-strong px-5 text-sm font-semibold text-on-accent transition active:scale-[0.98] active:bg-accent"
      >
        {actionLabel}
      </button>
    </div>
  );
}

function BackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="-ml-1 inline-flex min-h-[44px] items-center gap-1.5 self-start rounded-lg py-2 pr-3 text-sm font-medium text-ink-muted transition active:text-ink"
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
    <div
      className="mx-auto w-full max-w-md px-4 pt-5"
      role="status"
      aria-label={label}
    >
      {/* Squelette : titre + 2-3 cartes simulant des lignes de liste. */}
      <div className="mb-4 h-7 w-40 rounded-lg bg-surface-2 animate-pulse" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="mb-2.5 rounded-2xl border border-line bg-surface p-3.5">
          <div className="flex items-center gap-2">
            <div className="h-5 w-5 shrink-0 rounded bg-surface-2 animate-pulse" />
            <div className="h-4 flex-1 rounded bg-surface-2 animate-pulse" />
          </div>
          <div className="mt-3 flex gap-2">
            <div className="h-8 w-24 rounded-lg bg-surface-2 animate-pulse" />
            <div className="h-8 w-20 rounded-lg bg-surface-2 animate-pulse" />
          </div>
        </div>
      ))}
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
