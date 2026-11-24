// Surface « Séances » : édition du plan, au calme (refonte E, DESIGN.md).
//
// Trois niveaux, une page chacun, navigation en state local (pas de routeur) :
//   routines  la courante en tête (titre en demi-gras + le mot), les autres, les
//             archivées repliées (« Désarchiver » sur leur ligne) ; « Créer une
//             routine » est l'action principale.
//   routine   ses séances dans l'ordre de rotation (Réordonner = Monter /
//             Descendre en mots, par la RPC `reorder_seances`), créer une séance
//             vierge ou copiée d'une autre (ADR 0015), séances archivées
//             repliées.
//   éditeur   SeanceEditor : prescriptions, notes d'instructions.
//
// Un objet, une porte d'actions : son ⋯, sur sa ligne dans la liste parente
// comme en tête de sa propre page, ouvre la même feuille (seances-ui.tsx ;
// renommer, dupliquer, définir courante, archiver ou supprimer, ADR 0017). Ce
// qui demande confirmation est décidé par object-actions.ts.
//
// Après chaque geste, une ligne d'état dit ce qui vient d'arriver, en tête de la
// page où l'on se trouve ensuite (« Upper A est archivée. » et « Désarchiver ») ;
// elle est tenue par `SeancesScreen` pour survivre au retour de l'éditeur, et
// s'efface à la navigation suivante.
//
// Les conteneurs chargent et écrivent (features/authoring/data.ts) ; les vues
// reçoivent données et callbacks. Chaque écriture est attendue : un refus
// s'affiche là où le geste a été fait, en français (`errorMessage`).
//
// Aucun usage du signal ici : rien n'y est « mieux que la dernière fois ».
// Aucune confirmation par `window.confirm` : dans la feuille (`Confirm`), le
// texte dit ce qui sera perdu.
import { useCallback, useMemo, useState } from 'react';
import { ROUTINE_VIEW_PREFIX, ROUTINES_VIEW } from '../../lib/dated-read';
import { useDatedLoad } from '../../lib/use-dated-load';
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
import { menuLabel, routineMenu, seanceMenu } from './object-actions';
import { requestLeave } from './seance-dirty';
import { errorMessage } from '../../lib/error-message';
import { exoCount, seanceCount } from './seance-format';
import { reorderLock } from './reorder-lock';
import { NameSheet, ReorderRow, RoutineActionsSheet, SeanceActionsSheet, StatusLine, type PlanFlash } from './seances-ui';
import {
  ActionNote,
  CopyNote,
  Disclosure,
  EmptyState,
  FieldError,
  IconButton,
  List,
  LoadError,
  Loading,
  OfflineState,
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

/** Rend au plan l'objet que la ligne d'état vient d'archiver. */
async function restore(target: NonNullable<PlanFlash['unarchive']>): Promise<void> {
  if (target.kind === 'seance') await unarchiveSeance(target.id);
  else await unarchiveRoutine(target.id);
}

const archived = (kind: 'seance' | 'routine', id: string, name: string): PlanFlash => ({
  text: `${name} est archivée.`,
  unarchive: { kind, id, name },
});

export function SeancesScreen() {
  const [view, setView] = useState<View>({ kind: 'routines' });
  const [flash, setFlash] = useState<PlanFlash | null>(null);
  // Toute navigation efface la phrase ; un geste qui navigue pose la sienne.
  const go = (next: View, note: PlanFlash | null = null) => {
    setView(next);
    setFlash(note);
  };

  if (view.kind === 'editor') {
    const { seance, ctx } = view;
    const toRoutine = (note: PlanFlash) => go({ kind: 'routine', routineId: ctx.routine.id }, note);
    return (
      <SeanceEditor
        key={seance.id}
        seanceId={seance.id}
        seanceName={seance.name}
        routineName={ctx.routine.name}
        isCurrentRoutine={ctx.isCurrentRoutine}
        executed={ctx.executed}
        copyName={nextFreeName(seance.name, ctx.takenNames)}
        flash={flash?.text ?? null}
        onBack={() => go({ kind: 'routine', routineId: ctx.routine.id })}
        onRename={async (name) => {
          const renamed = await renameSeance(seance.id, name);
          go(
            { kind: 'editor', seance: renamed, ctx: { ...ctx, takenNames: ctx.takenNames.map((n) => (n === seance.name ? renamed.name : n)) } },
            { text: `La séance s’appelle maintenant ${renamed.name}.` },
          );
        }}
        onDuplicate={async (name) => {
          const copy = await duplicateSeance(ctx.routine.id, seance.id, name);
          // Ouvrir la copie fait disparaître cet éditeur : par la garde de sortie.
          requestLeave(() =>
            go(
              { kind: 'editor', seance: copy, ctx: { ...ctx, executed: false, takenNames: [...ctx.takenNames, copy.name] } },
              { text: `Copie de ${seance.name} créée. Elle part sans historique.` },
            ),
          );
        }}
        onArchive={async () => {
          await archiveSeance(seance.id);
          toRoutine(archived('seance', seance.id, seance.name));
        }}
        onDelete={async () => {
          await deleteSeance(seance.id);
          toRoutine({ text: `${seance.name} est supprimée.` });
        }}
      />
    );
  }

  if (view.kind === 'routine') {
    return (
      <RoutineContainer
        key={view.routineId}
        routineId={view.routineId}
        flash={flash}
        onFlash={setFlash}
        onBack={(note) => go({ kind: 'routines' }, note ?? null)}
        onEdit={(seance, ctx, note) => go({ kind: 'editor', seance, ctx }, note ?? null)}
      />
    );
  }

  return <RoutinesContainer flash={flash} onFlash={setFlash} onOpen={(routineId) => go({ kind: 'routine', routineId })} />;
}

// =====================================================================
// Routines
// =====================================================================

/**
 * La liste des routines, lue d'un bloc et gardée en copie datée (lib/dated-read) :
 * hors ligne, la dernière copie se montre avec sa date. Des tableaux, pas de
 * `Set` : la copie passe par JSON.
 */
interface RoutinesData {
  routines: RoutineRow[];
  currentRoutineId: string | null;
  catalog: SeanceCatalogEntry[];
  executedRoutineIds: string[];
}

async function loadRoutinesData(): Promise<RoutinesData> {
  // Lectures indépendantes, en parallèle. Le catalogue des séances donne le
  // nombre de séances de chaque routine ; l'historique du plan dit qui
  // s'archive et qui se supprime (ADR 0017).
  const [routines, currentRoutineId, catalog, history] = await Promise.all([
    listRoutines(),
    getCurrentRoutineId(),
    loadSeanceCatalog(),
    loadPlanHistory(),
  ]);
  return { routines, currentRoutineId, catalog, executedRoutineIds: [...history.executedRoutineIds] };
}

function RoutinesContainer({
  flash,
  onFlash,
  onOpen,
}: {
  flash: PlanFlash | null;
  onFlash: (note: PlanFlash | null) => void;
  onOpen: (routineId: string) => void;
}) {
  const { state, reload, refresh, online, showDate } = useDatedLoad(ROUTINES_VIEW, loadRoutinesData);
  const executedRoutineIds = useMemo(
    () => new Set(state.phase === 'ready' ? state.value.executedRoutineIds : []),
    [state],
  );

  if (state.phase === 'loading') {
    return (
      <Screen>
        <ScreenHeader title="Séances" />
        <Loading label="Chargement des routines…" />
      </Screen>
    );
  }
  if (state.phase === 'offline') {
    return (
      <Screen>
        <ScreenHeader title="Séances" />
        <OfflineState surface="Séances" />
      </Screen>
    );
  }
  if (state.phase === 'error') {
    return (
      <Screen>
        <ScreenHeader title="Séances" />
        <LoadError intro="Impossible de charger tes routines." message={state.message} onRetry={reload} />
      </Screen>
    );
  }

  const load = state.value;
  const currentName = load.routines.find((r) => r.id === load.currentRoutineId)?.name ?? null;
  /** Écrit, rafraîchit la liste, puis dit ce qui vient d'arriver. L'écriture a
   *  marqué la copie périmée : la relecture passe par le réseau. */
  const write = async (action: () => Promise<unknown>, note: PlanFlash) => {
    await action();
    refresh();
    onFlash(note);
  };

  return (
    <RoutinesView
      routines={load.routines}
      currentRoutineId={load.currentRoutineId}
      currentRoutineName={currentName}
      catalog={load.catalog}
      executedRoutineIds={executedRoutineIds}
      copyAt={showDate ? state.at : null}
      online={online}
      flash={flash}
      onOpen={onOpen}
      onCreate={async (name) => {
        const created = await createRoutine({ name });
        onOpen(created.id);
      }}
      onRename={(r, name) => write(() => renameRoutine(r.id, name), { text: `${r.name} s’appelle maintenant ${name}.` })}
      onSetCurrent={(r) => write(() => setCurrentRoutine(r.id), { text: `${r.name} est la routine courante. Un nouveau bloc commence.` })}
      onArchive={(r) => write(() => archiveRoutine(r.id), archived('routine', r.id, r.name))}
      onDelete={(r) => write(() => deleteRoutine(r.id), { text: `${r.name} est supprimée.` })}
      onUnarchive={(r) => write(() => unarchiveRoutine(r.id), { text: `${r.name} est désarchivée.` })}
      onUndoArchive={async (target) => write(() => restore(target), { text: `${target.name} est désarchivée.` })}
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
  currentRoutineName,
  catalog,
  executedRoutineIds,
  copyAt = null,
  online = true,
  flash,
  onOpen,
  onCreate,
  onRename,
  onSetCurrent,
  onArchive,
  onDelete,
  onUnarchive,
  onUndoArchive,
}: {
  routines: RoutineRow[];
  currentRoutineId: string | null;
  currentRoutineName: string | null;
  catalog: SeanceCatalogEntry[];
  /** Routines dont une séance a été exécutée : elles s'archivent (ADR 0017). */
  executedRoutineIds: ReadonlySet<string>;
  /** La liste montrée est une copie locale de cette heure-là (hors ligne). */
  copyAt?: number | null;
  online?: boolean;
  flash: PlanFlash | null;
  onOpen: (routineId: string) => void;
  onCreate: (name: string) => Promise<void>;
  onRename: (routine: RoutineRow, name: string) => Promise<void>;
  onSetCurrent: (routine: RoutineRow) => Promise<void>;
  onArchive: (routine: RoutineRow) => Promise<void>;
  onDelete: (routine: RoutineRow) => Promise<void>;
  onUnarchive: (routine: RoutineRow) => Promise<void>;
  onUndoArchive: (target: NonNullable<PlanFlash['unarchive']>) => Promise<void>;
}) {
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [menuFor, setMenuFor] = useState<RoutineRow | null>(null);
  const [unarchiving, setUnarchiving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const live = routines.filter((r) => r.archived_at === null);
  const current = live.find((r) => r.id === currentRoutineId);
  const others = live.filter((r) => r.id !== currentRoutineId);
  const archivedRoutines = routines.filter((r) => r.archived_at !== null);
  const meta = (r: RoutineRow) => seanceCount(activeSeanceCount(catalog, r.id));
  const undo = flash?.unarchive;
  const menuOf = (r: RoutineRow) =>
    routineMenu({ executed: executedRoutineIds.has(r.id), isCurrent: r.id === currentRoutineId, archived: r.archived_at !== null });
  // Le geste fini, la feuille se ferme : la ligne d'état prend le relais.
  const closing = (action: (r: RoutineRow) => Promise<void>) => async (r: RoutineRow) => {
    await action(r);
    setMenuFor(null);
  };
  const more = (r: RoutineRow) => (
    <IconButton
      icon="more"
      tone="muted"
      className="-mr-2.5"
      label={menuLabel(
        menuOf(r).items.map((i) => i.key),
        r.name,
      )}
      onClick={() => setMenuFor(r)}
    />
  );

  return (
    <Screen bottom={<PrimaryButton onClick={() => setCreating(true)}>Créer une routine</PrimaryButton>}>
      {/* Le titre est le mot de la navigation ; ce qu'on y range se dit dessous. */}
      <ScreenHeader title="Séances" meta="Tes routines, et les séances de chacune" />
      {copyAt !== null && <CopyNote at={copyAt} online={online} />}
      {flash && <StatusLine flash={flash} onUnarchive={undo ? () => onUndoArchive(undo) : undefined} />}
      {live.length === 0 && archivedRoutines.length === 0 ? (
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
                trailing={more(current)}
              />
            </List>
          )}
          {others.length > 0 && (
            <>
              <SectionTitle>{current ? 'Autres routines' : 'Tes routines'}</SectionTitle>
              <List label="Autres routines">
                {others.map((r) => (
                  <Row key={r.id} title={r.name} meta={meta(r)} onClick={() => onOpen(r.id)} trailing={more(r)} />
                ))}
              </List>
            </>
          )}
          {archivedRoutines.length > 0 && (
            <Disclosure label="Routines archivées" count={archivedRoutines.length} open={showArchived} onToggle={() => setShowArchived((v) => !v)}>
              <p className="px-5 pb-3 text-[14px] leading-[1.45] text-muted">
                Hors du plan. Leurs courbes et leurs blocs restent dans l’analyse.
              </p>
              <List label="Routines archivées">
                {archivedRoutines.map((r) => (
                  <Row
                    key={r.id}
                    muted
                    title={r.name}
                    meta="archivée"
                    onClick={() => onOpen(r.id)}
                    trailing={
                      <TextLink
                        tone="muted"
                        className="-mr-1 flex-none px-1 text-[15px]"
                        ariaLabel={`Désarchiver ${r.name}`}
                        onClick={
                          unarchiving
                            ? undefined
                            : () => {
                                setUnarchiving(r.id);
                                setError(null);
                                onUnarchive(r)
                                  .catch((err: unknown) => setError(errorMessage(err)))
                                  .finally(() => setUnarchiving(null));
                              }
                        }
                      >
                        {unarchiving === r.id ? 'Un instant…' : 'Désarchiver'}
                      </TextLink>
                    }
                  />
                ))}
              </List>
              {error && <FieldError className="mx-5">{error}</FieldError>}
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
      {menuFor && (
        <RoutineActionsSheet
          key={menuFor.id}
          routineName={menuFor.name}
          currentRoutineName={currentRoutineName}
          menu={menuOf(menuFor)}
          seanceTotal={catalog.filter((e) => e.routineId === menuFor.id).length}
          onClose={() => setMenuFor(null)}
          onRename={(name) => closing((r) => onRename(r, name))(menuFor)}
          onSetCurrent={() => closing(onSetCurrent)(menuFor)}
          onArchive={() => closing(onArchive)(menuFor)}
          onDelete={() => closing(onDelete)(menuFor)}
        />
      )}
    </Screen>
  );
}

// =====================================================================
// Une routine : ses séances
// =====================================================================

/** Une routine et ce qu'il faut pour sa page, en copie datée (cf. `RoutinesData`). */
interface RoutineData {
  routines: RoutineRow[];
  currentRoutineId: string | null;
  seances: SeanceRow[];
  catalog: SeanceCatalogEntry[];
  executedSeanceIds: string[];
  executedRoutineIds: string[];
}

function RoutineContainer({
  routineId,
  flash,
  onFlash,
  onBack,
  onEdit,
}: {
  routineId: string;
  flash: PlanFlash | null;
  onFlash: (note: PlanFlash | null) => void;
  /** Retour à la liste, avec la phrase du geste qui y renvoie (archivée, supprimée). */
  onBack: (note?: PlanFlash) => void;
  onEdit: (seance: SeanceRow, ctx: EditorContext, note?: PlanFlash) => void;
}) {
  // Le catalogue (ADR 0015) sert à la fois au nombre d'exos de chaque séance et
  // à la copie d'une séance existante.
  const fetchRoutine = useCallback(async (): Promise<RoutineData> => {
    const [routines, currentRoutineId, seances, catalog, history] = await Promise.all([
      listRoutines(),
      getCurrentRoutineId(),
      listSeances(routineId),
      loadSeanceCatalog(),
      loadPlanHistory(),
    ]);
    return {
      routines,
      currentRoutineId,
      seances,
      catalog,
      executedSeanceIds: [...history.executedSeanceIds],
      executedRoutineIds: [...history.executedRoutineIds],
    };
  }, [routineId]);
  // Un rafraîchissement après une écriture garde le contenu monté : pas de
  // saut en haut de page, pas de chargement affiché.
  const { state, reload: retry, refresh: reload, online, showDate } = useDatedLoad(`${ROUTINE_VIEW_PREFIX}${routineId}`, fetchRoutine);
  const executedSeanceIds = useMemo(() => new Set(state.phase === 'ready' ? state.value.executedSeanceIds : []), [state]);

  const back = { label: 'Séances', onClick: () => onBack() };
  if (state.phase === 'loading') {
    return (
      <Screen>
        <ScreenHeader title="Routine" back={back} />
        <Loading label="Chargement des séances…" />
      </Screen>
    );
  }
  if (state.phase === 'offline') {
    return (
      <Screen>
        <ScreenHeader title="Routine" back={back} />
        <OfflineState surface="Séances" />
      </Screen>
    );
  }
  if (state.phase === 'error') {
    return (
      <Screen>
        <ScreenHeader title="Routine" back={back} />
        <LoadError intro="Impossible de charger cette routine." message={state.message} onRetry={retry} />
      </Screen>
    );
  }
  const data = state.value;
  const routine = data.routines.find((r) => r.id === routineId);
  if (!routine) {
    return (
      <Screen>
        <ScreenHeader title="Routine introuvable" back={back} />
        <EmptyState title="Cette routine n’existe plus" body="Elle a pu être supprimée depuis un autre appareil." />
      </Screen>
    );
  }

  const { seances } = data;
  const isCurrent = routine.id === data.currentRoutineId;
  const currentName = data.routines.find((r) => r.id === data.currentRoutineId)?.name ?? null;
  const takenNames = seances.map((s) => s.name);
  const ctxOf = (seance: SeanceRow): EditorContext => ({
    routine,
    isCurrentRoutine: isCurrent,
    executed: executedSeanceIds.has(seance.id),
    takenNames,
  });
  /** Écrit, rafraîchit la page, puis dit ce qui vient d'arriver. */
  const write = async (action: () => Promise<unknown>, note: PlanFlash) => {
    await action();
    reload();
    onFlash(note);
  };

  return (
    <RoutineView
      routine={routine}
      isCurrent={isCurrent}
      currentRoutineName={currentName}
      executed={data.executedRoutineIds.includes(routine.id)}
      executedSeanceIds={executedSeanceIds}
      seances={seances}
      catalog={data.catalog}
      copyAt={showDate ? state.at : null}
      online={online}
      orderVerified={!state.copy}
      orderLate={showDate}
      onRetryOrder={reload}
      flash={flash}
      onBack={() => onBack()}
      onEdit={(seance) => onEdit(seance, ctxOf(seance))}
      onCreateSeance={async (name, sourceId) => {
        const created = sourceId ? await duplicateSeance(routine.id, sourceId, name) : await createSeance(routine.id, { name });
        // Une séance neuve s'ouvre aussitôt dans l'éditeur : on y ajoute ses exos.
        onEdit(created, { routine, isCurrentRoutine: isCurrent, executed: false, takenNames: [...takenNames, created.name] });
      }}
      onReorder={async (orderedIds) => {
        await reorderSeances(routine.id, orderedIds);
        reload();
      }}
      onRenameSeance={async (s, name) => {
        const renamed = await renameSeance(s.id, name);
        reload();
        onFlash({ text: `${s.name} s’appelle maintenant ${renamed.name}.` });
      }}
      onDuplicateSeance={async (s, name) => {
        const copy = await duplicateSeance(routine.id, s.id, name);
        // La copie s'ouvre, comme depuis l'éditeur : on vient la modifier.
        onEdit(
          copy,
          { routine, isCurrentRoutine: isCurrent, executed: false, takenNames: [...takenNames, copy.name] },
          { text: `Copie de ${s.name} créée. Elle part sans historique.` },
        );
      }}
      onArchiveSeance={(s) => write(() => archiveSeance(s.id), archived('seance', s.id, s.name))}
      onDeleteSeance={(s) => write(() => deleteSeance(s.id), { text: `${s.name} est supprimée.` })}
      onUnarchiveSeance={(s) => write(() => unarchiveSeance(s.id), { text: `${s.name} est désarchivée.` })}
      onUndoArchive={(target) => write(() => restore(target), { text: `${target.name} est désarchivée.` })}
      onRename={(name) => write(() => renameRoutine(routine.id, name), { text: `La routine s’appelle maintenant ${name}.` })}
      onSetCurrent={() => write(() => setCurrentRoutine(routine.id), { text: `${routine.name} est la routine courante. Un nouveau bloc commence.` })}
      onArchive={async () => {
        // Archivée, elle quitte la liste : on y retourne, la phrase et « Désarchiver » en tête.
        await archiveRoutine(routine.id);
        onBack(archived('routine', routine.id, routine.name));
      }}
      onUnarchive={() => write(() => unarchiveRoutine(routine.id), { text: `${routine.name} est désarchivée.` })}
      onDelete={async () => {
        await deleteRoutine(routine.id);
        onBack({ text: `${routine.name} est supprimée.` });
      }}
    />
  );
}

export function RoutineView({
  routine,
  isCurrent,
  currentRoutineName,
  executed,
  executedSeanceIds,
  seances: allSeances,
  catalog,
  copyAt = null,
  online = true,
  orderVerified = true,
  orderLate = false,
  onRetryOrder,
  flash,
  onBack,
  onEdit,
  onCreateSeance,
  onReorder,
  onRenameSeance,
  onDuplicateSeance,
  onArchiveSeance,
  onDeleteSeance,
  onUnarchiveSeance,
  onUndoArchive,
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
  /** Séances déjà exécutées : elles s'archivent au lieu de se supprimer. */
  executedSeanceIds: ReadonlySet<string>;
  seances: SeanceRow[];
  catalog: SeanceCatalogEntry[];
  /** La page montrée est une copie locale de cette heure-là (hors ligne). */
  copyAt?: number | null;
  online?: boolean;
  /** L'ordre affiché vient d'une lecture réseau, pas d'une copie encore à revalider (reorder-lock). */
  orderVerified?: boolean;
  /** Copie montrée sans revalidation arrivée dans le délai (useDatedLoad `showDate`). */
  orderLate?: boolean;
  /** Relance la vérification de l'ordre, sans quitter la page. */
  onRetryOrder?: () => void;
  flash: PlanFlash | null;
  onBack: () => void;
  onEdit: (seance: SeanceRow) => void;
  /** Crée une séance vierge (`sourceId` absent) ou la copie d'une existante. */
  onCreateSeance: (name: string, sourceId: string | null) => Promise<void>;
  onReorder: (orderedIds: string[]) => Promise<void>;
  onRenameSeance: (seance: SeanceRow, name: string) => Promise<void>;
  onDuplicateSeance: (seance: SeanceRow, name: string) => Promise<void>;
  onArchiveSeance: (seance: SeanceRow) => Promise<void>;
  onDeleteSeance: (seance: SeanceRow) => Promise<void>;
  onUnarchiveSeance: (seance: SeanceRow) => Promise<void>;
  onUndoArchive: (target: NonNullable<PlanFlash['unarchive']>) => Promise<void>;
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
  const [creating, setCreating] = useState(false);
  const [routineMenuOpen, setRoutineMenuOpen] = useState(false);
  const [seanceMenuFor, setSeanceMenuFor] = useState<SeanceRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unarchiving, setUnarchiving] = useState<string | null>(null);

  const archivedRoutine = routine.archived_at !== null;
  const seances = allSeances.filter((s) => s.archived_at === null);
  const archivedSeances = allSeances.filter((s) => s.archived_at !== null);
  const takenNames = allSeances.map((s) => s.name);
  const menu = routineMenu({ executed, isCurrent, archived: archivedRoutine });
  const exerciseCountOf = (id: string) => catalog.find((e) => e.seanceId === id)?.exerciseCount;
  const exos = (id: string) => {
    const n = exerciseCountOf(id);
    return n === undefined ? undefined : exoCount(n);
  };
  const seanceItems = (s: SeanceRow) =>
    seanceMenu({ executed: executedSeanceIds.has(s.id), inCurrentRoutine: isCurrent, hasExercises: (exerciseCountOf(s.id) ?? 0) > 0 });
  const status = archivedRoutine ? 'archivée' : isCurrent ? 'routine courante' : null;
  const lock = reorderLock({ moving, verified: orderVerified, online, late: orderLate });
  const undo = flash?.unarchive;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
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
  // Le geste fini, la feuille se ferme : la ligne d'état prend le relais.
  const closingSeance = (action: (s: SeanceRow) => Promise<void>) => async () => {
    if (!seanceMenuFor) return;
    await action(seanceMenuFor);
    setSeanceMenuFor(null);
  };
  const closingRoutine = (action: () => Promise<void>) => async () => {
    await action();
    setRoutineMenuOpen(false);
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
        back={{ label: 'Séances', onClick: onBack }}
        action={
          archivedRoutine ? undefined : reorder ? (
            <SecondaryButton size="sm" onClick={toggleReorder} disabled={moving}>
              Terminé
            </SecondaryButton>
          ) : (
            <>
              {seances.length > 1 && (
                <SecondaryButton size="sm" onClick={toggleReorder} ariaLabel="Réordonner les séances">
                  Réordonner
                </SecondaryButton>
              )}
              <IconButton
                icon="more"
                framed
                label={menuLabel(
                  menu.items.map((i) => i.key),
                  routine.name,
                )}
                onClick={() => setRoutineMenuOpen(true)}
              />
            </>
          )
        }
      />
      {copyAt !== null && <CopyNote at={copyAt} online={online} />}

      {flash && <StatusLine flash={flash} onUnarchive={undo ? () => onUndoArchive(undo) : undefined} />}

      {archivedRoutine && (
        <div className="pb-2">
          <ul>
            <ActionNote>Archivée, hors du plan : ses séances ne s’ouvrent plus. Désarchive-la pour les ouvrir ou les modifier.</ActionNote>
          </ul>
          <div className="px-5">
            <TextLink onClick={busy ? undefined : () => void run(onUnarchive)}>{busy ? 'Un instant…' : 'Désarchiver'}</TextLink>
          </div>
          {error && <FieldError className="mx-5">{error}</FieldError>}
        </div>
      )}

      {seances.length === 0 ? (
        <EmptyState
          title={archivedRoutine || archivedSeances.length > 0 ? 'Aucune séance active' : 'Aucune séance dans cette routine'}
          body={
            archivedRoutine
              ? undefined
              : archivedSeances.length > 0
                ? 'Crée une séance, ou désarchive-en une plus bas.'
                : 'Crée sa première séance, puis ajoutes-y ses exos.'
          }
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
                  disabled={lock.disabled}
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
                  trailing={
                    archivedRoutine ? undefined : (
                      <IconButton
                        icon="more"
                        tone="muted"
                        className="-mr-2.5"
                        label={menuLabel(
                          seanceItems(s).map((it) => it.key),
                          s.name,
                        )}
                        onClick={() => setSeanceMenuFor(s)}
                      />
                    )
                  }
                />
              ),
            )}
          </List>
          {reorder && lock.note && (
            <p role="status" className="flex flex-wrap items-center gap-x-3 px-5 pt-3 text-[14px] leading-[1.45] text-muted">
              {lock.note}
              {lock.retry && onRetryOrder && <TextLink onClick={onRetryOrder}>Réessayer</TextLink>}
            </p>
          )}
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
                              onUnarchiveSeance(s)
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
          {!archivedRoutine && !reorder && error && <FieldError className="mx-5">{error}</FieldError>}
        </Disclosure>
      )}

      {routineMenuOpen && (
        <RoutineActionsSheet
          routineName={routine.name}
          currentRoutineName={currentRoutineName}
          menu={menu}
          seanceTotal={allSeances.length}
          onClose={() => setRoutineMenuOpen(false)}
          onRename={(name) => closingRoutine(() => onRename(name))()}
          onSetCurrent={closingRoutine(onSetCurrent)}
          onArchive={closingRoutine(onArchive)}
          onDelete={closingRoutine(onDelete)}
        />
      )}
      {seanceMenuFor && (
        <SeanceActionsSheet
          key={seanceMenuFor.id}
          seanceName={seanceMenuFor.name}
          routineName={routine.name}
          copyName={nextFreeName(seanceMenuFor.name, takenNames)}
          items={seanceItems(seanceMenuFor)}
          inCurrentRoutine={isCurrent}
          onClose={() => setSeanceMenuFor(null)}
          onRename={(name) => closingSeance((s) => onRenameSeance(s, name))()}
          onDuplicate={(name) => closingSeance((s) => onDuplicateSeance(s, name))()}
          onArchive={closingSeance(onArchiveSeance)}
          onDelete={closingSeance(onDeleteSeance)}
        />
      )}
      <CreateSeanceSheet
        open={creating}
        routineName={routine.name}
        catalog={catalog}
        takenNames={takenNames}
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
