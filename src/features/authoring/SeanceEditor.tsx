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
import { useEffect, useMemo, useRef, useState } from 'react';
import { ClusterStepper } from '../capture/ClusterStepper';
import { listExercises } from '../capture/data';
import { NoteField } from '../notes/NoteField';
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
import { countPlannedSets, type CountRange } from '../../domain/set-count';

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
  // Dernière séance réellement chargée : on n'affiche le loader que pour un
  // NOUVEAU contexte (1er chargement / changement de séance). Un rafraîchissement
  // de la MÊME séance (reload() après un save) garde le contenu monté → pas de
  // saut de scroll en haut.
  const loadedSeanceRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    if (loadedSeanceRef.current !== seanceId) setLoad({ phase: 'loading' });

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
          primaryMuscles: p.primaryMuscles,
          unilateral: p.unilateral,
          sets: rangeToField(p.sets),
          reps: rangeToField(p.reps),
          rir: rangeToField(p.rir),
        }));
        // Note d'instructions (issue #26) par exo distinct présent dans la séance.
        const exerciseIds = [...new Set(prescriptions.map((p) => p.exerciseId))];
        const noteEntries = await Promise.all(
          exerciseIds.map(async (id) => [id, await loadExerciseNote(id)] as const),
        );
        if (!active) return;
        const notes = Object.fromEntries(noteEntries);
        loadedSeanceRef.current = seanceId;
        setLoad({ phase: 'ready', rows, catalogue, notes });
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
        };
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
  /** Muscles principaux (#33) : alimente le décompte PRÉVU quand l'exo est ajouté. */
  primaryMuscles: string[];
  /** Mouvement unilatéral (#33) : pèse double au décompte total (#37). */
  unilateral: boolean;
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
  /** Fabrique de rowId (injectée pour rester déterministe en test/harness). */
  makeRowId: () => string;
}

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
}: SeanceEditorViewProps) {
  const [rows, setRows] = useState<EditorRow[]>(initialRows);
  // Notes d'instructions par exo (issue #26), éditées et sauvegardées à part du
  // versionnage des prescriptions. Une note vaut pour TOUTES les lignes du même
  // exo (exercise_notes est unique par exo).
  const [notes, setNotes] = useState<Record<string, string>>(initialNotes);
  // Catalogue local : on y ajoute les exos perso créés à la volée, sans recharger.
  const [catalog, setCatalog] = useState<CatalogueExercise[]>(() =>
    catalogue.map((e) => ({
      id: e.id,
      name: e.name,
      muscleGroup: e.muscle_group,
      primaryMuscles: e.primary_muscles ?? [],
      unilateral: e.unilateral ?? false,
    })),
  );
  const [adding, setAdding] = useState(false);
  const [save, setSave] = useState<{ busy: boolean; error: string | null; done: boolean }>({
    busy: false,
    error: null,
    done: false,
  });

  // Scroll vers le bas après un ajout (issue #57) : enchaîner les ajouts sans
  // scroller à la main. On compte les ajouts (et non rows.length, qui bouge aussi
  // au réordonnancement / à la suppression) pour ne déclencher QUE sur ajout.
  const bottomRef = useRef<HTMLDivElement>(null);
  const [addCount, setAddCount] = useState(0);
  useEffect(() => {
    if (addCount === 0) return; // pas au montage initial.
    bottomRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [addCount]);

  // Retour différé (900 ms) après une sauvegarde réussie. Id gardé en ref et
  // annulé au démontage : si l'éditeur disparaît avant l'échéance, le timer ne
  // déclenche pas `onBack` sur une instance démontée.
  const backTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (backTimerRef.current != null) clearTimeout(backTimerRef.current);
    };
  }, []);

  function updateRow(rowId: string, key: FieldKey, next: FieldValue) {
    setRows((prev) =>
      prev.map((r) => (r.rowId === rowId ? { ...r, [key]: next } : r)),
    );
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
    setRows((prev) => [
      ...prev,
      {
        rowId: makeRowId(),
        exerciseId: exo.id,
        exerciseName: exo.name,
        muscleGroup: exo.muscleGroup,
        primaryMuscles: exo.primaryMuscles,
        unilateral: exo.unilateral,
        ...defaultFields(),
      },
    ]);
    setAdding(false);
    // Signale l'effet de scroll : on revient en bas, sur le nouvel exo (#57).
    setAddCount((n) => n + 1);
  }

  async function handleSave() {
    setSave({ busy: true, error: null, done: false });
    try {
      await onSave(rows);
      setSave({ busy: false, error: null, done: true });
      // Laisse la confirmation visible un instant, puis retour.
      if (backTimerRef.current != null) clearTimeout(backTimerRef.current);
      backTimerRef.current = setTimeout(onBack, 900);
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

      <h2 className="mt-1 text-3xl font-semibold leading-tight tracking-[-0.025em] text-ink">
        {seanceName}
      </h2>
      <p className="mb-4 mt-0.5 text-sm text-ink-muted">
        Exercices prescrits, dans l&apos;ordre. Règle séries, reps et RIR.
      </p>

      {empty ? (
        <EmptyState />
      ) : (
        <>
          {/* Décompte PRÉVU des séries (issue #37) : en direct, au-dessus de la liste. */}
          <PlannedSetCountCard rows={rows} />

          <ul className="flex flex-col gap-3">
            {rows.map((row, index) => (
              <li key={row.rowId}>
                <ExerciseRowCard
                  row={row}
                  position={index + 1}
                  isFirst={index === 0}
                  isLast={index === rows.length - 1}
                  note={notes[row.exerciseId] ?? ''}
                  onMove={(direction) => setRows((prev) => moveRow(prev, index, direction))}
                  onRemove={() => setRows((prev) => prev.filter((r) => r.rowId !== row.rowId))}
                  onField={(key, next) => updateRow(row.rowId, key, next)}
                  onSaveNote={(body) => saveNote(row.exerciseId, body)}
                />
              </li>
            ))}
          </ul>

          {/* « Ajouter un exercice » N'est PLUS ici (zone scrollable) : il vit dans
              la barre fixe du bas pour rester TOUJOURS visible. Sentinel de scroll
              conservé (on revient ici après un ajout, #57). */}
          <div ref={bottomRef} aria-hidden="true" />
        </>
      )}

      {/* Barre d'enregistrement fixée en bas (One Voice : seul accent fort de l'écran).
          Ancrée sur `--nav-offset` (hauteur nav + safe-area), PAS `bottom-14` (=
          hauteur nav SANS la safe-area) : sinon, sur appareil à encoche, le bas de
          la barre passe sous la nav. */}
      <div className="fixed inset-x-0 bottom-[var(--nav-offset)] z-20 border-t border-hair bg-bg/95 px-4 py-3 backdrop-blur-sm">
        <div className="mx-auto w-full max-w-md">
          {/* UNE seule ligne pour ne pas voler la hauteur : « Ajouter » compact
              (pointillé, comme Capture) à gauche + « Enregistrer » qui prend le
              reste. « Ajouter » TOUJOURS visible (hors scroll) ; caché quand la
              séance est vide (l'EmptyState porte alors son propre CTA centré). */}
          <div className="flex items-center gap-2.5">
            {/* TOUJOURS présent (même séance vide) : c'est l'unique « Ajouter »,
                fixe et en pointillé. L'EmptyState n'a donc plus son propre bouton. */}
            <button
              type="button"
              aria-label="Ajouter un exercice"
              onClick={() => setAdding(true)}
              className="flex h-12 shrink-0 items-center gap-2 rounded-2xl border border-dashed border-hair-strong px-4 text-base font-medium text-ink-muted transition active:bg-surface active:text-ink"
            >
              <PlusIcon />
              Ajouter
            </button>
            {save.done ? (
              <p
                className="surface-card flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl text-base font-semibold text-good"
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
                className="btn btn-primary h-12 flex-1 rounded-2xl text-base disabled:bg-none disabled:bg-surface disabled:text-ink-muted disabled:opacity-100 disabled:shadow-none"
              >
                {save.busy
                  ? 'Enregistrement…'
                  : empty
                    ? 'Ajoute au moins un exercice'
                    : 'Enregistrer'}
              </button>
            )}
          </div>
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

/** Résumé compact d'un champ : « 3 » (fixe) ou « 8-12 » (fourchette). */
function fmtField(v: FieldValue): string {
  return v.mode === 'fixe' ? String(v.min) : `${v.min}-${v.max}`;
}

/**
 * Format d'un compte FRACTIONNAIRE (issue #60, pondération par reps) : une
 * décimale, virgule décimale FR (jamais de point). « 1,8 » si min === max (valeur
 * fixe), sinon « 1,8-2,4 » (trait d'union court, jamais de tiret long, cf.
 * DESIGN.md). Les bornes égales après arrondi s'affichent en valeur unique.
 */
function fmtCount(value: number): string {
  return value.toFixed(1).replace('.', ',');
}

function fmtCountRange(range: CountRange): string {
  const min = fmtCount(range.min);
  const max = fmtCount(range.max);
  return min === max ? min : `${min}-${max}`;
}

/** Résumé d'une prescription, même format que la cible affichée en Capture. */
function summarizeRow(row: EditorRow): string {
  return `${fmtField(row.sets)} × ${fmtField(row.reps)} · RIR ${fmtField(row.rir)}`;
}

/**
 * Décompte PRÉVU des séries de la séance (issue #60, affine #37) : total + par
 * muscle principal, dérivé EN DIRECT des prescriptions courantes (recalculé à
 * chaque édition via useMemo) et PONDÉRÉ par reps (chaque série vaut
 * `min(reps_min,5)/5`). La prescription de reps est figée à sa borne basse ; seul
 * le NOMBRE de séries fait varier la fourchette du décompte (« 1,8-2,4 ») ;
 * séries fixes = valeur unique.
 *
 * DESIGN.md : chiffres mesurés en mono tabulaire (.readout) à une décimale
 * (virgule FR), un seul muscle par ligne pour que les comptes s'alignent en
 * colonne « cadran d'instrument », et AUCUN tiret long (la fourchette s'écrit
 * avec un trait d'union court). On NE parle PAS de « volume » (terme proscrit,
 * cf. CONTEXT.md) : « séries par muscle ».
 */
function PlannedSetCountCard({ rows }: { rows: EditorRow[] }) {
  const count = useMemo(() => countPlannedSets(rowsToPlannedExercises(rows)), [rows]);
  // Muscles présents, dans l'ordre canonique de CONTEXT.md (colonne stable).
  const muscles = orderMusclesCanonical(Object.keys(count.byMuscle));

  return (
    <section
      className="surface-card mb-4 rounded-2xl p-3.5"
      aria-label="Décompte des séries prévues"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-ink">Séries prévues</h3>
        <span className="readout text-lg font-medium tabular-nums text-ink">
          {fmtCountRange(count.total)}
          <span className="ml-1 text-xs font-normal text-ink-muted">au total</span>
        </span>
      </div>

      {muscles.length === 0 ? (
        <p className="mt-2 text-xs text-ink-muted">
          Aucun muscle principal renseigné sur ces exercices.
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-1.5">
          {muscles.map((muscle) => {
            const range = count.byMuscle[muscle];
            if (!range) return null;
            return (
              <li key={muscle} className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-sm text-ink-muted">{muscle}</span>
                <span className="readout shrink-0 text-sm tabular-nums text-ink">
                  {fmtCountRange(range)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Caret({ dir }: { dir: 'up' | 'down' }) {
  return (
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
      <path d={dir === 'down' ? 'M6 9l6 6 6-6' : 'M18 15l-6-6-6 6'} />
    </svg>
  );
}

function ExerciseRowCard({
  row,
  position,
  isFirst,
  isLast,
  note,
  onMove,
  onRemove,
  onField,
  onSaveNote,
}: {
  row: EditorRow;
  position: number;
  isFirst: boolean;
  isLast: boolean;
  /** Note d'instructions de l'exo (issue #26), '' si aucune. */
  note: string;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
  onField: (key: FieldKey, next: FieldValue) => void;
  /** Enregistre la note d'instructions de l'exo (corps vidé = note effacée). */
  onSaveNote: (body: string) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="surface-card rounded-2xl p-3.5">
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

      {expanded ? (
        <>
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
            <ExerciseNoteEditor
              exerciseName={row.exerciseName}
              note={note}
              onSave={onSaveNote}
            />
          </div>
          <button
            type="button"
            onClick={() => setExpanded(false)}
            aria-expanded
            className="btn btn-ghost mt-3 h-11 w-full rounded-lg text-sm font-medium"
          >
            Replier
            <Caret dir="up" />
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-expanded={false}
          className="mt-2.5 flex min-h-[44px] w-full items-center justify-between gap-3 rounded-xl bg-surface-2/40 px-3 text-left transition active:bg-surface-2"
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className="readout text-sm tabular-nums text-ink">{summarizeRow(row)}</span>
            {/* Indicateur « note présente » : mot + icône, jamais la couleur seule. */}
            {!isBlankNote(note) && (
              <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-ink-muted">
                <svg
                  viewBox="0 0 24 24"
                  width="13"
                  height="13"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M4 6h16M4 12h10M4 18h7" />
                </svg>
                Note
              </span>
            )}
          </span>
          <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-ink-muted">
            Modifier
            <Caret dir="down" />
          </span>
        </button>
      )}
    </div>
  );
}

// =====================================================================
// Note d'instructions de l'exo (issue #26)
// =====================================================================

/**
 * Éditeur de la note d'instructions d'un exo, dans la carte dépliée. Persistée
 * à part du versionnage des prescriptions (bouton dédié), car la note vaut pour
 * l'exo lui-même, pas pour cette version de séance. Vider puis enregistrer
 * efface la note. Texte libre : <textarea> légitime (le ban clavier OS ne vise
 * que les chiffres mesurés).
 */
function ExerciseNoteEditor({
  exerciseName,
  note,
  onSave,
}: {
  exerciseName: string;
  note: string;
  onSave: (body: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(note);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty = draft !== note;

  // Toast « enregistré » (1,6 s) : id en ref + clear au démontage, pour ne pas
  // tirer setSaved sur une instance démontée si l'éditeur ferme entre-temps.
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (savedTimerRef.current != null) clearTimeout(savedTimerRef.current);
    };
  }, []);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await onSave(draft);
      setSaved(true);
      if (savedTimerRef.current != null) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setSaved(false), 1600);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl bg-surface-2/40 p-3">
      <NoteField
        id={`note-${exerciseName}`}
        label="Note de l’exercice"
        hint="Instructions persistantes, affichées en référence pendant la série."
        value={draft}
        placeholder="Prise serrée, coudes rentrés, descente contrôlée."
        rows={3}
        onChange={setDraft}
      />
      <div className="mt-2.5 flex items-center justify-end gap-2">
        {saved && !dirty && (
          <span className="mr-auto inline-flex items-center gap-1.5 text-xs font-medium text-good">
            <CheckIcon />
            Note enregistrée.
          </span>
        )}
        <button
          type="button"
          disabled={!dirty || busy}
          onClick={() => void submit()}
          className="btn btn-primary h-11 rounded-xl px-4 text-sm disabled:bg-none disabled:bg-surface disabled:text-ink-muted disabled:opacity-100 disabled:shadow-none"
        >
          {busy ? 'Enregistrement…' : isBlankNote(draft) ? 'Effacer la note' : 'Enregistrer la note'}
        </button>
      </div>
      {error && (
        <p className="readout mt-2 break-words text-xs text-warn" role="alert">
          {error}
        </p>
      )}
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
        // Stepper « instrument » de Capture (boutons ronds, + en accent), variante
        // compacte : même langage visuel que le log, et plus compact que l'ancien
        // Stepper rectangulaire (qui s'écrasait en fourchette).
        <ClusterStepper
          label="valeur"
          variant="compact"
          value={value.min}
          step={1}
          min={floor}
          onChange={(n) => onChange(setMin(value, n, floor))}
        />
      ) : (
        // Fourchette : deux ClusterSteppers « min » / « max ». PAS de tiret long ni
        // de séparateur (DESIGN.md). Boutons ronds compacts → tient sans écrasement.
        <div className="grid grid-cols-2 gap-2.5">
          <ClusterStepper
            label="min"
            variant="compact"
            value={value.min}
            step={1}
            min={floor}
            max={value.max}
            onChange={(n) => onChange(setMin(value, n, floor))}
          />
          <ClusterStepper
            label="max"
            variant="compact"
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
      className={`min-h-[44px] rounded-md px-3 text-xs font-semibold transition ${
        active
          ? 'bg-surface-2 text-ink shadow-[inset_0_1px_0_var(--spec)]'
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
  onCreatePersonal: (input: PersonalExerciseFormInput) => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [muscle, setMuscle] = useState<string>('');
  const [creating, setCreating] = useState(false);

  // Ouverture du choix d'exo (issue #57) : on remonte en haut de la zone de choix
  // pour partir de la recherche, pas du scroll hérité de la séance.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, []);

  const filtered = useMemo(() => {
    const q = foldAccents(query.trim());
    return catalogue
      // Filtre par muscle sur la LISTE des muscles principaux (#33), pas le
      // muscle_group legacy : sinon un exo multi-muscles (pris dans son seul 1er
      // muscle) ou un muscle ajouté par override per-user (#50) serait raté. Repli
      // sur muscleGroup quand la liste est vide (exo legacy non backfillé).
      .filter((e) => {
        if (!muscle) return true;
        return e.primaryMuscles.length > 0
          ? e.primaryMuscles.includes(muscle)
          : e.muscleGroup === muscle;
      })
      .filter((e) => (q ? foldAccents(e.name).includes(q) : true))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  }, [catalogue, query, muscle]);

  return (
    <div className="mx-auto flex min-h-[calc(100vh-3.5rem)] w-full max-w-md flex-col px-4 pb-8 pt-3">
      <BackButton label="Retour à la séance" onClick={onCancel} />

      <h2 className="mt-1 text-3xl font-semibold leading-tight tracking-[-0.025em] text-ink">
        Ajouter un exercice
      </h2>
      <p className="mb-4 mt-0.5 text-sm text-ink-muted">
        Cherche dans ton catalogue, ou crée un exercice perso.
      </p>

      {creating ? (
        <div className="mb-4">
          <ExerciseForm
            submitLabel="Créer et ajouter"
            submitBusyLabel="Création…"
            onCancel={() => setCreating(false)}
            onSubmit={onCreatePersonal}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="mb-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-hair-strong bg-surface text-base font-medium text-ink transition active:scale-[0.99] active:bg-surface-2"
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
        maxLength={80}
        onChange={(e) => setQuery(e.target.value)}
        className="field h-11 w-full rounded-xl px-3 text-base text-ink"
      />

      {/* Filtre muscle : <select> natif (ce n'est pas un chiffre mesuré). */}
      <select
        value={muscle}
        onChange={(e) => setMuscle(e.target.value)}
        aria-label="Filtrer par groupe musculaire"
        className="field mt-2.5 h-11 w-full rounded-xl px-3 text-base text-ink"
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
        <p className="rounded-2xl border border-dashed border-hair-strong px-4 py-8 text-center text-sm text-ink-muted">
          Aucun exercice ne correspond. Ajuste ta recherche ou crée un exo perso.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {filtered.map((exo) => (
            <li key={exo.id}>
              <button
                type="button"
                onClick={() => onPick(exo)}
                className="surface-interactive flex min-h-[44px] w-full items-center gap-3 rounded-xl px-4 py-3 text-left"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-base font-medium text-ink">
                    {exo.name}
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                    {exo.muscleGroup && (
                      <span className="truncate text-xs text-ink-muted">
                        {exo.muscleGroup}
                      </span>
                    )}
                    {exo.unilateral && <UnilateralBadge />}
                  </span>
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

/**
 * Marqueur « Unilatéral » pour un exo (issue #57). Mot EXPLICITE + pastille de
 * surface tonale : l'info n'est jamais portée par la seule couleur (DESIGN.md).
 * Sobre (surface-2 / ink-muted), pas d'accent violet : la One Voice Rule réserve
 * le violet à l'action primaire et à la sélection.
 */
function UnilateralBadge() {
  return (
    <span className="inline-flex shrink-0 items-center rounded-md bg-surface-2 px-1.5 py-0.5 text-[0.6875rem] font-medium leading-none text-ink-muted">
      Unilatéral
    </span>
  );
}

// =====================================================================
// État vide + primitives
// =====================================================================

function EmptyState() {
  // Plus de bouton ici : « Ajouter un exercice » vit dans la barre fixe du bas
  // (toujours visible, pointillé), y compris séance vide. On ne garde que le message.
  return (
    <div className="mt-2 flex flex-col items-center gap-4 rounded-2xl border border-dashed border-hair-strong px-6 py-12 text-center">
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
        Aucun exercice prescrit. Ajoute le premier avec «&#8239;Ajouter&#8239;» en bas.
      </p>
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
  // Bouton-instrument cohérent avec le reste de l'app (retour Capture, swap picker) :
  // bordure + surface + ombre interne, pas un ghost plat. Le ton « danger » (retirer)
  // vire au warn à la pression.
  const toneClass = tone === 'danger' ? 'active:text-warn' : 'active:text-ink';
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-11 w-11 items-center justify-center rounded-xl border border-hair bg-surface text-ink-muted shadow-[inset_0_1px_0_var(--spec)] transition active:scale-95 disabled:opacity-30 ${toneClass}`}
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
      className="mx-auto w-full max-w-md px-4 pt-3"
      role="status"
      aria-label={label}
    >
      {/* Squelette : 3 cartes simulant des exercices prescrits. */}
      <div className="mb-4 h-8 w-32 rounded-lg bg-surface-2 animate-pulse" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="surface-card mb-3 rounded-2xl p-3.5">
          <div className="flex items-start gap-2">
            <div className="mt-0.5 h-5 w-5 shrink-0 rounded bg-surface-2 animate-pulse" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-3/5 rounded bg-surface-2 animate-pulse" />
              <div className="h-3 w-2/5 rounded bg-surface-2 animate-pulse" />
            </div>
          </div>
          <div className="mt-3 h-10 w-full rounded-xl bg-surface-2 animate-pulse" />
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
