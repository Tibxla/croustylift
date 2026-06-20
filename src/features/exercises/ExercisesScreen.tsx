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
//   - NOTE par exo (exercise_notes #26, déjà per-user) : éditable pour TOUS les
//     exos (base ET perso) DANS le formulaire « Modifier / Personnaliser » (la note
//     vit dans ExerciseForm, plus d'action note sur la carte de liste). Chargée à
//     l'ouverture du form ; corps vide = suppression.
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
import {
  loadExerciseOverrides,
  upsertExerciseOverride,
  resetExerciseOverride,
} from './overrides';
import { isOverridden } from '../../domain/exercise-override';
import { ExerciseForm, type ExerciseFormValue } from './ExerciseForm';

/** Un champ d'exercice (nom / muscles / unilatéral) diffère-t-il des valeurs courantes ?
    Sert à n'écrire un override d'exo de base QUE si l'utilisateur a vraiment
    personnalisé (éditer la seule note ne doit pas créer de personnalisation). */
function exerciseFieldsChanged(exo: ListExercise, value: ExerciseFormValue): boolean {
  if (exo.name !== value.name) return true;
  if (exo.unilateral !== value.unilateral) return true;
  const a = [...exo.primaryMuscles].sort().join('|');
  const b = [...value.primaryMuscles].sort().join('|');
  return a !== b;
}
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
      <h2 className="text-3xl font-semibold leading-tight tracking-[-0.025em] text-ink">
        Exercices
      </h2>
      <p className="mb-5 mt-1 text-[15px] text-ink-muted">
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
          className="mb-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-hair-strong bg-surface text-base font-medium text-ink transition active:scale-[0.99] active:bg-surface-2"
        >
          <PlusIcon />
          Créer un exo perso
        </button>
      )}

      {/* Recherche (texte libre : <input> légitime), loupe à gauche. */}
      <div className="relative">
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4-4" />
        </svg>
        <input
          type="text"
          value={query}
          placeholder="Chercher un exercice"
          enterKeyHint="search"
          maxLength={80}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Rechercher un exercice"
          className="field h-[46px] w-full rounded-[13px] pl-11 pr-4 text-base text-ink"
        />
      </div>

      <p className="mt-4 mb-2 text-xs text-ink-muted">
        <span className="readout tabular-nums">{total}</span>{' '}
        {total > 1 ? 'exercices' : 'exercice'}
      </p>

      {total === 0 ? (
        <p className="rounded-2xl border border-dashed border-hair-strong px-4 py-8 text-center text-sm text-ink-muted">
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
    <p className="rounded-2xl border border-dashed border-hair-strong px-4 py-6 text-center text-sm text-ink-muted">
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
  const [mode, setMode] = useState<'idle' | 'editLoading' | 'edit' | 'confirmReset'>(
    'idle',
  );
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // « Personnaliser / Modifier » : on charge d'abord la note (éditée dans le form),
  // puis on ouvre le formulaire. Brève étape de chargement.
  async function openEdit() {
    setMode('editLoading');
    setError(null);
    try {
      setNote(await onLoadNote(exo.id));
      setMode('edit');
    } catch (err) {
      setError(errMessage(err));
      setMode('idle');
    }
  }

  if (mode === 'edit') {
    return (
      <RowCard>
        <p className="mb-2 text-sm font-semibold text-ink">
          {overridden ? "Modifier ta version" : "Personnaliser l'exercice"}
        </p>
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
          initialNote={note}
          submitLabel="Enregistrer"
          submitBusyLabel="Enregistrement…"
          onCancel={() => setMode('idle')}
          onSubmit={async (value, noteBody) => {
            // N'écrire l'override que si un champ a changé : éditer la seule note
            // d'un exo de base ne doit pas créer de personnalisation.
            if (exerciseFieldsChanged(exo, value)) await onSaveOverride(exo.id, value);
            await onSaveNote(exo.id, noteBody ?? '');
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
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-medium text-ink">{exo.name}</p>
          <MuscleLine
            exo={exo}
            extra={
              <>
                <BaseBadge />
                {overridden && <CustomizedBadge />}
              </>
            }
          />
        </div>
        {mode === 'idle' && (
          <div className="flex shrink-0 items-center gap-0.5">
            <IconButton
              label={overridden ? 'Modifier ta version' : "Personnaliser l'exercice"}
              onClick={() => void openEdit()}
            >
              <EditIcon />
            </IconButton>
            {overridden && (
              <IconButton
                label="Réinitialiser à l'exercice de base"
                onClick={() => setMode('confirmReset')}
              >
                <ResetIcon />
              </IconButton>
            )}
          </div>
        )}
      </div>

      {mode === 'editLoading' && (
        <p className="mt-3 text-sm text-ink-muted" role="status">
          Chargement…
        </p>
      )}

      {mode === 'confirmReset' && (
        <ConfirmReset
          busy={busy}
          error={error}
          onConfirm={() => void confirmReset()}
          onCancel={() => {
            setError(null);
            setMode('idle');
          }}
        />
      )}

      {mode === 'idle' && error && <RowError message={error} />}
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
  const [mode, setMode] = useState<'idle' | 'editLoading' | 'edit' | 'confirmDelete'>(
    'idle',
  );
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // « Modifier » : on charge la note (éditée dans le form) puis on ouvre le form.
  async function openEdit() {
    setMode('editLoading');
    setError(null);
    try {
      setNote(await onLoadNote(exo.id));
      setMode('edit');
    } catch (err) {
      setError(errMessage(err));
      setMode('idle');
    }
  }

  // Édition : ExerciseForm pré-rempli (nom + muscles + unilatéral + note). « Renommer »
  // = changer le seul champ nom. Un seul flux, un seul « Enregistrer ».
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
          initialNote={note}
          submitLabel="Enregistrer"
          submitBusyLabel="Enregistrement…"
          onCancel={() => setMode('idle')}
          onSubmit={async (value, noteBody) => {
            // ExerciseForm gère son propre état busy/erreur ; on laisse remonter.
            await onUpdate(exo.id, value);
            await onSaveNote(exo.id, noteBody ?? '');
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
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-medium text-ink">{exo.name}</p>
          <MuscleLine exo={exo} />
        </div>
        {mode === 'idle' && (
          <div className="flex shrink-0 items-center gap-0.5">
            <IconButton label="Modifier l'exercice" onClick={() => void openEdit()}>
              <EditIcon />
            </IconButton>
            <IconButton
              label="Supprimer l'exercice"
              tone="danger"
              onClick={() => setMode('confirmDelete')}
            >
              <TrashIcon />
            </IconButton>
          </div>
        )}
      </div>

      {mode === 'editLoading' && (
        <p className="mt-3 text-sm text-ink-muted" role="status">
          Chargement…
        </p>
      )}

      {mode === 'confirmDelete' && (
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
      )}

      {mode === 'idle' && error && <RowError message={error} />}
    </RowCard>
  );
}

/** Ligne « muscles principaux + unilatéral » en chips, jamais la couleur seule.
    `extra` : badges supplémentaires posés en fin de ligne (Base, Personnalisé). */
function MuscleLine({ exo, extra }: { exo: ListExercise; extra?: React.ReactNode }) {
  const muscles =
    exo.primaryMuscles.length > 0
      ? exo.primaryMuscles
      : exo.muscleGroup
        ? [exo.muscleGroup]
        : [];
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {muscles.map((m) => (
        <span
          key={m}
          className="rounded-md bg-surface-2 px-2 py-0.5 text-[11.5px] text-ink-muted"
        >
          {m}
        </span>
      ))}
      {exo.unilateral && <UnilateralBadge />}
      {extra}
    </div>
  );
}

// =====================================================================
// Primitives (cohérentes avec SeancesScreen / SeanceEditor)
// =====================================================================

/** Badge « BASE » : readout mono, pastille surface-2 — statut lecture seule. */
function BaseBadge() {
  return (
    <span className="readout mt-0.5 inline-flex shrink-0 items-center rounded-md border border-hair bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-faint">
      Base
    </span>
  );
}

/** Badge « Personnalisé » : icône (crayon) ET mot, jamais la couleur seule (issue #50). */
function CustomizedBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-accent px-1.5 py-0.5 text-xs font-medium text-accent-ink">
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

/** Chip « Unilatéral » : MOT explicite + fond accent voilé, jamais la couleur seule. */
function UnilateralBadge() {
  return (
    <span className="inline-flex items-center rounded-md border border-accent bg-accent-soft px-2 py-0.5 text-[11.5px] font-medium text-accent-ink">
      Unilatéral
    </span>
  );
}

function RowCard({ children }: { children: React.ReactNode }) {
  return <div className="surface-card rounded-2xl p-3.5">{children}</div>;
}

/** Action d'une ligne en ICÔNE ghost (compacte) : crayon, corbeille, reset. Le
    libellé est porté par `aria-label`/`title` ; tap-target 44px, sans cadre lourd. */
function IconButton({
  label,
  onClick,
  tone = 'neutral',
  children,
}: {
  label: string;
  onClick: () => void;
  tone?: 'neutral' | 'danger';
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-ink-muted transition active:bg-surface-2 ${
        tone === 'danger' ? 'active:text-warn' : 'active:text-ink'
      }`}
    >
      {children}
    </button>
  );
}

function EditIcon() {
  return (
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
      <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function TrashIcon() {
  return (
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
      <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m1 0v12a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V7" />
    </svg>
  );
}

function ResetIcon() {
  return (
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
      <path d="M3 3v6h6" />
      <path d="M21 12A9 9 0 0 0 6 5.3L3 9" />
    </svg>
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
          className="btn btn-primary h-11 flex-1 rounded-xl px-4 text-sm disabled:opacity-50"
        >
          {busy ? 'Réinitialisation…' : 'Réinitialiser'}
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
        <div key={i} className="surface-card mb-3 rounded-2xl p-3.5">
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
