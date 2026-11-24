// Surface « Séances » : édition du plan, au calme (refonte E, DESIGN.md).
//
// Trois niveaux, une page chacun, navigation en state local (pas de routeur) :
//   routines  la courante en tête (trait blanc cassé + le mot), les autres, les
//             archivées repliées ; « Créer une routine » est l'action principale.
//   routine   ses séances dans l'ordre de rotation (Réordonner = Monter /
//             Descendre en mots, par la RPC `reorder_seances`), créer une séance
//             vierge ou copiée d'une autre (ADR 0015), séances archivées
//             repliées, actions de la routine (renommer, définir courante,
//             archiver ou supprimer, désarchiver ; ADR 0017).
//   éditeur   SeanceEditor : prescriptions, notes d'instructions, actions de la
//             séance (renommer, dupliquer, archiver ou supprimer).
//
// Les conteneurs chargent et écrivent (features/authoring/data.ts) ; les vues
// reçoivent données et callbacks. Chaque écriture est attendue : un refus
// s'affiche là où le geste a été fait, en français (`errorMessage`).
//
// Aucun usage du signal ici : rien n'y est « mieux que la dernière fois ».
// Aucune confirmation par `window.confirm` : en ligne (`Confirm`), le texte dit
// ce qui sera perdu, l'option sûre est le bouton.
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
import { requestLeave } from './seance-dirty';
import { errorMessage } from '../../lib/error-message';
import { exoCount, seanceCount } from './seance-format';
import { NameSheet, ReorderRow } from './seances-ui';
import {
  ActionNote,
  ActionRow,
  Confirm,
  Disclosure,
  EmptyState,
  FieldError,
  IconButton,
  List,
  LoadError,
  Loading,
  PrimaryButton,
  Row,
  Screen,
  ScreenHeader,
  SecondaryButton,
  SectionTitle,
  Sheet,
  TextLink,
} from '../../ui';

type RoutineRow = Database['public']['Tables']['routines']['Row'];
type SeanceRow = Database['public']['Tables']['seances']['Row'];

/** Ce que l'éditeur doit savoir de la séance ouverte, au-delà de la séance elle-même. */
interface EditorContext {
  routine: RoutineRow;
  isCurrentRoutine: boolean;
  /** Déjà exécutée : elle s'archive au lieu de se supprimer (ADR 0017). */
  executed: boolean;
  /** Noms des séances de la routine, archivées comprises : un nom y est unique. */
  takenNames: string[];
}

/** Où l'utilisateur se trouve dans l'arbre routines -> routine -> éditeur. */
type View =
  | { kind: 'routines' }
  | { kind: 'routine'; routineId: string }
  | { kind: 'editor'; seance: SeanceRow; ctx: EditorContext };

export function SeancesScreen() {
  const [view, setView] = useState<View>({ kind: 'routines' });

  if (view.kind === 'editor') {
    const { seance, ctx } = view;
    const toRoutine = () => setView({ kind: 'routine', routineId: ctx.routine.id });
    return (
      <SeanceEditor
        key={seance.id}
        seanceId={seance.id}
        seanceName={seance.name}
        routineName={ctx.routine.name}
        isCurrentRoutine={ctx.isCurrentRoutine}
        executed={ctx.executed}
        copyName={nextFreeName(seance.name, ctx.takenNames)}
        onBack={toRoutine}
        onRename={async (name) => {
          const renamed = await renameSeance(seance.id, name);
          setView({ kind: 'editor', seance: renamed, ctx: { ...ctx, takenNames: ctx.takenNames.map((n) => (n === seance.name ? renamed.name : n)) } });
        }}
        onDuplicate={async (name) => {
          const copy = await duplicateSeance(ctx.routine.id, seance.id, name);
          // Ouvrir la copie fait disparaître cet éditeur : par la garde de sortie.
          requestLeave(() =>
            setView({ kind: 'editor', seance: copy, ctx: { ...ctx, executed: false, takenNames: [...ctx.takenNames, copy.name] } }),
          );
        }}
        onArchive={async () => {
          await archiveSeance(seance.id);
          toRoutine();
        }}
        onDelete={async () => {
          await deleteSeance(seance.id);
          toRoutine();
        }}
      />
    );
  }

  if (view.kind === 'routine') {
    return (
      <RoutineContainer
        key={view.routineId}
        routineId={view.routineId}
        onBack={() => setView({ kind: 'routines' })}
        onEdit={(seance, ctx) => setView({ kind: 'editor', seance, ctx })}
      />
    );
  }

  return <RoutinesContainer onOpen={(routineId) => setView({ kind: 'routine', routineId })} />;
}

// =====================================================================
// Routines
// =====================================================================

type RoutinesLoad =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; routines: RoutineRow[]; currentRoutineId: string | null; catalog: SeanceCatalogEntry[] };

function RoutinesContainer({ onOpen }: { onOpen: (routineId: string) => void }) {
  const [load, setLoad] = useState<RoutinesLoad>({ phase: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        // Lectures indépendantes, en parallèle. Le catalogue des séances donne le
        // nombre de séances de chaque routine.
        const [routines, currentRoutineId, catalog] = await Promise.all([
          listRoutines(),
          getCurrentRoutineId(),
          loadSeanceCatalog(),
        ]);
        if (!active) return;
        setLoad({ phase: 'ready', routines, currentRoutineId, catalog });
      } catch (err) {
        if (!active) return;
        setLoad({ phase: 'error', message: errorMessage(err) });
      }
    })();
    return () => {
      active = false;
    };
  }, [reloadKey]);

  if (load.phase === 'loading') {
    return (
      <Screen>
        <ScreenHeader title="Routines" />
        <Loading label="Chargement des routines…" />
      </Screen>
    );
  }
  if (load.phase === 'error') {
    return (
      <Screen>
        <ScreenHeader title="Routines" />
        <LoadError
          intro="Impossible de charger tes routines."
          message={load.message}
          onRetry={() => {
            setLoad({ phase: 'loading' });
            setReloadKey((k) => k + 1);
          }}
        />
      </Screen>
    );
  }

  return (
    <RoutinesView
      routines={load.routines}
      currentRoutineId={load.currentRoutineId}
      catalog={load.catalog}
      onOpen={onOpen}
      onCreate={async (name) => {
        const created = await createRoutine({ name });
        onOpen(created.id);
      }}
    />
  );
}

/** Nombre de séances actives d'une routine, lu dans le catalogue. */
function activeSeanceCount(catalog: readonly SeanceCatalogEntry[], routineId: string): number {
  return catalog.filter((e) => e.routineId === routineId && !e.isArchived).length;
}

export function RoutinesView({
  routines,
  currentRoutineId,
  catalog,
  onOpen,
  onCreate,
}: {
  routines: RoutineRow[];
  currentRoutineId: string | null;
  catalog: SeanceCatalogEntry[];
  onOpen: (routineId: string) => void;
  onCreate: (name: string) => Promise<void>;
}) {
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const live = routines.filter((r) => r.archived_at === null);
  const current = live.find((r) => r.id === currentRoutineId);
  const others = live.filter((r) => r.id !== currentRoutineId);
  const archived = routines.filter((r) => r.archived_at !== null);
  const meta = (r: RoutineRow) => seanceCount(activeSeanceCount(catalog, r.id));

  return (
    <Screen bottom={<PrimaryButton onClick={() => setCreating(true)}>Créer une routine</PrimaryButton>}>
      <ScreenHeader title="Routines" />
      {live.length === 0 && archived.length === 0 ? (
        <EmptyState
          title="Aucune routine"
          body="Une routine regroupe les séances que tu enchaînes en salle. Crée la première, puis ajoutes-y ses séances."
        />
      ) : (
        <>
          {current && (
            <List label="Routine courante">
              <Row
                current
                title={current.name}
                meta={
                  <>
                    <span className="font-medium text-ink">courante</span> · {meta(current)}
                  </>
                }
                onClick={() => onOpen(current.id)}
                ariaLabel={`${current.name}, routine courante, ${meta(current)}`}
              />
            </List>
          )}
          {others.length > 0 && (
            <>
              <SectionTitle>{current ? 'Autres routines' : 'Tes routines'}</SectionTitle>
              <List label="Autres routines">
                {others.map((r) => (
                  <Row key={r.id} title={r.name} meta={meta(r)} onClick={() => onOpen(r.id)} />
                ))}
              </List>
            </>
          )}
          {archived.length > 0 && (
            <Disclosure label="Routines archivées" count={archived.length} open={showArchived} onToggle={() => setShowArchived((v) => !v)}>
              <p className="px-5 pb-3 text-[14px] leading-[1.45] text-muted">
                Hors du plan. Leurs courbes et leurs blocs restent dans l’analyse.
              </p>
              <List label="Routines archivées">
                {archived.map((r) => (
                  <Row key={r.id} muted title={r.name} meta="archivée" onClick={() => onOpen(r.id)} />
                ))}
              </List>
            </Disclosure>
          )}
        </>
      )}

      <NameSheet
        open={creating}
        title="Nouvelle routine"
        label="Nom de la routine"
        submitLabel="Créer la routine"
        busyLabel="Création…"
        intro={live.length === 0 ? 'Tu y ajoutes ensuite ses séances, dans l’ordre où tu les enchaînes.' : undefined}
        onClose={() => setCreating(false)}
        onSubmit={async (name) => {
          await onCreate(name);
          setCreating(false);
        }}
      />
    </Screen>
  );
}

// =====================================================================
// Une routine : ses séances et ses actions
// =====================================================================

type RoutineLoad =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'missing' }
  | {
      phase: 'ready';
      routine: RoutineRow;
      routines: RoutineRow[];
      currentRoutineId: string | null;
      seances: SeanceRow[];
      catalog: SeanceCatalogEntry[];
      executedSeanceIds: ReadonlySet<string>;
      executedRoutineIds: ReadonlySet<string>;
    };

function RoutineContainer({
  routineId,
  onBack,
  onEdit,
}: {
  routineId: string;
  onBack: () => void;
  onEdit: (seance: SeanceRow, ctx: EditorContext) => void;
}) {
  const [load, setLoad] = useState<RoutineLoad>({ phase: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  // Un rafraîchissement après une écriture garde le contenu monté : pas de
  // saut en haut de page, pas de chargement affiché.
  const reload = () => setReloadKey((k) => k + 1);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        // Le catalogue (ADR 0015) sert à la fois au nombre d'exos de chaque
        // séance et à la copie d'une séance existante.
        const [routines, currentRoutineId, seances, catalog, history] = await Promise.all([
          listRoutines(),
          getCurrentRoutineId(),
          listSeances(routineId),
          loadSeanceCatalog(),
          loadPlanHistory(),
        ]);
        if (!active) return;
        const routine = routines.find((r) => r.id === routineId);
        if (!routine) {
          setLoad({ phase: 'missing' });
          return;
        }
        setLoad({
          phase: 'ready',
          routine,
          routines,
          currentRoutineId,
          seances,
          catalog,
          executedSeanceIds: history.executedSeanceIds,
          executedRoutineIds: history.executedRoutineIds,
        });
      } catch (err) {
        if (!active) return;
        setLoad({ phase: 'error', message: errorMessage(err) });
      }
    })();
    return () => {
      active = false;
    };
  }, [reloadKey, routineId]);

  const back = { label: 'Routines', onClick: onBack };
  if (load.phase === 'loading') {
    return (
      <Screen>
        <ScreenHeader title="Routine" back={back} />
        <Loading label="Chargement des séances…" />
      </Screen>
    );
  }
  if (load.phase === 'error') {
    return (
      <Screen>
        <ScreenHeader title="Routine" back={back} />
        <LoadError
          intro="Impossible de charger cette routine."
          message={load.message}
          onRetry={() => {
            setLoad({ phase: 'loading' });
            reload();
          }}
        />
      </Screen>
    );
  }
  if (load.phase === 'missing') {
    return (
      <Screen>
        <ScreenHeader title="Routine introuvable" back={back} />
        <EmptyState title="Cette routine n’existe plus" body="Elle a pu être supprimée depuis un autre appareil." />
      </Screen>
    );
  }

  const { routine, seances } = load;
  const isCurrent = routine.id === load.currentRoutineId;
  const currentName = load.routines.find((r) => r.id === load.currentRoutineId)?.name ?? null;
  const takenNames = seances.map((s) => s.name);
  const withReload = (write: () => Promise<unknown>) => async () => {
    await write();
    reload();
  };

  return (
    <RoutineView
      routine={routine}
      isCurrent={isCurrent}
      currentRoutineName={currentName}
      executed={load.executedRoutineIds.has(routine.id)}
      seances={seances}
      catalog={load.catalog}
      onBack={onBack}
      onEdit={(seance) =>
        onEdit(seance, {
          routine,
          isCurrentRoutine: isCurrent,
          executed: load.executedSeanceIds.has(seance.id),
          takenNames,
        })
      }
      onCreateSeance={async (name, sourceId) => {
        const created = sourceId ? await duplicateSeance(routine.id, sourceId, name) : await createSeance(routine.id, { name });
        // Une séance neuve s'ouvre aussitôt dans l'éditeur : on y ajoute ses exos.
        onEdit(created, { routine, isCurrentRoutine: isCurrent, executed: false, takenNames: [...takenNames, created.name] });
      }}
      onReorder={async (orderedIds) => {
        await reorderSeances(routine.id, orderedIds);
        reload();
      }}
      onUnarchiveSeance={async (id) => {
        await unarchiveSeance(id);
        reload();
      }}
      onRename={async (name) => {
        await renameRoutine(routine.id, name);
        reload();
      }}
      onSetCurrent={withReload(() => setCurrentRoutine(routine.id))}
      onArchive={withReload(() => archiveRoutine(routine.id))}
      onUnarchive={withReload(() => unarchiveRoutine(routine.id))}
      onDelete={async () => {
        await deleteRoutine(routine.id);
        onBack();
      }}
    />
  );
}

type Pending = null | 'archive' | 'delete';

export function RoutineView({
  routine,
  isCurrent,
  currentRoutineName,
  executed,
  seances: allSeances,
  catalog,
  onBack,
  onEdit,
  onCreateSeance,
  onReorder,
  onUnarchiveSeance,
  onRename,
  onSetCurrent,
  onArchive,
  onUnarchive,
  onDelete,
}: {
  routine: RoutineRow;
  isCurrent: boolean;
  /** Nom de la routine courante (pour dire ce que « Définir courante » remplace). */
  currentRoutineName: string | null;
  executed: boolean;
  seances: SeanceRow[];
  catalog: SeanceCatalogEntry[];
  onBack: () => void;
  onEdit: (seance: SeanceRow) => void;
  /** Crée une séance vierge (`sourceId` absent) ou la copie d'une existante. */
  onCreateSeance: (name: string, sourceId: string | null) => Promise<void>;
  onReorder: (orderedIds: string[]) => Promise<void>;
  onUnarchiveSeance: (id: string) => Promise<void>;
  onRename: (name: string) => Promise<void>;
  onSetCurrent: () => Promise<void>;
  onArchive: () => Promise<void>;
  onUnarchive: () => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [reorder, setReorder] = useState(false);
  const [moved, setMoved] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unarchiving, setUnarchiving] = useState<string | null>(null);

  const archivedRoutine = routine.archived_at !== null;
  const seances = allSeances.filter((s) => s.archived_at === null);
  const archivedSeances = allSeances.filter((s) => s.archived_at !== null);
  const actions = planRowActions({ executed, archived: archivedRoutine, isCurrent });
  const exos = (id: string) => {
    const entry = catalog.find((e) => e.seanceId === id);
    return entry ? exoCount(entry.exerciseCount) : undefined;
  };
  const status = archivedRoutine ? 'archivée' : isCurrent ? 'routine courante' : null;

  async function run(action: () => Promise<void>, after?: () => void) {
    setBusy(true);
    setError(null);
    try {
      await action();
      after?.();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    const ids = seances.map((s) => s.id);
    const a = ids[index];
    const b = ids[target];
    if (a === undefined || b === undefined) return;
    ids[index] = b;
    ids[target] = a;
    setMoving(true);
    setError(null);
    try {
      await onReorder(ids);
      setMoved(a);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setMoving(false);
    }
  }

  const toggleReorder = () => {
    setReorder((v) => !v);
    setMoved(null);
    setError(null);
  };

  return (
    <Screen
      bottom={
        !archivedRoutine && !reorder ? <PrimaryButton onClick={() => setCreating(true)}>Créer une séance</PrimaryButton> : undefined
      }
    >
      <ScreenHeader
        title={routine.name}
        meta={
          <>
            {status && <span className={isCurrent ? 'font-medium text-ink' : ''}>{status} · </span>}
            {seanceCount(seances.length)}
          </>
        }
        back={{ label: 'Routines', onClick: onBack }}
        action={
          !archivedRoutine && seances.length > 1 ? (
            reorder ? (
              <SecondaryButton size="sm" onClick={toggleReorder} disabled={moving}>
                Terminé
              </SecondaryButton>
            ) : (
              <IconButton icon="reorder" framed label="Réordonner les séances" onClick={toggleReorder} />
            )
          ) : undefined
        }
      />

      {seances.length === 0 ? (
        <EmptyState
          title={archivedRoutine ? 'Aucune séance active' : 'Aucune séance dans cette routine'}
          body={archivedRoutine ? undefined : 'Crée sa première séance, puis ajoutes-y ses exos.'}
        />
      ) : (
        <>
          <SectionTitle aside={reorder ? 'ordre de rotation' : undefined}>Séances</SectionTitle>
          <List label={`Séances de ${routine.name}`}>
            {seances.map((s, i) =>
              reorder ? (
                <ReorderRow
                  key={s.id}
                  rank={i + 1}
                  title={s.name}
                  first={i === 0}
                  last={i === seances.length - 1}
                  moved={moved === s.id}
                  disabled={moving}
                  onMove={(d) => void move(i, d)}
                />
              ) : (
                <Row
                  key={s.id}
                  lead={i + 1}
                  title={s.name}
                  meta={exos(s.id)}
                  muted={archivedRoutine}
                  onClick={archivedRoutine ? undefined : () => onEdit(s)}
                />
              ),
            )}
          </List>
          {reorder && error && <FieldError className="mx-5">{error}</FieldError>}
        </>
      )}

      {archivedSeances.length > 0 && !reorder && (
        <Disclosure label="Séances archivées" count={archivedSeances.length} open={showArchived} onToggle={() => setShowArchived((v) => !v)}>
          <p className="px-5 pb-3 text-[14px] leading-[1.45] text-muted">
            Elles ne se choisissent plus en salle. Leur historique reste dans l’analyse.
          </p>
          <List label="Séances archivées">
            {archivedSeances.map((s) => (
              <Row
                key={s.id}
                muted
                title={s.name}
                meta={exos(s.id)}
                trailing={
                  archivedRoutine ? undefined : (
                    <TextLink
                      tone="muted"
                      className="-mr-1 flex-none px-1 text-[15px]"
                      ariaLabel={`Désarchiver ${s.name}`}
                      onClick={
                        unarchiving
                          ? undefined
                          : () => {
                              setUnarchiving(s.id);
                              setError(null);
                              onUnarchiveSeance(s.id)
                                .catch((err: unknown) => setError(errorMessage(err)))
                                .finally(() => setUnarchiving(null));
                            }
                      }
                    >
                      {unarchiving === s.id ? 'Un instant…' : 'Désarchiver'}
                    </TextLink>
                  )
                }
              />
            ))}
          </List>
        </Disclosure>
      )}

      {!reorder && (
        <section className="mt-6 pb-4">
          <SectionTitle>Routine</SectionTitle>
          {pending === 'archive' ? (
            <Confirm
              confirmLabel="Archiver la routine"
              busy={busy}
              error={error}
              onCancel={() => setPending(null)}
              onConfirm={() => void run(onArchive, () => setPending(null))}
            >
              <p className="font-medium">Archiver {routine.name} ?</p>
              <p className="mt-1 text-muted">
                Elle quitte ta liste. Ses séances, ses courbes et ses blocs restent dans l’analyse. Tu pourras la désarchiver.
              </p>
            </Confirm>
          ) : pending === 'delete' ? (
            <Confirm
              destructive
              keepLabel="Garder la routine"
              confirmLabel="Supprimer la routine"
              busy={busy}
              error={error}
              onCancel={() => setPending(null)}
              onConfirm={() => void run(onDelete)}
            >
              <p className="font-medium">Supprimer {routine.name} ?</p>
              <p className="mt-1 text-muted">
                Jamais faite, elle n’a aucun historique : elle disparaît
                {allSeances.length === 1 ? ' avec sa séance' : allSeances.length > 1 ? ` avec ses ${allSeances.length} séances` : ''}. C’est définitif.
              </p>
            </Confirm>
          ) : (
            <>
              <ul aria-label="Actions de la routine" className="pt-1">
                <ActionRow label="Renommer" onClick={() => setRenaming(true)} disabled={busy} />
                {!isCurrent && !archivedRoutine && (
                  <ActionRow
                    label={busy ? 'Un instant…' : 'Définir comme routine courante'}
                    disabled={busy}
                    meta={`Ses séances remplacent ${currentRoutineName ? `celles de ${currentRoutineName}` : 'les tiennes'} en salle. Un nouveau bloc commence.`}
                    onClick={() => void run(onSetCurrent)}
                  />
                )}
                {actions.canUnarchive ? (
                  <ActionRow
                    label={busy ? 'Un instant…' : 'Désarchiver'}
                    disabled={busy}
                    meta="Elle revient dans ta liste. Sa Référence et ses courbes reprennent où elles s’étaient arrêtées."
                    onClick={() => void run(onUnarchive)}
                  />
                ) : isCurrent ? (
                  <ActionNote>La routine courante ne s’archive pas. Définis d’abord une autre routine comme courante.</ActionNote>
                ) : actions.canArchive ? (
                  <ActionRow label="Archiver" meta="Déjà faite : elle s’archive, son historique reste entier." onClick={() => setPending('archive')} />
                ) : actions.canDelete ? (
                  <ActionRow label="Supprimer" meta="Jamais faite : rien à garder, elle se supprime." onClick={() => setPending('delete')} />
                ) : null}
              </ul>
              {error && <FieldError className="mx-5">{error}</FieldError>}
            </>
          )}
        </section>
      )}

      <NameSheet
        open={renaming}
        title="Renommer la routine"
        label="Nom de la routine"
        initial={routine.name}
        submitLabel="Renommer"
        requireChange
        onClose={() => setRenaming(false)}
        onSubmit={async (name) => {
          await onRename(name);
          setRenaming(false);
        }}
      />
      <CreateSeanceSheet
        open={creating}
        routineName={routine.name}
        catalog={catalog}
        takenNames={allSeances.map((s) => s.name)}
        onClose={() => setCreating(false)}
        onCreate={onCreateSeance}
      />
    </Screen>
  );
}

// =====================================================================
// Création d'une séance : vierge, ou copiée d'une existante (ADR 0015)
// =====================================================================

type Step = { step: 'choice' } | { step: 'pick' } | { step: 'name'; source: SeanceCatalogEntry | null };

function CreateSeanceSheet({
  open,
  routineName,
  catalog,
  takenNames,
  onClose,
  onCreate,
}: {
  open: boolean;
  routineName: string;
  /** Séances copiables, toutes routines confondues, la courante en tête. */
  catalog: SeanceCatalogEntry[];
  takenNames: string[];
  onClose: () => void;
  onCreate: (name: string, sourceId: string | null) => Promise<void>;
}) {
  // Rien à copier (compte neuf) : on va droit au nom.
  const first: Step = catalog.length > 0 ? { step: 'choice' } : { step: 'name', source: null };
  const [step, setStep] = useState<Step>(first);
  const close = () => {
    setStep(first);
    onClose();
  };

  if (step.step === 'name') {
    const src = step.source;
    return (
      <NameSheet
        open={open}
        title={src ? `Copier ${src.seanceName}` : 'Séance vierge'}
        label="Nom de la séance"
        // Le nom de la source est repris s'il est libre dans cette routine, sinon
        // « Push 2 » : un nom de séance est unique dans sa routine (migration 0013).
        initial={src ? nextFreeName(src.seanceName, takenNames) : ''}
        intro={
          src
            ? `Copie de ${src.seanceName} · ${src.routineName}, dans ${routineName}. Les deux séances seront indépendantes. La copie part sans Référence ni courbe tant qu’elle n’a pas été faite ; tes records restent affichés.`
            : `Dans ${routineName}. Tu ajoutes les exos ensuite.`
        }
        submitLabel={src ? 'Créer la copie' : 'Créer la séance'}
        busyLabel="Création…"
        onClose={close}
        onSubmit={async (name) => {
          await onCreate(name, src?.seanceId ?? null);
          setStep(first);
        }}
      />
    );
  }

  // Source : les séances groupées par routine, dans l'ordre du catalogue
  // (routine courante en tête, archivées comprises : leur contenu peut resservir).
  const groups: { routineId: string; routineName: string; current: boolean; entries: SeanceCatalogEntry[] }[] = [];
  for (const entry of catalog) {
    const group = groups.find((g) => g.routineId === entry.routineId);
    if (group) group.entries.push(entry);
    else groups.push({ routineId: entry.routineId, routineName: entry.routineName, current: entry.isCurrentRoutine, entries: [entry] });
  }

  return (
    <Sheet open={open} title={step.step === 'choice' ? 'Nouvelle séance' : 'Copier quelle séance ?'} onClose={close}>
      {step.step === 'choice' ? (
        <List label="Point de départ">
          <Row title="Séance vierge" meta="tu ajoutes les exos un par un" onClick={() => setStep({ step: 'name', source: null })} />
          <Row
            title="Partir d’une séance existante"
            meta="copie ses exos et ses prescriptions, puis tu ajustes"
            onClick={() => setStep({ step: 'pick' })}
          />
        </List>
      ) : (
        <>
          <div className="px-5">
            <TextLink tone="muted" onClick={() => setStep({ step: 'choice' })}>
              Revenir au choix
            </TextLink>
          </div>
          {groups.map((g) => (
            <section key={g.routineId}>
              <SectionTitle aside={g.current ? 'courante' : undefined}>{g.routineName}</SectionTitle>
              <List label={g.routineName}>
                {g.entries.map((e) => (
                  <Row
                    key={e.seanceId}
                    title={e.seanceName}
                    meta={`${e.exerciseCount === 0 ? 'aucun exo' : exoCount(e.exerciseCount)}${e.isArchived ? ' · archivée' : ''}`}
                    muted={e.isArchived}
                    onClick={() => setStep({ step: 'name', source: e })}
                  />
                ))}
              </List>
            </section>
          ))}
        </>
      )}
    </Sheet>
  );
}
