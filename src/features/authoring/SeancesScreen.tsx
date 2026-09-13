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
  archiveRoutine,
  unarchiveRoutine,
  archiveSeance,
  unarchiveSeance,
  loadPlanHistory,
  setCurrentRoutine,
  getCurrentRoutineId,
  listSeances,
  createSeance,
  renameSeance,
  deleteSeance,
  reorderSeances,
  duplicateSeance,
  loadSeanceCatalog,
  type SeanceCatalogEntry,
} from './data';
import { SeanceEditor } from './SeanceEditor';
import { nextFreeName } from '../../domain/unique-name';
import { planRowActions } from './archive';
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
  | {
      phase: 'ready';
      routines: RoutineRow[];
      currentRoutineId: string | null;
      executedRoutineIds: Set<string>;
    };

type SeancesLoad =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | {
      phase: 'ready';
      seances: SeanceRow[];
      catalog: SeanceCatalogEntry[];
      executedSeanceIds: Set<string>;
    };

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
        const [routines, currentRoutineId, history] = await Promise.all([
          listRoutines(),
          getCurrentRoutineId(),
          // Ce qui a déjà été exécuté s'archive au lieu de se supprimer (ADR 0017).
          loadPlanHistory(),
        ]);
        if (!active) return;
        setLoad({
          phase: 'ready',
          routines,
          currentRoutineId,
          executedRoutineIds: history.executedRoutineIds,
        });
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
      executedRoutineIds={load.executedRoutineIds}
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
      onArchive={async (id) => {
        await archiveRoutine(id);
        reload();
      }}
      onUnarchive={async (id) => {
        await unarchiveRoutine(id);
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
        // Le catalogue (ADR 0015) se charge avec la liste : l'option « partir
        // d'une séance existante » ne doit apparaître que s'il y a une source.
        const [seances, catalog, history] = await Promise.all([
          listSeances(routine.id),
          loadSeanceCatalog(),
          loadPlanHistory(),
        ]);
        if (!active) return;
        setLoad({
          phase: 'ready',
          seances,
          catalog,
          executedSeanceIds: history.executedSeanceIds,
        });
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
      catalog={load.catalog}
      executedSeanceIds={load.executedSeanceIds}
      onBack={onBack}
      onEdit={onEdit}
      onCreate={async (name) => {
        await createSeance(routine.id, { name });
        reload();
      }}
      onDuplicate={async (sourceSeanceId, name) => {
        await duplicateSeance(routine.id, sourceSeanceId, name);
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
      onArchive={async (id) => {
        await archiveSeance(id);
        reload();
      }}
      onUnarchive={async (id) => {
        await unarchiveSeance(id);
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
  /** Routines dont une séance a déjà été exécutée : elles s'archivent (ADR 0017). */
  executedRoutineIds?: ReadonlySet<string>;
  onOpen: (routine: RoutineRow) => void;
  onCreate: (name: string) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onArchive?: (id: string) => Promise<void>;
  onUnarchive?: (id: string) => Promise<void>;
  onSetCurrent: (id: string) => Promise<void>;
}

export function RoutinesView({
  routines: allRoutines,
  currentRoutineId,
  executedRoutineIds = new Set(),
  onOpen,
  onCreate,
  onRename,
  onDelete,
  onArchive = async () => {},
  onUnarchive = async () => {},
  onSetCurrent,
}: RoutinesViewProps) {
  const [creating, setCreating] = useState(false);
  // Archivées à part (ADR 0017) : hors de la liste, dans une section repliée.
  const routines = allRoutines.filter((r) => r.archived_at === null);
  const archived = allRoutines.filter((r) => r.archived_at !== null);

  return (
    <div className="mx-auto w-full max-w-md px-4 pb-8 pt-5">
      <h2 className="mb-1.5 text-3xl font-semibold tracking-[-0.025em] text-ink">Routines</h2>
      <p className="mb-5 text-[15px] text-ink-muted">
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
                  executed={executedRoutineIds.has(routine.id)}
                  onOpen={() => onOpen(routine)}
                  onRename={(name) => onRename(routine.id, name)}
                  onDelete={() => onDelete(routine.id)}
                  onArchive={() => onArchive(routine.id)}
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

      {archived.length > 0 && (
        <ArchivedSection count={archived.length}>
          {archived.map((routine) => (
            <li key={routine.id}>
              <ArchivedRowItem
                name={routine.name}
                onOpen={() => onOpen(routine)}
                onUnarchive={() => onUnarchive(routine.id)}
              />
            </li>
          ))}
        </ArchivedSection>
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
    <section className="mt-8 border-t border-hair pt-5">
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
  executed,
  onOpen,
  onRename,
  onDelete,
  onArchive,
  onSetCurrent,
}: {
  routine: RoutineRow;
  isCurrent: boolean;
  executed: boolean;
  onOpen: () => void;
  onRename: (name: string) => Promise<void>;
  onDelete: () => Promise<void>;
  onArchive: () => Promise<void>;
  onSetCurrent: () => Promise<void>;
}) {
  const [mode, setMode] = useState<'idle' | 'rename' | 'confirmDelete' | 'confirmArchive'>(
    'idle',
  );
  const actions = planRowActions({ executed, archived: false, isCurrent });
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
    <RowCard accent={isCurrent}>
      <div className="flex items-center gap-2">
        {/* Le nom est cliquable : il ouvre les séances de la routine. */}
        <button
          type="button"
          onClick={onOpen}
          className="flex min-h-[44px] min-w-0 flex-1 items-center gap-2 rounded-lg py-1 text-left transition active:opacity-80"
        >
          <span className="min-w-0 flex-1">
            {isCurrent && (
              <span className="readout mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-accent-ink">
                Routine courante
              </span>
            )}
            <span className="block truncate text-lg font-semibold text-ink">
              {routine.name}
            </span>
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
      ) : mode === 'confirmArchive' ? (
        <ConfirmArchive
          question="Archiver cette routine ?"
          detail="Elle quitte ta liste. Ses séances, ses courbes et ses blocs restent dans l'analyse. Tu pourras la désarchiver."
          busy={busy}
          error={error}
          onConfirm={() => run(onArchive)}
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
              icon={STAR_ICON}
              busy={busy}
              onClick={() => run(onSetCurrent)}
            />
          )}
          <RowAction label="Renommer" icon={RENAME_ICON} onClick={() => setMode('rename')} />
          {actions.canArchive && (
            <RowAction
              label="Archiver"
              icon={ARCHIVE_ICON}
              onClick={() => setMode('confirmArchive')}
            />
          )}
          {actions.canDelete && (
            <RowAction
              label="Supprimer"
              icon={DELETE_ICON}
              tone="danger"
              onClick={() => setMode('confirmDelete')}
            />
          )}
        </div>
      )}

      {error && mode === 'idle' && <RowError message={error} />}
    </RowCard>
  );
}

// --- Vue Séances d'une routine ----------------------------------------------

export /**
 * Où en est la création d'une séance (ADR 0015) : bouton, choix de la source,
 * sélection de la séance à copier, puis nom. `blank` court-circuite le choix
 * quand il n'y a rien à copier.
 */
type CreateStep =
  | { step: 'idle' }
  | { step: 'choice' }
  | { step: 'blank' }
  | { step: 'pick' }
  | { step: 'name'; source: SeanceCatalogEntry };

interface SeancesViewProps {
  routineName: string;
  seances: SeanceRow[];
  onBack: () => void;
  onEdit: (seance: SeanceRow) => void;
  onCreate: (name: string) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onReorder: (orderedIds: string[]) => Promise<void>;
  /**
   * Séances copiables, toutes routines confondues (ADR 0015). Absent ou vide :
   * la création reste directe, sans choix de source (compte neuf, ou harness).
   */
  catalog?: SeanceCatalogEntry[];
  onDuplicate?: (sourceSeanceId: string, name: string) => Promise<void>;
  /** Séances déjà exécutées : elles s'archivent au lieu de se supprimer (ADR 0017). */
  executedSeanceIds?: ReadonlySet<string>;
  onArchive?: (id: string) => Promise<void>;
  onUnarchive?: (id: string) => Promise<void>;
}

export function SeancesView({
  routineName,
  seances: allSeances,
  onBack,
  onEdit,
  onCreate,
  onRename,
  onDelete,
  onReorder,
  catalog = [],
  onDuplicate,
  executedSeanceIds = new Set(),
  onArchive = async () => {},
  onUnarchive = async () => {},
}: SeancesViewProps) {
  const [create, setCreate] = useState<CreateStep>({ step: 'idle' });
  // Archivées à part (ADR 0017) : hors de l'ordre de la routine, section repliée.
  const seances = allSeances.filter((s) => s.archived_at === null);
  const archived = allSeances.filter((s) => s.archived_at !== null);

  // La duplication n'a de sens qu'avec une source ET un handler : sinon le
  // bouton mène droit au formulaire vierge, comme avant.
  const canDuplicate = catalog.length > 0 && onDuplicate !== undefined;
  const openCreate = () => setCreate({ step: canDuplicate ? 'choice' : 'blank' });
  const closeCreate = () => setCreate({ step: 'idle' });

  function moveSeance(index: number, direction: -1 | 1): Promise<void> {
    const target = index + direction;
    if (target < 0 || target >= seances.length) return Promise.resolve();
    const orderedIds = seances.map((s) => s.id);
    const a = orderedIds[index];
    const b = orderedIds[target];
    if (a === undefined || b === undefined) return Promise.resolve();
    orderedIds[index] = b;
    orderedIds[target] = a;
    return onReorder(orderedIds);
  }

  return (
    <div className="mx-auto w-full max-w-md px-4 pb-8 pt-3">
      <BackButton label="Retour aux routines" onClick={onBack} />

      <h2 className="mt-1 text-3xl font-semibold tracking-[-0.025em] text-ink">{routineName}</h2>
      <p className="mb-5 text-[15px] text-ink-muted">Séances de cette routine, dans l'ordre.</p>

      {seances.length === 0 && create.step === 'idle' ? (
        <EmptyState
          message="Aucune séance. Ajoute la première séance de cette routine."
          actionLabel="Créer une séance"
          onAction={openCreate}
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
                  executed={executedSeanceIds.has(seance.id)}
                  onEdit={() => onEdit(seance)}
                  onMove={(direction) => moveSeance(index, direction)}
                  onRename={(name) => onRename(seance.id, name)}
                  onDelete={() => onDelete(seance.id)}
                  onArchive={() => onArchive(seance.id)}
                />
              </li>
            ))}
          </ul>

          <div className="mt-4">
            <CreateFlow
              step={create}
              catalog={catalog}
              // Un nom reste réservé pendant l'archivage : archivées comprises.
              takenNames={allSeances.map((s) => s.name)}
              onOpen={openCreate}
              onStep={setCreate}
              onCancel={closeCreate}
              onCreate={onCreate}
              onDuplicate={onDuplicate}
            />
          </div>
        </>
      )}

      {archived.length > 0 && (
        <ArchivedSection count={archived.length}>
          {archived.map((seance) => (
            <li key={seance.id}>
              <ArchivedRowItem name={seance.name} onUnarchive={() => onUnarchive(seance.id)} />
            </li>
          ))}
        </ArchivedSection>
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
  executed,
  onEdit,
  onMove,
  onRename,
  onDelete,
  onArchive,
}: {
  seance: SeanceRow;
  index: number;
  isFirst: boolean;
  isLast: boolean;
  executed: boolean;
  onEdit: () => void;
  onMove: (direction: -1 | 1) => Promise<void>;
  onRename: (name: string) => Promise<void>;
  onDelete: () => Promise<void>;
  onArchive: () => Promise<void>;
}) {
  const [mode, setMode] = useState<'idle' | 'rename' | 'confirmDelete' | 'confirmArchive'>(
    'idle',
  );
  const actions = planRowActions({ executed, archived: false, isCurrent: false });
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
      ) : mode === 'confirmArchive' ? (
        <ConfirmArchive
          question="Archiver cette séance ?"
          detail="Elle ne se choisit plus en salle. Son historique reste dans l'analyse. Tu pourras la désarchiver."
          busy={busy}
          error={error}
          onConfirm={() => run(onArchive)}
          onCancel={() => setMode('idle')}
        />
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <RowAction label="Éditer" icon={EDIT_ICON} tone="accent" onClick={onEdit} />
          <RowAction label="Renommer" icon={RENAME_ICON} onClick={() => setMode('rename')} />
          {actions.canArchive && (
            <RowAction
              label="Archiver"
              icon={ARCHIVE_ICON}
              onClick={() => setMode('confirmArchive')}
            />
          )}
          {actions.canDelete && (
            <RowAction
              label="Supprimer"
              icon={DELETE_ICON}
              tone="danger"
              onClick={() => setMode('confirmDelete')}
            />
          )}
        </div>
      )}

      {error && mode === 'idle' && <RowError message={error} />}
    </RowCard>
  );
}

// =====================================================================
// Création d'une séance : vierge, ou copiée d'une existante (ADR 0015)
// =====================================================================

/** Aiguillage du flux de création. Chaque étape rend un seul bloc, en place. */
function CreateFlow({
  step,
  catalog,
  takenNames,
  onOpen,
  onStep,
  onCancel,
  onCreate,
  onDuplicate,
}: {
  step: CreateStep;
  catalog: SeanceCatalogEntry[];
  /** Noms des séances de la routine d'arrivée : un nom y est unique. */
  takenNames: string[];
  onOpen: () => void;
  onStep: (next: CreateStep) => void;
  onCancel: () => void;
  onCreate: (name: string) => Promise<void>;
  onDuplicate?: (sourceSeanceId: string, name: string) => Promise<void>;
}) {
  if (step.step === 'idle') {
    return <PrimaryAddButton label="Créer une séance" onClick={onOpen} />;
  }

  if (step.step === 'choice') {
    return (
      <CreateChoice
        onBlank={() => onStep({ step: 'blank' })}
        onExisting={() => onStep({ step: 'pick' })}
        onCancel={onCancel}
      />
    );
  }

  if (step.step === 'pick') {
    return (
      <SeancePicker
        catalog={catalog}
        onPick={(source) => onStep({ step: 'name', source })}
        onCancel={() => onStep({ step: 'choice' })}
      />
    );
  }

  if (step.step === 'name') {
    const source = step.source;
    return (
      <CreateForm
        // Le nom de la source est proposé tel quel s'il est libre dans cette
        // routine (copie vers une autre routine), sinon « Push 2 » : un nom de
        // séance est unique dans sa routine (migration 0013).
        initial={nextFreeName(source.seanceName, takenNames)}
        placeholder="Nom de la séance"
        submitLabel="Dupliquer"
        intro={`Copie de « ${source.seanceName} », dans ${source.routineName}.`}
        onSubmit={async (name) => {
          await onDuplicate?.(source.seanceId, name);
          onCancel();
        }}
        onCancel={() => onStep({ step: 'pick' })}
      />
    );
  }

  return (
    <CreateForm
      placeholder="Nom de la séance"
      submitLabel="Créer"
      onSubmit={async (name) => {
        await onCreate(name);
        onCancel();
      }}
      onCancel={onCancel}
    />
  );
}

/** Choix de la source : page blanche, ou séance existante à copier. */
function CreateChoice({
  onBlank,
  onExisting,
  onCancel,
}: {
  onBlank: () => void;
  onExisting: () => void;
  onCancel: () => void;
}) {
  return (
    <RowCard>
      <p className="text-[15px] font-medium text-ink">Nouvelle séance</p>
      <div className="mt-3 flex flex-col gap-2">
        <ChoiceButton
          label="Séance vierge"
          hint="Ajouter les exos un par un."
          onClick={onBlank}
        />
        <ChoiceButton
          label="Partir d'une séance existante"
          hint="Copier ses exos et ses prescriptions, puis ajuster."
          onClick={onExisting}
        />
      </div>
      <CancelRow onCancel={onCancel} />
    </RowCard>
  );
}

/** Une option du choix : libellé fort, explication en dessous. */
function ChoiceButton({
  label,
  hint,
  onClick,
}: {
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="field flex min-h-[56px] w-full flex-col items-start justify-center gap-0.5 rounded-xl px-3.5 py-2.5 text-left transition active:scale-[0.99]"
    >
      <span className="text-[15px] font-medium text-ink">{label}</span>
      <span className="text-[13px] text-ink-muted">{hint}</span>
    </button>
  );
}

/**
 * Sélecteur de la séance à copier : toutes les séances de l'utilisateur, la
 * routine courante en tête (`buildSeanceCatalog`). Une séance sans exercice y
 * figure avec « 0 exercice » plutôt que d'être masquée sans explication.
 */
function SeancePicker({
  catalog,
  onPick,
  onCancel,
}: {
  catalog: SeanceCatalogEntry[];
  onPick: (source: SeanceCatalogEntry) => void;
  onCancel: () => void;
}) {
  return (
    <RowCard>
      <p className="text-[15px] font-medium text-ink">Copier quelle séance ?</p>
      <p className="mt-1 text-[13px] text-ink-muted">
        La copie repart sans repère : ni dernière fois, ni courbe, tant qu'elle n'a pas été
        faite une première fois. Tes records personnels, eux, restent affichés.
      </p>
      <ul className="mt-3 flex max-h-[50vh] flex-col gap-2 overflow-y-auto">
        {catalog.map((entry) => (
          <li key={entry.seanceId}>
            <button
              type="button"
              onClick={() => onPick(entry)}
              className="field flex min-h-[56px] w-full flex-col items-start justify-center gap-0.5 rounded-xl px-3.5 py-2.5 text-left transition active:scale-[0.99]"
            >
              <span className="w-full truncate text-[15px] font-medium text-ink">
                {entry.seanceName}
              </span>
              <span className="w-full truncate text-[13px] text-ink-muted">
                {entry.routineName}
                {entry.isCurrentRoutine ? ' (courante)' : ''} · {exerciseCountLabel(entry.exerciseCount)}
                {entry.isArchived ? ' · archivée' : ''}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <CancelRow onCancel={onCancel} />
    </RowCard>
  );
}

/** « 0 exercice » / « 1 exercice » / « 4 exercices ». */
function exerciseCountLabel(count: number): string {
  return count > 1 ? `${count} exercices` : `${count} exercice`;
}

/** Ligne « Annuler » seule, sous un bloc de choix. */
function CancelRow({ onCancel }: { onCancel: () => void }) {
  return (
    <button
      type="button"
      onClick={onCancel}
      className="btn btn-ghost mt-2 h-11 w-full rounded-xl px-4 text-sm font-medium"
    >
      Annuler
    </button>
  );
}

// =====================================================================
// Primitives partagées
// =====================================================================

function RowCard({
  children,
  accent = false,
}: {
  children: React.ReactNode;
  /** Carte « clé » accentuée (routine courante) : gradient accent-soft + bordure accent. */
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl p-3.5 ${
        accent
          ? 'panel border-accent bg-[linear-gradient(160deg,var(--color-accent-soft),transparent)]'
          : 'surface-card'
      }`}
    >
      {children}
    </div>
  );
}

/** Icônes des actions de ligne (réglages / crayon / corbeille / étoile). Knobs du
 *  glyphe « réglages » remplis pour se lire à petite taille. */
const EDIT_ICON = (
  <>
    <line x1="4" y1="7" x2="20" y2="7" />
    <circle cx="10" cy="7" r="2.4" fill="currentColor" stroke="none" />
    <line x1="4" y1="12" x2="20" y2="12" />
    <circle cx="15" cy="12" r="2.4" fill="currentColor" stroke="none" />
    <line x1="4" y1="17" x2="20" y2="17" />
    <circle cx="8" cy="17" r="2.4" fill="currentColor" stroke="none" />
  </>
);
const RENAME_ICON = (
  <>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
  </>
);
const DELETE_ICON = (
  <>
    <path d="M4 7h16" />
    <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    <path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13" />
    <path d="M10 11v6M14 11v6" />
  </>
);
const ARCHIVE_ICON = (
  <>
    <rect x="3" y="4" width="18" height="4" rx="1" />
    <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" />
    <path d="M10 12h4" />
  </>
);
const STAR_ICON = (
  <path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.2l5.9-.9L12 3z" />
);

/**
 * Action de ligne en BOUTON-INSTRUMENT à icône (décision UI 2026-06-23 : routine
 * et séance, comme l'éditeur). `label` porte l'`aria-label` (icône seule). Tons :
 * accent (action principale, Éditer) = bordure + glyphe accent ; danger
 * (Supprimer) = glyphe qui vire au warn à la pression ; neutre = ink-muted.
 */
function RowAction({
  label,
  icon,
  onClick,
  tone = 'neutral',
  busy = false,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  tone?: 'neutral' | 'accent' | 'danger';
  busy?: boolean;
}) {
  const toneClass =
    tone === 'accent'
      ? 'border-accent text-accent-ink'
      : tone === 'danger'
        ? 'text-ink-muted active:text-warn'
        : 'text-ink-muted active:text-ink';
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={busy}
      className={`flex h-11 w-11 items-center justify-center rounded-xl border border-hair bg-surface shadow-[inset_0_1px_0_var(--spec)] transition active:scale-95 disabled:opacity-30 ${toneClass}`}
    >
      <svg
        viewBox="0 0 24 24"
        width="19"
        height="19"
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
      className="flex h-11 w-11 items-center justify-center rounded-xl border border-hair bg-surface text-ink-muted shadow-[inset_0_1px_0_var(--spec)] transition active:scale-95 active:text-ink disabled:opacity-30"
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
          className="inline-flex h-11 flex-1 items-center justify-center rounded-xl border border-warn bg-[color-mix(in_oklab,var(--color-warn),transparent_85%)] px-4 text-sm font-semibold text-warn transition active:scale-[0.98] active:bg-[color-mix(in_oklab,var(--color-warn),transparent_78%)] disabled:opacity-50"
        >
          {busy ? 'Suppression…' : 'Supprimer'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="btn btn-ghost h-11 rounded-xl px-4 text-sm font-medium disabled:opacity-50"
        >
          Annuler
        </button>
      </div>
      {error && <RowError message={error} />}
    </div>
  );
}

/**
 * Confirmation d'archivage INLINE (ADR 0017). Ton neutre, pas d'alerte : rien ne
 * se perd, le geste se défait. Le détail dit ce qui reste.
 */
function ConfirmArchive({
  question,
  detail,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  question: string;
  detail: string;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="mt-2 rounded-xl bg-surface-2/60 p-3">
      <p className="text-sm text-ink">{question}</p>
      <p className="mt-0.5 text-xs text-ink-muted">{detail}</p>
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onConfirm}
          className="btn btn-primary h-11 flex-1 rounded-xl px-4 text-sm disabled:opacity-50"
        >
          {busy ? 'Archivage…' : 'Archiver'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="btn btn-ghost h-11 rounded-xl px-4 text-sm font-medium disabled:opacity-50"
        >
          Annuler
        </button>
      </div>
      {error && <RowError message={error} />}
    </div>
  );
}

/** Section repliée des éléments archivés, en bas de liste (ADR 0017). */
function ArchivedSection({ count, children }: { count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="mt-6 border-t border-hair pt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-[44px] w-full items-center justify-between text-sm font-medium text-ink-muted transition active:text-ink"
      >
        <span>
          Archivées <span className="readout tabular-nums text-ink-faint">{count}</span>
        </span>
        <svg
          viewBox="0 0 20 20"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={`transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path d="M5 8l5 5 5-5" />
        </svg>
      </button>
      {open && <ul className="mt-2 flex flex-col gap-2.5">{children}</ul>}
    </section>
  );
}

/** Une routine ou une séance archivée : son nom, et le geste qui la rend au plan. */
function ArchivedRowItem({
  name,
  onOpen,
  onUnarchive,
}: {
  name: string;
  /** Routine : ouvrir ses séances reste possible. Absent pour une séance. */
  onOpen?: () => void;
  onUnarchive: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <RowCard>
      <div className="flex items-center gap-2">
        {onOpen ? (
          <button
            type="button"
            onClick={onOpen}
            className="flex min-h-[44px] min-w-0 flex-1 items-center gap-2 rounded-lg py-1 text-left transition active:opacity-80"
          >
            <span className="block min-w-0 flex-1 truncate text-base font-medium text-ink-muted">
              {name}
            </span>
            <Chevron />
          </button>
        ) : (
          <span className="min-w-0 flex-1 truncate text-base font-medium text-ink-muted">
            {name}
          </span>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await onUnarchive();
            } catch (err) {
              setError(errMessage(err));
              setBusy(false);
            }
          }}
          className="btn btn-ghost h-11 shrink-0 rounded-xl px-3.5 text-sm font-medium disabled:opacity-50"
        >
          {busy ? 'Désarchivage…' : 'Désarchiver'}
        </button>
      </div>
      {error && <RowError message={error} />}
    </RowCard>
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
        className="field h-11 w-full rounded-xl px-3 text-base text-ink"
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          type="submit"
          disabled={!canSubmit}
          className="btn btn-primary h-11 flex-1 rounded-xl px-4 text-sm"
        >
          {busy ? 'Enregistrement…' : submitLabel}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="btn btn-ghost h-11 rounded-xl px-4 text-sm font-medium disabled:opacity-50"
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
  initial,
  placeholder,
  submitLabel,
  intro,
  onSubmit,
  onCancel,
}: {
  /** Nom pré-rempli (duplication) ; absent = champ vide (séance vierge). */
  initial?: string;
  placeholder: string;
  submitLabel: string;
  /** Rappel de ce qu'on est en train de créer, au-dessus du champ. */
  intro?: string;
  onSubmit: (name: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <RowCard>
      {intro && <p className="mb-2 text-[13px] text-ink-muted">{intro}</p>}
      <InlineNameForm
        initial={initial}
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
      className="btn btn-primary h-12 w-full rounded-2xl text-base"
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
    <div className="mt-2 flex flex-col items-center gap-4 rounded-2xl border border-dashed border-hair-strong px-6 py-10 text-center">
      <p className="text-sm text-ink-muted">{message}</p>
      <button
        type="button"
        onClick={onAction}
        className="btn btn-primary h-11 rounded-xl px-5 text-sm"
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
      className="btn btn-ghost -ml-1 min-h-[44px] self-start rounded-lg py-2 pr-3 text-sm font-medium"
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
        <div key={i} className="surface-card mb-2.5 rounded-2xl p-3.5">
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
        className="btn btn-primary h-11 rounded-xl px-5 text-sm"
      >
        Réessayer
      </button>
    </div>
  );
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
