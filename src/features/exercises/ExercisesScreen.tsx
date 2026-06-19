// Surface « Exercices » : gestion du catalogue d'exos (issue #49).
//
// Architecture (calquée sur SeancesScreen / SeanceEditor) : on SÉPARE le
// chargement Supabase de la PRÉSENTATION. `ExercisesView` est PUR (props =
// données + callbacks) et se monte tel quel dans le harness de screenshot, sans
// réseau. `ExercisesScreen` est le conteneur : il charge via listExercises (lit
// base + perso), mute via create/update/deletePersonalExercise, et recharge.
//
// Périmètre (cf. CONTEXT.md) :
//   - exo de BASE (owner_id null) : la LIGNE de base reste lecture seule pour
//     tous, mais l'user peut la PERSONNALISER via un override per-user (nom,
//     unilatéral, muscles principaux ; issue #50) et la réinitialiser. La ligne
//     partagée n'est jamais modifiée ; l'override est invisible des autres users.
//   - exo PERSO (owner_id = auth.uid()) : créer, modifier (nom + muscles +
//     unilatéral, « renommer » = changer le champ nom) et supprimer.
//   - NOTE par exo (exercise_notes #26, déjà per-user) : éditable ICI pour TOUS
//     les exos (base ET perso), via le champ de note réutilisable (NoteField).
//
// Conventions DESIGN.md tenues ici :
//   - accent violet parcimonieux : action primaire + chips actives du formulaire ;
//   - statut « Base », « Unilatéral », « Personnalisé » = couleur + MOT (+ icône),
//     jamais la couleur seule ;
//   - aucun tiret long affiché ; tap-targets >= 44px ;
//   - confirmations de suppression / réinitialisation INLINE (pas de window.confirm) ;
//   - <input> texte pour la recherche (le ban du clavier OS vise les chiffres).
//
// Suppression SÛRE : la couche data (deletePersonalExercise) compte d'abord les
// références (prescriptions + séries faites) et REFUSE avec un message lisible si
// l'exo est encore utilisé, au lieu de laisser la base lever une violation de FK.
import { useEffect, useMemo, useState } from 'react';
import { listExercises } from '../capture/data';
import {
  createPersonalExercise,
  updatePersonalExercise,
  deletePersonalExercise,
} from '../authoring/data';
import { loadExerciseNote, saveExerciseNote } from '../notes/data';
import { NoteField } from '../notes/NoteField';
import {
  loadExerciseOverrides,
  upsertExerciseOverride,
  resetExerciseOverride,
} from './overrides';
import { isOverridden } from '../../domain/exercise-override';
import { ExerciseForm, type ExerciseFormValue } from './ExerciseForm';
import {
  filterExercises,
  toListExercise,
  type ListExercise,
} from './exercises-list';

// =====================================================================
// Conteneur : chargement + mutations
// =====================================================================

type Load =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; exercises: ListExercise[]; overridden: Set<string> };

export function ExercisesScreen() {
  const [load, setLoad] = useState<Load>({ phase: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);

  useEffect(() => {
    let active = true;
    // Loader au 1er chargement seulement ; un rafraîchissement (reload() après
    // un save) garde le contenu monté → pas de saut de scroll en haut.
    if (reloadKey === 0) setLoad({ phase: 'loading' });

    void (async () => {
      try {
        // `listExercises` renvoie déjà les champs FUSIONNÉS (override per-user) ;
        // les overrides bruts servent juste à savoir QUELS exos sont personnalisés
        // (badge + pré-remplissage du formulaire / réinitialisation).
        const [rows, overrides] = await Promise.all([
          listExercises(),
          loadExerciseOverrides(),
        ]);
        if (!active) return;
        const overridden = new Set(
          [...overrides.entries()]
            .filter(([, values]) => isOverridden(values))
            .map(([id]) => id),
        );
        setLoad({ phase: 'ready', exercises: rows.map(toListExercise), overridden });
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
    return <ScreenSpinner label="Chargement des exercices" />;
  }

  if (load.phase === 'error') {
    return (
      <ScreenError
        message={load.message}
        intro="Impossible de charger tes exercices."
        onRetry={reload}
      />
    );
  }

  return (
    <ExercisesView
      exercises={load.exercises}
      overridden={load.overridden}
      onCreate={async (value) => {
        await createPersonalExercise(value);
        reload();
      }}
      onUpdate={async (id, value) => {
        await updatePersonalExercise(id, value);
        reload();
      }}
      onDelete={async (id) => {
        await deletePersonalExercise(id);
        reload();
      }}
      onSaveOverride={async (id, value) => {
        await upsertExerciseOverride(id, value);
        reload();
      }}
      onResetOverride={async (id) => {
        await resetExerciseOverride(id);
        reload();
      }}
      onLoadNote={loadExerciseNote}
      onSaveNote={saveExerciseNote}
    />
  );
}

// =====================================================================
// Présentation pure (montable sans réseau dans le harness)
// =====================================================================

export interface ExercisesViewProps {
  exercises: ListExercise[];
  /** Ids des exos de base PERSONNALISÉS par l'user (override effectif, issue #50). */
  overridden: Set<string>;
  /** Crée un exo perso. Résolu = créé (le conteneur recharge). */
  onCreate: (value: ExerciseFormValue) => Promise<void>;
  /** Édite un exo perso (renommer + muscles + unilatéral). */
  onUpdate: (id: string, value: ExerciseFormValue) => Promise<void>;
  /** Supprime un exo perso. Rejette avec un message si l'exo est référencé. */
  onDelete: (id: string) => Promise<void>;
  /** Crée/maj l'override d'un exo de BASE (jamais la ligne de base). */
  onSaveOverride: (id: string, value: ExerciseFormValue) => Promise<void>;
  /** Réinitialise un exo de base (supprime l'override per-user). */
  onResetOverride: (id: string) => Promise<void>;
  /** Charge la note (exercise_notes #26) d'un exo, '' si aucune. */
  onLoadNote: (exerciseId: string) => Promise<string>;
  /** Enregistre la note d'un exo (corps vide = suppression). */
  onSaveNote: (exerciseId: string, body: string) => Promise<void>;
}

export function ExercisesView({
  exercises,
  overridden,
  onCreate,
  onUpdate,
  onDelete,
  onSaveOverride,
  onResetOverride,
  onLoadNote,
  onSaveNote,
}: ExercisesViewProps) {
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);

  const { base, personal } = useMemo(
    () => filterExercises(exercises, query),
    [exercises, query],
  );

  const total = base.length + personal.length;

  return (
    <div className="mx-auto w-full max-w-md px-4 pb-8 pt-3">
      <h2 className="text-2xl font-bold leading-tight tracking-tight text-ink">
        Exercices
      </h2>
      <p className="mb-4 mt-0.5 text-sm text-ink-muted">
        Ton catalogue. Crée et gère tes exos perso ; les exos de base sont en
        lecture seule.
      </p>

      {creating ? (
        <div className="mb-4">
          <p className="mb-2 text-sm font-semibold text-ink">Nouvel exercice perso</p>
          <ExerciseForm
            submitLabel="Créer"
            submitBusyLabel="Création…"
            onCancel={() => setCreating(false)}
            onSubmit={async (value) => {
              await onCreate(value);
              setCreating(false);
            }}
          />
        </div>
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
        maxLength={80}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Rechercher un exercice"
        className="h-11 w-full rounded-xl border border-line bg-bg px-3 text-base text-ink placeholder:text-ink-muted/85 focus:border-accent focus:outline-none"
      />

      <p className="mt-4 mb-2 text-xs text-ink-muted">
        <span className="readout tabular-nums">{total}</span>{' '}
        {total > 1 ? 'exercices' : 'exercice'}
      </p>

      {total === 0 ? (
        <p className="rounded-2xl border border-dashed border-line px-4 py-8 text-center text-sm text-ink-muted">
          Aucun exercice ne correspond. Ajuste ta recherche ou crée un exo perso.
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          <Section title="Tes exercices" count={personal.length}>
            {personal.length === 0 ? (
              <EmptySection text="Tu n'as pas encore d'exo perso. Crée le premier ci-dessus." />
            ) : (
              <ul className="flex flex-col gap-2">
                {personal.map((exo) => (
                  <li key={exo.id}>
                    <PersonalRow
                      exo={exo}
                      onUpdate={onUpdate}
                      onDelete={onDelete}
                      onLoadNote={onLoadNote}
                      onSaveNote={onSaveNote}
                    />
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Catalogue de base" count={base.length}>
            {base.length === 0 ? (
              <EmptySection text="Aucun exo de base ne correspond." />
            ) : (
              <ul className="flex flex-col gap-2">
                {base.map((exo) => (
                  <li key={exo.id}>
                    <BaseRow
                      exo={exo}
                      overridden={overridden.has(exo.id)}
                      onSaveOverride={onSaveOverride}
                      onResetOverride={onResetOverride}
                      onLoadNote={onLoadNote}
                      onSaveNote={onSaveNote}
                    />
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      )}
    </div>
  );
}

// --- Sections ---------------------------------------------------------------

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-2 flex items-baseline gap-2 text-sm font-semibold text-ink">
        {title}
        <span className="readout text-xs font-normal tabular-nums text-ink-muted">
          {count}
        </span>
      </h3>
      {children}
    </section>
  );
}

function EmptySection({ text }: { text: string }) {
  return (
    <p className="rounded-2xl border border-dashed border-line px-4 py-6 text-center text-sm text-ink-muted">
      {text}
    </p>
  );
}

// --- Lignes -----------------------------------------------------------------

/**
 * Ligne d'un exo de BASE : la ligne partagée reste lecture seule, mais l'user
 * peut la PERSONNALISER (override per-user, issue #50) et la réinitialiser, plus
 * éditer sa note. Le nom / les muscles affichés sont DÉJÀ fusionnés (override
 * gagnant) ; « Personnaliser » ouvre le même formulaire que les exos perso, dont
 * la soumission crée/maj l'override (jamais la ligne de base).
 */
function BaseRow({
  exo,
  overridden,
  onSaveOverride,
  onResetOverride,
  onLoadNote,
  onSaveNote,
}: {
  exo: ListExercise;
  overridden: boolean;
  onSaveOverride: (id: string, value: ExerciseFormValue) => Promise<void>;
  onResetOverride: (id: string) => Promise<void>;
  onLoadNote: (exerciseId: string) => Promise<string>;
  onSaveNote: (exerciseId: string, body: string) => Promise<void>;
}) {
  const [mode, setMode] = useState<'idle' | 'edit' | 'confirmReset'>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (mode === 'edit') {
    return (
      <RowCard>
        <p className="mb-2 text-sm font-semibold text-ink">Personnaliser l'exercice</p>
        <p className="mb-2 text-xs text-ink-muted">
          Ta version reste privée. L'exercice de base n'est pas modifié pour les autres.
        </p>
        <ExerciseForm
          initial={{
            name: exo.name,
            primaryMuscles: exo.primaryMuscles,
            unilateral: exo.unilateral,
          }}
          autoFocusName={false}
          submitLabel="Enregistrer"
          submitBusyLabel="Enregistrement…"
          onCancel={() => setMode('idle')}
          onSubmit={async (value) => {
            await onSaveOverride(exo.id, value);
            setMode('idle');
          }}
        />
      </RowCard>
    );
  }

  async function confirmReset() {
    setBusy(true);
    setError(null);
    try {
      await onResetOverride(exo.id);
      // Succès : le conteneur recharge, la ligne revient à sa version de base.
    } catch (err) {
      setError(errMessage(err));
      setBusy(false);
    }
  }

  return (
    <RowCard>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-medium text-ink">{exo.name}</p>
          <MuscleLine exo={exo} />
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <BaseBadge />
          {overridden && <CustomizedBadge />}
        </div>
      </div>

      {mode === 'confirmReset' ? (
        <ConfirmReset
          busy={busy}
          error={error}
          onConfirm={() => void confirmReset()}
          onCancel={() => {
            setError(null);
            setMode('idle');
          }}
        />
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <RowAction
            label={overridden ? 'Modifier' : 'Personnaliser'}
            onClick={() => setMode('edit')}
          />
          {overridden && (
            <RowAction label="Réinitialiser" onClick={() => setMode('confirmReset')} />
          )}
        </div>
      )}

      <NoteSection exerciseId={exo.id} onLoadNote={onLoadNote} onSaveNote={onSaveNote} />
    </RowCard>
  );
}

/** Ligne d'un exo PERSO : modifier (form pré-rempli), note, ou supprimer (inline). */
function PersonalRow({
  exo,
  onUpdate,
  onDelete,
  onLoadNote,
  onSaveNote,
}: {
  exo: ListExercise;
  onUpdate: (id: string, value: ExerciseFormValue) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onLoadNote: (exerciseId: string) => Promise<string>;
  onSaveNote: (exerciseId: string, body: string) => Promise<void>;
}) {
  const [mode, setMode] = useState<'idle' | 'edit' | 'confirmDelete'>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Édition : on réutilise ExerciseForm pré-rempli. « Renommer » = changer le
  // seul champ nom ; « éditer » = changer aussi muscles / unilatéral. Un seul flux.
  if (mode === 'edit') {
    return (
      <RowCard>
        <p className="mb-2 text-sm font-semibold text-ink">Modifier l'exercice</p>
        <ExerciseForm
          initial={{
            name: exo.name,
            primaryMuscles: exo.primaryMuscles,
            unilateral: exo.unilateral,
          }}
          autoFocusName={false}
          submitLabel="Enregistrer"
          submitBusyLabel="Enregistrement…"
          onCancel={() => setMode('idle')}
          onSubmit={async (value) => {
            // ExerciseForm gère son propre état busy/erreur ; on laisse remonter.
            await onUpdate(exo.id, value);
            setMode('idle');
          }}
        />
      </RowCard>
    );
  }

  async function confirmDelete() {
    setBusy(true);
    setError(null);
    try {
      await onDelete(exo.id);
      // Succès : le conteneur recharge, cette ligne disparaît.
    } catch (err) {
      // Suppression refusée (exo référencé) ou échec réseau : message lisible.
      setError(errMessage(err));
      setBusy(false);
    }
  }

  return (
    <RowCard>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-medium text-ink">{exo.name}</p>
          <MuscleLine exo={exo} />
        </div>
      </div>

      {mode === 'confirmDelete' ? (
        <ConfirmDelete
          question={`Supprimer « ${exo.name} » ?`}
          busy={busy}
          error={error}
          onConfirm={() => void confirmDelete()}
          onCancel={() => {
            setError(null);
            setMode('idle');
          }}
        />
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <RowAction label="Modifier" onClick={() => setMode('edit')} />
          <RowAction
            label="Supprimer"
            tone="danger"
            onClick={() => setMode('confirmDelete')}
          />
        </div>
      )}

      <NoteSection exerciseId={exo.id} onLoadNote={onLoadNote} onSaveNote={onSaveNote} />
    </RowCard>
  );
}

// --- Note par exo (exercise_notes #26) --------------------------------------
//
// Édition de la note d'instructions, partagée par les exos de BASE et PERSO. La
// note est chargée À LA DEMANDE (à l'ouverture) plutôt qu'au montage de la liste :
// inutile de tirer N notes pour les afficher repliées. Réutilise NoteField (le
// même champ que l'authoring / la Capture) ; le corps vide supprime la note.

function NoteSection({
  exerciseId,
  onLoadNote,
  onSaveNote,
}: {
  exerciseId: string;
  onLoadNote: (exerciseId: string) => Promise<string>;
  onSaveNote: (exerciseId: string, body: string) => Promise<void>;
}) {
  // 'closed' : repliée ; 'loading' : on tire la note ; 'open' : éditable.
  const [phase, setPhase] = useState<'closed' | 'loading' | 'open'>('closed');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setPhase('loading');
    setError(null);
    try {
      setBody(await onLoadNote(exerciseId));
      setPhase('open');
    } catch (err) {
      setError(errMessage(err));
      setPhase('closed');
    }
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await onSaveNote(exerciseId, body);
      setBusy(false);
      setPhase('closed');
    } catch (err) {
      setError(errMessage(err));
      setBusy(false);
    }
  }

  if (phase === 'closed') {
    return (
      <div className="mt-3 border-t border-line/60 pt-3">
        <RowAction label="Note de l'exercice" onClick={() => void open()} />
        {error && <RowError message={error} />}
      </div>
    );
  }

  if (phase === 'loading') {
    return (
      <div className="mt-3 border-t border-line/60 pt-3">
        <p className="text-sm text-ink-muted" role="status">
          Chargement de la note…
        </p>
      </div>
    );
  }

  return (
    <div className="mt-3 border-t border-line/60 pt-3">
      <NoteField
        id={`exercise-note-${exerciseId}`}
        label="Note de l'exercice"
        hint="Tes repères techniques. Visibles en référence pendant la séance."
        placeholder="Prise serrée, coudes rentrés…"
        value={body}
        onChange={setBody}
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void save()}
          className="inline-flex h-11 flex-1 items-center justify-center rounded-xl bg-accent-strong px-4 text-sm font-semibold text-on-accent transition active:scale-[0.98] active:bg-accent disabled:opacity-50"
        >
          {busy ? 'Enregistrement…' : 'Enregistrer'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setPhase('closed')}
          className="inline-flex h-11 items-center justify-center rounded-xl px-4 text-sm font-medium text-ink-muted transition active:text-ink disabled:opacity-50"
        >
          Annuler
        </button>
      </div>
      {error && <RowError message={error} />}
    </div>
  );
}

/** Ligne « muscles principaux + unilatéral », jamais la couleur seule. */
function MuscleLine({ exo }: { exo: ListExercise }) {
  const muscles =
    exo.primaryMuscles.length > 0 ? exo.primaryMuscles.join(', ') : exo.muscleGroup;
  return (
    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
      {muscles && (
        <span className="truncate text-xs text-ink-muted">{muscles}</span>
      )}
      {exo.unilateral && <UnilateralBadge />}
    </div>
  );
}

// =====================================================================
// Primitives (cohérentes avec SeancesScreen / SeanceEditor)
// =====================================================================

/** Badge « Base » : couleur (neutre) ET mot, pour le statut lecture seule. */
function BaseBadge() {
  return (
    <span className="mt-0.5 inline-flex shrink-0 items-center rounded-md border border-line px-1.5 py-0.5 text-xs font-medium text-ink-muted">
      Base
    </span>
  );
}

/** Badge « Personnalisé » : icône (crayon) ET mot, jamais la couleur seule (issue #50). */
function CustomizedBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-accent/40 px-1.5 py-0.5 text-xs font-medium text-accent-ink">
      <svg
        viewBox="0 0 24 24"
        width="12"
        height="12"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
      Personnalisé
    </span>
  );
}

/** Badge « Unilatéral » : couleur (accent) ET mot, jamais la couleur seule. */
function UnilateralBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-accent/40 px-1.5 py-0.5 text-xs font-medium text-accent-ink">
      <svg
        viewBox="0 0 24 24"
        width="12"
        height="12"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M9 18V6M15 18V6" />
      </svg>
      Unilatéral
    </span>
  );
}

function RowCard({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-line bg-surface p-3.5">{children}</div>;
}

/** Action secondaire d'une ligne. Neutre par défaut ; danger au besoin. */
function RowAction({
  label,
  onClick,
  tone = 'neutral',
  busy = false,
}: {
  label: string;
  onClick: () => void;
  tone?: 'neutral' | 'danger';
  busy?: boolean;
}) {
  const toneClass =
    tone === 'danger' ? 'text-warn' : 'text-ink-muted active:text-ink';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={`inline-flex min-h-[44px] items-center rounded-lg bg-surface-2/60 px-3 text-sm font-medium transition active:scale-[0.98] disabled:opacity-50 ${toneClass}`}
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

/** Confirmation de suppression INLINE (pas de window.confirm). */
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
    <div className="mt-3 rounded-xl bg-surface-2/60 p-3">
      <p className="text-sm text-ink">{question}</p>
      <p className="mt-0.5 text-xs text-ink-muted">
        Ton historique de séries reste intact.
      </p>
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
 * Confirmation de RÉINITIALISATION d'un exo de base INLINE (issue #50) : on
 * supprime l'override per-user, l'exo revient à sa version partagée. Action
 * NEUTRE (pas danger) : aucun historique n'est touché, seule ta personnalisation
 * disparaît.
 */
function ConfirmReset({
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="mt-3 rounded-xl bg-surface-2/60 p-3">
      <p className="text-sm text-ink">Revenir à l'exercice de base ?</p>
      <p className="mt-0.5 text-xs text-ink-muted">
        Ta personnalisation est retirée. Ton historique de séries reste intact.
      </p>
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onConfirm}
          className="inline-flex h-11 flex-1 items-center justify-center rounded-xl bg-accent-strong px-4 text-sm font-semibold text-on-accent transition active:scale-[0.98] active:bg-accent disabled:opacity-50"
        >
          {busy ? 'Réinitialisation…' : 'Réinitialiser'}
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

function ScreenSpinner({ label }: { label: string }) {
  return (
    <div className="mx-auto w-full max-w-md px-4 pt-3" role="status" aria-label={label}>
      <div className="mb-4 h-8 w-32 rounded-lg bg-surface-2 animate-pulse" />
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="mb-3 rounded-2xl border border-line bg-surface p-3.5">
          <div className="h-4 w-3/5 rounded bg-surface-2 animate-pulse" />
          <div className="mt-2 h-3 w-2/5 rounded bg-surface-2 animate-pulse" />
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
