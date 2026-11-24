// Éditeur de prescriptions d'une séance (ADR 0001 : éditer crée une NOUVELLE
// version, jamais une mutation en place). Refonte E (DESIGN.md).
//
// Architecture : `SeanceEditor` est le conteneur (charge via loadSeanceEditor,
// sauvegarde via saveSeanceVersion) ; `SeanceEditorView` reçoit données et
// callbacks.
//
// Le plan s'édite en brouillon. « Enregistrer » n'est actif que si le brouillon
// diffère de la version enregistrée (`hasPrescriptionChanges`). Dans la routine
// courante, un enregistrement ferme le bloc en cours : on le dit au-dessus du
// bouton, avant. Un exo déplié à la fois ; les chiffres se règlent aux steppers
// du kit, jamais au clavier. La note d'instructions appartient à l'exo, hors
// version : elle s'édite sur geste explicite (feuille), s'enregistre à part et
// n'allume pas « Enregistrer » ; son brouillon est tenu ICI, pour que la garde
// de sortie et le blocage de rechargement le voient (registre U27).
//
// Garde de sortie (seance-dirty) : tant qu'une saisie n'est pas enregistrée
// (prescriptions ou note), toute navigation qui ferait disparaître l'éditeur
// (retour, onglet, autre séance) passe par une feuille de confirmation dont le
// texte dit quand seule une note est en jeu. L'option sûre est le bouton
// (« Continuer l'édition »), la perte un lien.
//
// Doublons d'exos : AUTORISÉS (lourd en début, léger en finition) ; chaque ligne
// a sa propre identité (rowId). Retirer un exo se défait par « Annuler les
// modifications » tant que rien n'est enregistré (registre U31).
import { useEffect, useMemo, useRef, useState } from 'react';
import { listExercises } from '../capture/data';
import { loadExerciseNote, saveExerciseNote } from '../notes/data';
import { isBlankNote } from '../../domain/notes';
import { foldAccents } from '../../domain/text';
import type { Database } from '../../lib/database.types';
import { loadSeanceEditor, saveSeanceVersion, createPersonalExercise } from './data';
import { ExerciseForm } from '../exercises/ExerciseForm';
import { MUSCLE_GROUPS, orderMusclesCanonical } from './exercise-input';
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
  rowsToPlannedExercises,
  moveRow,
} from './prescription-edit';
import {
  hasPrescriptionChanges,
  editingResumed,
  hasUnsavedEdits,
  leavePrompt,
  noteDraftExerciseIds,
  saveControl,
  saveFailed,
  SAVE_BUSY,
  SAVE_DONE,
  SAVE_IDLE,
  type SaveStatus,
  requestLeave,
  setLeaveGuard,
} from './seance-dirty';
import { useReloadBlockWhile } from '../../pwa/useReloadBlockWhile';
import { countPlannedSets } from '../../domain/set-count';
import { errorMessage } from '../../lib/error-message';
import { planRowActions } from './archive';
import { fmtCountRange, muscleLabel, rowChange, summarizeRow } from './seance-format';
import { NameSheet, ReorderRow } from './seances-ui';
import {
  ActionRow,
  Choice,
  Confirm,
  EmptyState,
  FieldError,
  Icon,
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
  Stepper,
  TextArea,
  TextField,
  TextLink,
} from '../../ui';

type ExerciseRow = Database['public']['Tables']['exercises']['Row'];

// =====================================================================
// Conteneur : chargement + sauvegarde
// =====================================================================

type Load =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | {
      phase: 'ready';
      rows: EditorRow[];
      catalogue: ExerciseRow[];
      /** Notes d'instructions par exerciseId (issue #26), '' si aucune. */
      notes: Record<string, string>;
    };

/** Actions de la séance elle-même, portées par la surface Séances. */
export interface SeanceActions {
  /** Nom de la routine (libellé du retour). */
  routineName: string;
  /** La séance est dans la routine courante : enregistrer ouvre un nouveau bloc. */
  isCurrentRoutine: boolean;
  /** Déjà exécutée : elle s'archive au lieu de se supprimer (ADR 0017). */
  executed: boolean;
  /** Nom proposé pour une copie (libre dans la routine). */
  copyName: string;
  onRename: (name: string) => Promise<void>;
  /** Copie la version ENREGISTRÉE dans la même routine, puis l'ouvre (par la
   *  garde de sortie : un brouillon en cours le demande d'abord). */
  onDuplicate: (name: string) => Promise<void>;
  onArchive: () => Promise<void>;
  onDelete: () => Promise<void>;
}

export interface SeanceEditorProps extends SeanceActions {
  /** Id de la séance éditée (charge sa version courante, sauve une nouvelle version). */
  seanceId: string;
  /** Nom de la séance (titre). */
  seanceName: string;
  /** Retour à la routine. */
  onBack: () => void;
}

let rowIdSeq = 0;
function freshRowId(): string {
  rowIdSeq += 1;
  return `row-${rowIdSeq}`;
}

export function SeanceEditor({ seanceId, seanceName, onBack, ...actions }: SeanceEditorProps) {
  const [load, setLoad] = useState<Load>({ phase: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  // Dernière séance réellement chargée : on n'affiche le chargement que pour un
  // NOUVEAU contexte. Un rafraîchissement de la MÊME séance garde le contenu monté.
  const loadedSeanceRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    if (loadedSeanceRef.current !== seanceId) setLoad({ phase: 'loading' });

    void (async () => {
      try {
        // Prescriptions et catalogue sont indépendants : on parallélise.
        const [prescriptions, catalogue] = await Promise.all([loadSeanceEditor(seanceId), listExercises()]);
        if (!active) return;
        const rows: EditorRow[] = prescriptions.map((p) => ({
          rowId: freshRowId(),
          exerciseId: p.exerciseId,
          exerciseName: p.exerciseName,
          muscleGroup: p.muscleGroup,
          primaryMuscles: p.primaryMuscles,
          unilateral: p.unilateral,
          sets: rangeToField(p.sets),
          reps: rangeToField(p.reps),
          rir: rangeToField(p.rir),
        }));
        // Note d'instructions (issue #26) par exo distinct présent dans la séance.
        const exerciseIds = [...new Set(prescriptions.map((p) => p.exerciseId))];
        const noteEntries = await Promise.all(exerciseIds.map(async (id) => [id, await loadExerciseNote(id)] as const));
        if (!active) return;
        const notes = Object.fromEntries(noteEntries);
        loadedSeanceRef.current = seanceId;
        setLoad({ phase: 'ready', rows, catalogue, notes });
      } catch (err) {
        if (!active) return;
        setLoad({ phase: 'error', message: errorMessage(err) });
      }
    })();

    return () => {
      active = false;
    };
  }, [seanceId, reloadKey]);

  if (load.phase === 'loading' || load.phase === 'error') {
    return (
      <Screen>
        <ScreenHeader title={seanceName} back={{ label: actions.routineName, onClick: onBack }} />
        {load.phase === 'loading' ? (
          <Loading label="Chargement de la séance…" />
        ) : (
          <LoadError
            intro="Impossible de charger cette séance."
            message={load.message}
            onRetry={() => {
              loadedSeanceRef.current = null;
              setReloadKey((k) => k + 1);
            }}
          />
        )}
      </Screen>
    );
  }

  return (
    <SeanceEditorView
      seanceName={seanceName}
      initialRows={load.rows}
      catalogue={load.catalogue}
      initialNotes={load.notes}
      onBack={onBack}
      onSave={(rows) => saveSeanceVersion(seanceId, rowsToPrescriptionInputs(rows))}
      onSaveExerciseNote={saveExerciseNote}
      onCreatePersonal={async (input) => {
        const created = await createPersonalExercise(input);
        return {
          id: created.id,
          name: created.name,
          muscleGroup: created.muscle_group,
          primaryMuscles: created.primary_muscles ?? [],
          unilateral: created.unilateral ?? false,
          personal: true,
        };
      }}
      makeRowId={freshRowId}
      actions={actions}
    />
  );
}

// =====================================================================
// Présentation
// =====================================================================

/** Un exo du catalogue, réduit à ce dont la vue a besoin. */
export interface CatalogueExercise {
  id: string;
  name: string;
  muscleGroup: string;
  /** Muscles principaux (#33) : alimente le décompte PRÉVU quand l'exo est ajouté. */
  primaryMuscles: string[];
  /** Mouvement unilatéral (#33) : pèse double au décompte total (#37). */
  unilateral: boolean;
  /** Exo perso (créé par l'utilisateur), par opposition au catalogue commun. */
  personal?: boolean;
}

/**
 * Saisie de création d'un exo perso (issue #33) : nom, LISTE de muscles
 * principaux (>= 1, vocabulaire canonique) et drapeau unilatéral. Le mapping vers
 * la row DB (muscle_group = 1er muscle, compat legacy) vit dans exercise-input.ts.
 */
export interface PersonalExerciseFormInput {
  name: string;
  primaryMuscles: string[];
  unilateral: boolean;
}

/** Raison du blocage de rechargement tenu par une séance modifiée et non enregistrée. */
const SEANCE_DRAFT_BLOCK = 'brouillon-seance';

const FIELD_LABEL: Record<FieldKey, string> = { sets: 'Séries', reps: 'Reps', rir: 'RIR' };
/** Plafond des steppers : large, la base ne borne pas davantage. */
const FIELD_CEIL: Record<FieldKey, number> = { sets: 99, reps: 99, rir: 10 };

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

export interface SeanceEditorViewProps {
  seanceName: string;
  initialRows: EditorRow[];
  /** Catalogue complet (base + perso) pour le sélecteur d'ajout. */
  catalogue: ExerciseRow[];
  /** Notes d'instructions par exerciseId (issue #26), '' si aucune. */
  initialNotes: Record<string, string>;
  onBack: () => void;
  /** Crée une nouvelle version. Résolu = enregistré. */
  onSave: (rows: EditorRow[]) => Promise<string>;
  /**
   * Enregistre la note d'instructions d'un exo (issue #26). Indépendante du
   * versionnage des prescriptions : sauvegardée à part, immédiatement. Corps
   * vidé = note effacée.
   */
  onSaveExerciseNote: (exerciseId: string, body: string) => Promise<void>;
  /** Crée un exo perso et renvoie sa forme réduite (pour l'ajouter aussitôt). */
  onCreatePersonal: (input: PersonalExerciseFormInput) => Promise<CatalogueExercise>;
  /** Fabrique de rowId (injectée pour rester déterministe en test). */
  makeRowId: () => string;
  actions: SeanceActions;
}

type Pending = null | 'archive' | 'delete';

export function SeanceEditorView({
  seanceName,
  initialRows,
  catalogue,
  initialNotes,
  onBack,
  onSave,
  onSaveExerciseNote,
  onCreatePersonal,
  makeRowId,
  actions,
}: SeanceEditorViewProps) {
  const [rows, setRows] = useState<EditorRow[]>(initialRows);
  // Dernières lignes ENREGISTRÉES : la base de comparaison du drapeau « modifié ».
  // Elle avance à chaque enregistrement réussi, sinon le retour différé qui suit
  // demanderait de confirmer la perte d'une saisie déjà enregistrée.
  const [savedRows, setSavedRows] = useState<EditorRow[]>(initialRows);
  const dirty = hasPrescriptionChanges(savedRows, rows);
  // Navigation en attente de confirmation (retour, onglet, autre séance), tant
  // que des modifications ne sont pas enregistrées.
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);
  // Notes d'instructions par exo (issue #26), éditées et sauvegardées à part du
  // versionnage des prescriptions. Une note vaut pour TOUTES les lignes du même exo.
  const [notes, setNotes] = useState<Record<string, string>>(initialNotes);
  // Brouillons des notes, par exo : tenus ICI et non dans la feuille, pour que la
  // garde de sortie et le blocage de rechargement les voient. Un brouillon
  // survit à la fermeture de la feuille.
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  // Quitter perdrait-il une saisie ? Prescriptions modifiées OU brouillon de
  // note. « Enregistrer » reste sur `dirty` seul (cf. seance-dirty).
  const unsaved = hasUnsavedEdits({ savedRows, rows, savedNotes: notes, noteDrafts });
  // Catalogue local : on y ajoute les exos perso créés à la volée, sans recharger.
  const [catalog, setCatalog] = useState<CatalogueExercise[]>(() =>
    catalogue.map((e) => ({
      id: e.id,
      name: e.name,
      muscleGroup: e.muscle_group,
      primaryMuscles: e.primary_muscles ?? [],
      unilateral: e.unilateral ?? false,
      personal: e.owner_id !== null,
    })),
  );
  const [adding, setAdding] = useState(false);
  const [creatingExo, setCreatingExo] = useState<{ prefill: string } | null>(null);
  const [save, setSave] = useState<SaveStatus>(SAVE_IDLE);
  const [open, setOpen] = useState<string | null>(null);
  const [reorder, setReorder] = useState(false);
  const [moved, setMoved] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Après un ajout, l'exo neuf s'ouvre et vient en haut de l'écran. Saut sec,
  // jamais de défilement doux forcé (registre U36, « Réduire les animations »).
  const [scrollTo, setScrollTo] = useState<string | null>(null);
  useEffect(() => {
    if (!scrollTo) return;
    document.getElementById(`exo-${scrollTo}`)?.scrollIntoView({ block: 'start' });
    setScrollTo(null);
  }, [scrollTo]);

  // Retour différé (900 ms) après une sauvegarde réussie. Id gardé en ref et
  // annulé au démontage : si l'éditeur disparaît avant l'échéance, le timer ne
  // déclenche pas `onBack` sur une instance démontée.
  const backTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (backTimerRef.current != null) clearTimeout(backTimerRef.current);
    };
  }, []);

  // Garde de sortie (cf. seance-dirty) : tant que l'éditeur porte une saisie non
  // enregistrée (prescriptions ou note), toute navigation qui le ferait
  // disparaître passe par la confirmation ci-dessous.
  useEffect(() => {
    if (!unsaved) return;
    setLeaveGuard((proceed) => {
      // La confirmation est une feuille : on referme celles qui seraient ouvertes
      // (le brouillon d'une note reste tenu ici), sinon la demande resterait en
      // attente derrière elles.
      setAdding(false);
      setNoteFor(null);
      setRenaming(false);
      setDuplicating(false);
      setPendingLeave(() => proceed);
    });
    return () => setLeaveGuard(null);
  }, [unsaved]);

  // Tant que l'éditeur porte une saisie non enregistrée (prescriptions ou note),
  // aucun rechargement automatique (nouvelle version en attente) : elle ne vit
  // qu'en mémoire. Levé dès qu'il n'y en a plus (enregistrement) et au
  // démontage ; `releaseDraft` le lève tout de suite à l'abandon confirmé (cf.
  // pwa/useReloadBlockWhile).
  const releaseDraft = useReloadBlockWhile(SEANCE_DRAFT_BLOCK, unsaved);

  function requestBack() {
    if (unsaved) setPendingLeave(() => onBack);
    else onBack();
  }

  /** Quitte sans repasser par la garde (abandon confirmé). Archiver ou supprimer
   *  la séance démonte l'éditeur : la garde et le blocage tombent avec lui. */
  function leaveNow(proceed: () => void) {
    setLeaveGuard(null);
    releaseDraft();
    proceed();
  }

  function updateRow(rowId: string, key: FieldKey, next: FieldValue) {
    setRows((prev) => prev.map((r) => (r.rowId === rowId ? { ...r, [key]: next } : r)));
  }

  // Enregistre la note d'un exo : optimiste en local (toutes ses lignes la
  // reflètent), puis persiste. En cas d'échec, on remet la valeur d'avant pour
  // ne pas laisser croire à un enregistrement réussi.
  async function saveNote(exerciseId: string, body: string): Promise<void> {
    const before = notes[exerciseId] ?? '';
    setNotes((prev) => ({ ...prev, [exerciseId]: body }));
    try {
      await onSaveExerciseNote(exerciseId, body);
    } catch (err) {
      setNotes((prev) => ({ ...prev, [exerciseId]: before }));
      throw err;
    }
  }

  function addExercise(exo: CatalogueExercise) {
    const rowId = makeRowId();
    setRows((prev) => [
      ...prev,
      {
        rowId,
        exerciseId: exo.id,
        exerciseName: exo.name,
        muscleGroup: exo.muscleGroup,
        primaryMuscles: exo.primaryMuscles,
        unilateral: exo.unilateral,
        ...defaultFields(),
      },
    ]);
    setAdding(false);
    setReorder(false);
    setOpen(rowId);
    setScrollTo(rowId);
  }

  async function handleSave() {
    setSave(SAVE_BUSY);
    try {
      await onSave(rows);
      setSavedRows(rows);
      setPendingLeave(null); // plus rien à perdre : une confirmation ouverte tombe.
      setSave(SAVE_DONE);
      // Laisse la confirmation visible un instant, puis retour. Par la garde de
      // sortie : s'il reste le brouillon d'une note, elle demande avant de partir.
      if (backTimerRef.current != null) clearTimeout(backTimerRef.current);
      backTimerRef.current = setTimeout(() => requestLeave(onBack), 900);
    } catch (err) {
      setSave(saveFailed(errorMessage(err)));
    }
  }

  async function act(action: () => Promise<void>) {
    setActing(true);
    setActionError(null);
    try {
      await action();
    } catch (err) {
      setActionError(errorMessage(err));
      setActing(false);
    }
  }

  const empty = rows.length === 0;
  // Textes de la confirmation de sortie : quand seule une note est en jeu (cas
  // du retour différé après un enregistrement réussi), elle le dit.
  const prompt = pendingLeave
    ? leavePrompt({
        prescriptions: dirty,
        noteDraftNames: noteDraftExerciseIds(
          notes,
          noteDrafts,
          rows.map((r) => r.exerciseId),
        ).map((id) => rows.find((r) => r.exerciseId === id)?.exerciseName ?? ''),
      })
    : null;
  const resumeEditing = () => {
    setPendingLeave(null);
    // « Séance enregistrée » rend sa place au bouton (cf. seance-dirty, `editingResumed`).
    setSave(editingResumed);
  };
  const lifecycle = planRowActions({ executed: actions.executed, archived: false, isCurrent: false });
  const noteRow = noteFor ? rows.find((r) => r.exerciseId === noteFor) : undefined;

  // Création d'un exo perso depuis le catalogue : un écran entier, au-dessus de
  // l'éditeur, qui garde son brouillon (l'état reste monté ici).
  if (creatingExo) {
    return (
      <ExerciseForm
        frame={{ title: 'Nouvel exo perso', meta: `Il s’ajoute à ${seanceName} une fois créé.`, backLabel: seanceName }}
        prefillName={creatingExo.prefill}
        submitLabel="Créer et ajouter"
        submitBusyLabel="Création…"
        onCancel={() => setCreatingExo(null)}
        onSubmit={async (input) => {
          const created = await onCreatePersonal(input);
          setCatalog((prev) => [...prev, created]);
          setCreatingExo(null);
          addExercise(created);
        }}
      />
    );
  }

  const showBottom = !reorder && (!empty || dirty);
  const bottom = showBottom ? (
    <>
      {save.error && (
        <p role="alert" className="break-words border-l-[3px] border-ink pl-3 text-[15px] leading-[1.45] text-ink">
          {save.error}
        </p>
      )}
      {dirty && !save.busy && (
        <div className="flex min-h-11 items-center">
          <TextLink tone="muted" onClick={() => setRows(savedRows)}>
            Annuler les modifications
          </TextLink>
        </div>
      )}
      <div className="flex">
        {saveControl(save, dirty) === 'saved' ? (
          <p role="status" aria-live="polite" className="flex h-14 flex-1 items-center rounded-block border border-line px-4 text-[18px] font-semibold text-ink">
            Séance enregistrée
          </p>
        ) : empty ? (
          // Le brouillon a tout retiré : une séance vide ne s'enregistre pas.
          <PrimaryButton disabled>Ajoute au moins un exo</PrimaryButton>
        ) : (
          <PrimaryButton
            onClick={() => void handleSave()}
            disabled={save.busy || !dirty}
            over={dirty && actions.isCurrentRoutine ? 'Un nouveau bloc commence' : undefined}
            ariaLabel={dirty && actions.isCurrentRoutine ? 'Enregistrer, un nouveau bloc commence' : undefined}
          >
            {save.busy ? 'Enregistrement…' : dirty ? 'Enregistrer' : 'Aucune modification'}
          </PrimaryButton>
        )}
      </div>
    </>
  ) : undefined;

  return (
    <Screen bottom={bottom}>
      <ScreenHeader
        title={seanceName}
        meta={empty ? undefined : plural(rows.length, 'exo')}
        back={{ label: actions.routineName, onClick: requestBack }}
        action={
          rows.length > 1 ? (
            reorder ? (
              <SecondaryButton
                size="sm"
                onClick={() => {
                  setReorder(false);
                  setMoved(null);
                }}
              >
                Terminé
              </SecondaryButton>
            ) : (
              <IconButton
                icon="reorder"
                framed
                label="Réordonner les exos"
                onClick={() => {
                  setReorder(true);
                  setMoved(null);
                  setOpen(null);
                }}
              />
            )
          ) : undefined
        }
      />

      {empty ? (
        <EmptyState
          title="Séance vide"
          body="Ajoute ses exos dans l’ordre où tu les fais en salle."
          action={<SecondaryButton onClick={() => setAdding(true)}>Ajouter un exo</SecondaryButton>}
        />
      ) : (
        <>
          <ul aria-label="Exos de la séance" className="border-t border-line">
            {rows.map((row, i) => {
              if (reorder) {
                return (
                  <ReorderRow
                    key={row.rowId}
                    rank={i + 1}
                    title={row.exerciseName}
                    meta={summarizeRow(row)}
                    first={i === 0}
                    last={i === rows.length - 1}
                    moved={moved === row.rowId}
                    onMove={(d) => {
                      setRows((prev) => moveRow(prev, i, d));
                      setMoved(row.rowId);
                    }}
                  />
                );
              }
              const note = notes[row.exerciseId] ?? '';
              const draft = noteDrafts[row.exerciseId];
              return (
                <ItemBlock
                  key={row.rowId}
                  row={row}
                  rank={i + 1}
                  change={rowChange(savedRows, row)}
                  note={note}
                  noteUnsaved={draft !== undefined && draft !== note}
                  open={open === row.rowId}
                  onToggle={() => setOpen(open === row.rowId ? null : row.rowId)}
                  onField={(k, f) => updateRow(row.rowId, k, f)}
                  onNote={() => setNoteFor(row.exerciseId)}
                  onRemove={() => {
                    setRows((prev) => prev.filter((r) => r.rowId !== row.rowId));
                    setOpen(null);
                  }}
                />
              );
            })}
          </ul>
          {!reorder && (
            <div className="px-5 pt-4">
              <SecondaryButton onClick={() => setAdding(true)} className="w-full">
                Ajouter un exo
              </SecondaryButton>
            </div>
          )}
          {!reorder && <CountSection rows={rows} savedRows={savedRows} dirty={dirty} />}
        </>
      )}

      {!reorder && (
        <section className="mt-6 pb-4">
          <SectionTitle>Séance</SectionTitle>
          {pending === 'archive' ? (
            <Confirm
              destructive={unsaved}
              keepLabel="Garder et continuer"
              confirmLabel={unsaved ? 'Archiver sans les modifications' : 'Archiver la séance'}
              busy={acting}
              error={actionError}
              onCancel={() => setPending(null)}
              onConfirm={() => void act(actions.onArchive)}
            >
              <p className="font-medium">Archiver {seanceName} ?</p>
              <p className="mt-1 text-muted">
                Elle ne se choisit plus en salle. Son historique reste dans l’analyse.
                {actions.isCurrentRoutine && ' Le plan de la routine courante change : un nouveau bloc commence.'}
                {unsaved && ' Tes modifications non enregistrées sont abandonnées.'} Tu pourras la désarchiver.
              </p>
            </Confirm>
          ) : pending === 'delete' ? (
            <Confirm
              destructive
              keepLabel="Garder la séance"
              confirmLabel="Supprimer la séance"
              busy={acting}
              error={actionError}
              onCancel={() => setPending(null)}
              onConfirm={() => void act(actions.onDelete)}
            >
              <p className="font-medium">Supprimer {seanceName} ?</p>
              <p className="mt-1 text-muted">Jamais faite, elle n’a aucun historique. C’est définitif.</p>
            </Confirm>
          ) : (
            <ul aria-label="Actions de la séance" className="pt-1">
              <ActionRow label="Renommer" onClick={() => setRenaming(true)} />
              {savedRows.length > 0 && (
                <ActionRow
                  label="Dupliquer"
                  meta={`Copie indépendante de la version enregistrée, dans ${actions.routineName}, sans historique.`}
                  onClick={() => setDuplicating(true)}
                />
              )}
              {lifecycle.canArchive ? (
                <ActionRow label="Archiver" meta="Déjà faite : elle s’archive, son historique reste entier." onClick={() => setPending('archive')} />
              ) : lifecycle.canDelete ? (
                <ActionRow label="Supprimer" meta="Jamais faite : rien à garder, elle se supprime." onClick={() => setPending('delete')} />
              ) : null}
            </ul>
          )}
        </section>
      )}

      <CatalogSheet
        open={adding}
        catalogue={catalog}
        rows={rows}
        onClose={() => setAdding(false)}
        onPick={addExercise}
        onCreate={(prefill) => {
          setAdding(false);
          setCreatingExo({ prefill });
        }}
      />

      {noteRow && (
        <NoteSheet
          exerciseName={noteRow.exerciseName}
          note={notes[noteRow.exerciseId] ?? ''}
          draft={noteDrafts[noteRow.exerciseId] ?? notes[noteRow.exerciseId] ?? ''}
          onDraft={(body) => setNoteDrafts((prev) => ({ ...prev, [noteRow.exerciseId]: body }))}
          onSave={(body) => saveNote(noteRow.exerciseId, body)}
          onClose={() => setNoteFor(null)}
        />
      )}

      <Sheet
        open={pendingLeave !== null && prompt !== null}
        title={prompt?.label ?? ''}
        onClose={resumeEditing}
        footer={
          <>
            <PrimaryButton onClick={resumeEditing}>Continuer l’édition</PrimaryButton>
            <TextLink
              tone="muted"
              className="self-start"
              onClick={() => {
                const leave = pendingLeave;
                setPendingLeave(null);
                // La garde tombe avec l'écran ; on la retire tout de suite pour que
                // la sortie confirmée ne repasse pas par elle. Le blocage de
                // rechargement aussi : la saisie est abandonnée, et un changement
                // d'onglet peut recharger dans la foulée.
                if (leave) leaveNow(leave);
              }}
            >
              Quitter sans enregistrer
            </TextLink>
          </>
        }
      >
        {prompt && (
          <div role="alert" className="px-5 pb-2">
            <p className="text-[16px] font-semibold leading-[1.35] text-ink">{prompt.title}</p>
            <p className="mt-1 text-[15px] leading-[1.45] text-muted">{prompt.detail}</p>
          </div>
        )}
      </Sheet>

      <NameSheet
        open={renaming}
        title="Renommer la séance"
        label="Nom de la séance"
        initial={seanceName}
        submitLabel="Renommer"
        requireChange
        onClose={() => setRenaming(false)}
        onSubmit={async (name) => {
          await actions.onRename(name);
          setRenaming(false);
        }}
      />
      <NameSheet
        open={duplicating}
        title={`Copier ${seanceName}`}
        label="Nom de la copie"
        initial={actions.copyName}
        intro={`Copie de la version enregistrée, dans ${actions.routineName}. Les deux séances seront indépendantes ; la copie part sans Référence ni courbe tant qu’elle n’a pas été faite.${
          unsaved ? ' Tes modifications en cours n’y sont pas.' : ''
        }`}
        submitLabel="Créer la copie"
        busyLabel="Création…"
        onClose={() => setDuplicating(false)}
        onSubmit={async (name) => {
          await actions.onDuplicate(name);
        }}
      />
    </Screen>
  );
}

// =====================================================================
// Un exo de la séance
// =====================================================================

function ItemBlock({
  row,
  rank,
  change,
  note,
  noteUnsaved,
  open,
  onToggle,
  onField,
  onNote,
  onRemove,
}: {
  row: EditorRow;
  rank: number;
  change: 'ajouté' | 'modifié' | null;
  note: string;
  noteUnsaved: boolean;
  open: boolean;
  onToggle: () => void;
  onField: (k: FieldKey, f: FieldValue) => void;
  onNote: () => void;
  onRemove: () => void;
}) {
  const name = row.exerciseName;
  const hasNote = !isBlankNote(note);
  return (
    <li id={`exo-${row.rowId}`} className="relative scroll-mt-[calc(var(--safe-top)+0.5rem)] border-b border-line">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex min-h-16 w-full items-start gap-3 px-5 py-3 text-left active:opacity-70"
      >
        <span className="tnum w-6 flex-none pt-px text-[15px] text-faint">{rank}</span>
        <span className="min-w-0 flex-1">
          <span className={`block break-words text-[17px] leading-[1.25] text-ink ${open ? 'font-semibold' : 'font-medium'}`}>{name}</span>
          <span className="mt-1 flex flex-wrap gap-x-1.5 text-[14px] text-muted">
            <span className="whitespace-nowrap text-ink">{summarizeRow(row)}</span>
            {row.unilateral && <span>· unilatéral</span>}
            {noteUnsaved ? <span className="font-medium text-ink">· note non enregistrée</span> : hasNote && <span>· note</span>}
            {change && <span className="font-medium text-ink">· {change}</span>}
          </span>
        </span>
        {/* Toute la ligne déplie ; le chevron dit dans quel sens. */}
        <span className="flex-none self-center text-muted">
          <Icon name={open ? 'chevron-up' : 'chevron-down'} />
        </span>
      </button>
      {open && (
        <div className="pb-3">
          <div className="border-t border-line">
            {(['sets', 'reps', 'rir'] as const).map((k) => (
              <FieldEditor key={k} k={k} value={row[k]} onChange={(f) => onField(k, f)} />
            ))}
          </div>
          <div className="px-5 pt-2">
            <div className="flex min-h-11 items-center justify-between gap-3">
              <p className="text-[15px] font-semibold text-ink">Note d’instructions</p>
              <IconButton icon="edit" tone="muted" className="-mr-2.5" onClick={onNote} label={`${hasNote ? 'Modifier' : 'Ajouter'} la note de ${name}`} />
            </div>
            {hasNote ? (
              <p className="max-w-[40ch] whitespace-pre-line break-words text-[15px] leading-[1.45] text-muted">{note}</p>
            ) : (
              <p className="text-[15px] text-muted">Aucune.</p>
            )}
            {noteUnsaved && <p className="mt-1 text-[14px] font-medium text-ink">Une modification de la note n’est pas enregistrée.</p>}
          </div>
          <div className="mt-3 flex border-t border-line px-5 pt-3">
            <SecondaryButton size="sm" onClick={onRemove} ariaLabel={`Retirer ${name} de la séance`}>
              Retirer
            </SecondaryButton>
          </div>
        </div>
      )}
    </li>
  );
}

/** Un champ de prescription : Fixe ou Fourchette, puis un ou deux steppers. */
function FieldEditor({ k, value, onChange }: { k: FieldKey; value: FieldValue; onChange: (f: FieldValue) => void }) {
  const label = FIELD_LABEL[k];
  const floor = FIELD_FLOOR[k];
  const ceil = FIELD_CEIL[k];
  const mode = (
    <Choice
      label={`${label}, type de prescription`}
      className="-ml-2.5 mt-0.5"
      value={value.mode}
      onChange={(m) => {
        if (m !== value.mode) onChange(toggleMode(value));
      }}
      options={[
        { value: 'fixe' as const, label: 'Fixe' },
        { value: 'fourchette' as const, label: 'Fourchette' },
      ]}
    />
  );
  if (value.mode === 'fixe') {
    return <Stepper label={label} meta={mode} value={value.min} min={floor} max={ceil} onChange={(n) => onChange(setMin(value, n, floor))} />;
  }
  return (
    <>
      <Stepper label={`${label} min`} meta={mode} value={value.min} min={floor} max={value.max} onChange={(n) => onChange(setMin(value, n, floor))} />
      <Stepper label={`${label} max`} value={value.max} min={value.min} max={ceil} onChange={(n) => onChange(setMax(value, n, floor))} />
    </>
  );
}

// =====================================================================
// Décompte des séries prévues (issues #37 et #60)
// =====================================================================

/**
 * Total et séries par muscle principal, dérivés EN DIRECT des prescriptions et
 * PONDÉRÉS par reps (chaque série vaut `min(reps_min,5)/5`). Avec un brouillon,
 * chaque muscle qui bouge montre sa valeur d'avant. On ne parle pas de
 * « volume » (GLOSSARY.md) : « séries prévues ».
 */
function CountSection({ rows, savedRows, dirty }: { rows: EditorRow[]; savedRows: EditorRow[]; dirty: boolean }) {
  const now = useMemo(() => countPlannedSets(rowsToPlannedExercises(rows)), [rows]);
  const before = useMemo(() => countPlannedSets(rowsToPlannedExercises(savedRows)), [savedRows]);
  const muscles = orderMusclesCanonical([...new Set([...Object.keys(now.byMuscle), ...(dirty ? Object.keys(before.byMuscle) : [])])]);
  const zero = { min: 0, max: 0 };
  const total = fmtCountRange(now.total);
  const totalBefore = fmtCountRange(before.total);
  return (
    <section aria-label="Décompte des séries prévues">
      <SectionTitle aside={dirty && total !== totalBefore ? `${total} au total · avant ${totalBefore}` : `${total} au total`}>Séries prévues</SectionTitle>
      {muscles.length === 0 ? (
        <p className="border-t border-line px-5 pt-2.5 text-[14px] text-muted">Aucun muscle principal renseigné sur ces exos.</p>
      ) : (
        <dl className="grid grid-cols-2 border-t border-line">
          {muscles.map((m, i) => {
            const v = fmtCountRange(now.byMuscle[m] ?? zero);
            const b = fmtCountRange(before.byMuscle[m] ?? zero);
            const changed = dirty && v !== b;
            return (
              <div key={m} className={`border-b border-line py-2.5 ${i % 2 === 0 ? 'border-r pl-5 pr-3' : 'pl-4 pr-5'}`}>
                <dt className="text-[14px] text-muted">{muscleLabel(m)}</dt>
                <dd className="mt-0.5 flex items-baseline gap-2">
                  <span className={`text-[20px] leading-tight tracking-[-0.01em] text-ink ${changed ? 'font-semibold' : 'font-medium'}`}>{v}</span>
                  {changed && <span className="text-[13px] text-faint">avant {b}</span>}
                </dd>
              </div>
            );
          })}
        </dl>
      )}
      <p className="px-5 pt-2.5 text-[14px] leading-[1.45] text-faint">
        Sous 5 reps, une série compte en partie ; un exo unilatéral compte double au total.
      </p>
    </section>
  );
}

// =====================================================================
// Catalogue : recherche + filtre par muscle + exo perso
// =====================================================================

const ALL = 'tous';

function CatalogSheet({
  open,
  catalogue,
  rows,
  onClose,
  onPick,
  onCreate,
}: {
  open: boolean;
  catalogue: CatalogueExercise[];
  rows: EditorRow[];
  onClose: () => void;
  onPick: (exo: CatalogueExercise) => void;
  /** Ouvre la création d'un exo perso, nom prérempli par la recherche. */
  onCreate: (prefill: string) => void;
}) {
  const [q, setQ] = useState('');
  const [muscle, setMuscle] = useState<string>(ALL);
  const musclesOf = (e: CatalogueExercise) => (e.primaryMuscles.length > 0 ? e.primaryMuscles : e.muscleGroup ? [e.muscleGroup] : []);
  const used = MUSCLE_GROUPS.filter((m) => catalogue.some((c) => musclesOf(c).includes(m)));
  const fq = foldAccents(q.trim());
  const shown = catalogue
    // Filtre par muscle sur la LISTE des muscles principaux (#33), repli sur le
    // muscle_group legacy quand la liste est vide (exo non backfillé).
    .filter((c) => muscle === ALL || musclesOf(c).includes(muscle))
    .filter((c) => !fq || foldAccents(c.name).includes(fq))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const reset = () => {
    setQ('');
    setMuscle(ALL);
  };
  const close = () => {
    reset();
    onClose();
  };
  return (
    <Sheet open={open} title="Ajouter un exo" onClose={close}>
      <div className="px-5 pb-1">
        <TextField type="search" label="Chercher un exo" hideLabel placeholder="Chercher un exo" value={q} onChange={setQ} enterKeyHint="search" />
      </div>
      <div className="overflow-x-auto px-3" style={{ scrollbarWidth: 'none' }}>
        <Choice
          label="Muscle"
          wrap={false}
          value={muscle}
          onChange={setMuscle}
          options={[{ value: ALL, label: 'Tous' }, ...used.map((m) => ({ value: m, label: muscleLabel(m) }))]}
        />
      </div>
      {shown.length === 0 ? (
        <p className="border-t border-line px-5 py-6 text-[15px] text-muted">
          Aucun exo ne correspond{q.trim() ? ` à « ${q.trim()} »` : ''}
          {muscle !== ALL ? ` dans ${muscleLabel(muscle)}` : ''}.
        </p>
      ) : (
        <List label="Catalogue">
          {shown.map((c) => {
            const n = rows.filter((r) => r.exerciseId === c.id).length;
            return (
              <Row
                key={c.id}
                title={c.name}
                meta={
                  <>
                    {[...musclesOf(c).map(muscleLabel), ...(c.unilateral ? ['unilatéral'] : [])].join(' · ')}
                    {n > 0 && <span className="block font-medium text-ink">déjà dans la séance{n > 1 ? `, ${n} fois` : ''}</span>}
                  </>
                }
                value={c.personal ? <span className="text-[14px] font-normal text-muted">perso</span> : undefined}
                onClick={() => {
                  reset();
                  onPick(c);
                }}
              />
            );
          })}
        </List>
      )}
      <div className="px-5 pt-4">
        <SecondaryButton
          className="w-full"
          onClick={() => {
            const prefill = q.trim();
            reset();
            onCreate(prefill);
          }}
        >
          Créer un exo perso
        </SecondaryButton>
      </div>
    </Sheet>
  );
}

// =====================================================================
// Note d'instructions (hors version)
// =====================================================================

/**
 * Feuille d'édition de la note d'un exo (issue #26). Le texte en cours
 * (`draft`) appartient à l'éditeur, pas à la feuille : fermer la feuille ne le
 * perd pas, et la garde de sortie le voit. Vider puis enregistrer efface la note.
 */
function NoteSheet({
  exerciseName,
  note,
  draft,
  onDraft,
  onSave,
  onClose,
}: {
  exerciseName: string;
  note: string;
  draft: string;
  onDraft: (body: string) => void;
  onSave: (body: string) => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = draft !== note;
  const clearing = changed && isBlankNote(draft);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await onSave(draft);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Sheet
      open
      title={`Note · ${exerciseName}`}
      onClose={onClose}
      footer={
        <>
          {error && <FieldError className="mt-0">{error}</FieldError>}
          {changed && !busy && (
            <TextLink tone="muted" className="self-start" onClick={() => onDraft(note)}>
              {isBlankNote(note) ? 'Effacer la saisie' : 'Remettre la note enregistrée'}
            </TextLink>
          )}
          <PrimaryButton disabled={!changed || busy} onClick={() => void submit()}>
            {busy ? 'Enregistrement…' : !changed ? 'Aucune modification' : clearing ? 'Effacer la note' : 'Enregistrer la note'}
          </PrimaryButton>
        </>
      }
    >
      <div className="px-5 pt-1">
        <TextArea
          label="Note d’instructions"
          value={draft}
          onChange={onDraft}
          rows={4}
          placeholder="Prise, réglage de la machine, tempo…"
          hint="Vaut pour cet exo dans toutes tes séances et s’affiche en salle. Elle s’enregistre à part, sans créer de version."
        />
      </div>
    </Sheet>
  );
}
