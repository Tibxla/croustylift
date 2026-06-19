// Sélecteur d'exo : « je tape l'exo que j'attaque » (ordre libre).
// Chaque ligne : nom, cible prescrite, état (à faire / en cours / fait + compteur).
// On peut aussi AJOUTER un exo hors template ou en REMPLACER un à la volée
// (issue #36) : la séance courante évolue, le template versionné reste intact.
import { useEffect, useMemo, useState } from 'react';
import type { ExerciseRow } from './data';
import type { Session, SessionExercise } from './fixtures';
import type { CaptureState, ExerciseProgress, ExerciseStatus } from './state';
import { getProgress } from './state';
import { deriveExerciseDeviations } from './session-edit';
import { formatPrescription, formatRange } from './format';
import { foldAccents } from '../../domain/text';
import { countLogicalSetsDone } from '../../domain/set-count';

/**
 * Nombre de SÉRIES LOGIQUES faites d'un exo, et non de lignes loggées : en
 * UNILATÉRAL une série tient sur deux lignes (gauche + droite au même `order`,
 * cf. CONTEXT.md « Série »), donc `progress.sets.length` double le compte. On
 * compte les `order` distincts (`countLogicalSetsDone`), juste pour les deux cas
 * (bilatéral : 1 ligne = 1 order = 1 série). C'est ce compte qu'on compare à la
 * prescription (un nombre de SÉRIES) et qu'on affiche « X/N séries ».
 */
function logicalSetsDone(progress: ExerciseProgress): number {
  return countLogicalSetsDone(progress.sets);
}

/**
 * Statut d'un exo dans le sélecteur, calé sur le décompte de SÉRIES LOGIQUES (et
 * non sur `sets.length` comme `statusOf`, qui surcompterait l'unilatéral). Même
 * sémantique : passé → `skipped` ; aucune série → `todo` ; au moins le min de
 * séries prescrit → `done` ; sinon `in-progress`.
 */
function statusFromLogicalSets(progress: ExerciseProgress, prescribedMin: number): ExerciseStatus {
  if (progress.skipped) return 'skipped';
  const done = logicalSetsDone(progress);
  if (done === 0) return 'todo';
  return done >= prescribedMin ? 'done' : 'in-progress';
}

interface ExercisePickerProps {
  session: Session;
  /** Ids des exos du template d'origine (réf. du diff de déviations, figée). */
  templateExerciseIds: string[];
  state: CaptureState;
  onPick: (exerciseId: string) => void;
  /** Charge le catalogue (base + perso) à l'ouverture du sélecteur d'ajout. */
  loadCatalog: () => Promise<ExerciseRow[]>;
  /** Charge un exo du catalogue prêt à entrer dans la séance (réf. + records). */
  loadCatalogExercise: (row: Pick<ExerciseRow, 'id' | 'name'>) => Promise<SessionExercise>;
  /** Ajoute l'exo choisi à la séance courante. */
  onAddExercise: (exercise: SessionExercise) => void;
  /** Remplace `targetExerciseId` par l'exo choisi. */
  onSwapExercise: (targetExerciseId: string, replacement: SessionExercise) => void;
}

const STATUS_DOT: Record<string, string> = {
  todo: 'bg-line',
  'in-progress': 'bg-accent',
  done: 'bg-good',
  skipped: 'bg-warn',
};

const STATUS_LABEL: Record<string, string> = {
  todo: 'À faire',
  'in-progress': 'En cours',
  done: 'Fait',
  skipped: 'Passé',
};

/** Cible de l'ouverture du catalogue : ajout libre, ou remplacement d'un exo. */
type CatalogTarget = { mode: 'add' } | { mode: 'swap'; exerciseId: string; name: string };

export function ExercisePicker({
  session,
  templateExerciseIds,
  state,
  onPick,
  loadCatalog,
  loadCatalogExercise,
  onAddExercise,
  onSwapExercise,
}: ExercisePickerProps) {
  const doneCount = session.exercises.filter((ex) => {
    const p = getProgress(state, ex.exerciseId);
    return p.skipped || logicalSetsDone(p) >= ex.prescription.sets.min;
  }).length;
  const allDone = doneCount === session.exercises.length;

  // Déviations d'exo (ajout / swap) dérivées par diff : par exerciseId, pour
  // étiqueter sobrement les lignes concernées.
  const deviationByExercise = useMemo(() => {
    const map = new Map<string, 'added' | 'swapped'>();
    for (const dev of deriveExerciseDeviations(templateExerciseIds, session)) {
      map.set(dev.exerciseId, dev.kind);
    }
    return map;
  }, [templateExerciseIds, session]);

  // Catalogue ouvert (ajout ou swap), ou null si fermé.
  const [catalog, setCatalog] = useState<CatalogTarget | null>(null);

  return (
    <div className="mx-auto flex w-full max-w-md flex-col px-4 pb-28 pt-5">
      <header className="mb-5">
        <h2 className="text-2xl font-semibold tracking-tight text-ink">{session.name}</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Tape l&apos;exercice que tu attaques.{' '}
          <span className="readout tabular-nums">
            {doneCount}/{session.exercises.length}
          </span>{' '}
          fait{doneCount > 1 ? 's' : ''}.
        </p>
      </header>

      {allDone && (
        <div
          className="mb-4 rounded-2xl bg-surface px-4 py-3 text-sm text-good"
          role="status"
          aria-live="polite"
        >
          <span className="font-medium">Séance terminée.</span> Tous les exercices sont
          traités. Tu peux ranger le téléphone.
        </div>
      )}

      {session.exercises.length === 0 ? (
        <p className="rounded-2xl bg-surface px-4 py-8 text-center text-sm text-ink-muted">
          Aucun exercice dans cette séance.
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {session.exercises.map((ex) => {
            const progress = getProgress(state, ex.exerciseId);
            const status = statusFromLogicalSets(progress, ex.prescription.sets.min);
            const count = logicalSetsDone(progress);
            const deviation = deviationByExercise.get(ex.exerciseId) ?? null;
            return (
              <li key={ex.exerciseId}>
                <button
                  type="button"
                  onClick={() => onPick(ex.exerciseId)}
                  className="group flex w-full items-center gap-3 rounded-2xl bg-surface px-4 py-3.5 text-left transition active:scale-[0.99] active:bg-surface-2"
                >
                  <span
                    className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${STATUS_DOT[status]}`}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 truncate text-base font-semibold text-ink">
                        {ex.name}
                      </span>
                      {deviation && <ExerciseDeviationTag kind={deviation} />}
                    </span>
                    <span className="readout mt-0.5 block truncate text-sm text-ink-muted">
                      {formatPrescription(
                        ex.prescription.sets,
                        ex.prescription.reps,
                        ex.prescription.rir,
                      )}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-0.5">
                    <span className="text-xs font-medium text-ink-muted">
                      {STATUS_LABEL[status]}
                    </span>
                    {count > 0 && (
                      <span className="readout text-sm font-medium text-ink tabular-nums">
                        {count}/{formatRange(ex.prescription.sets)}
                      </span>
                    )}
                  </span>
                  <svg
                    viewBox="0 0 24 24"
                    width="18"
                    height="18"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="shrink-0 text-ink-muted"
                    aria-hidden="true"
                  >
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                </button>

                {/* Remplacer cet exo : action discrète, propre à la ligne. Pas
                    encore touché (aucune série / pas passé) → on autorise le swap. */}
                {count === 0 && !progress.skipped && (
                  <div className="mt-1 pl-7">
                    <button
                      type="button"
                      onClick={() => setCatalog({ mode: 'swap', exerciseId: ex.exerciseId, name: ex.name })}
                      className="inline-flex h-9 items-center rounded-lg px-2 text-xs font-medium text-ink-muted transition active:text-ink"
                    >
                      Remplacer
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Ajouter un exo hors template (issue #36). Surface neutre, pas d'accent
          décoratif : le violet reste pour l'action primaire (logger). */}
      <button
        type="button"
        onClick={() => setCatalog({ mode: 'add' })}
        className="mt-4 flex min-h-[3.25rem] w-full items-center gap-3 rounded-2xl bg-surface px-4 py-3 text-left transition active:scale-[0.99] active:bg-surface-2"
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
          className="shrink-0 text-ink-muted"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
        <span className="text-base font-semibold text-ink">Ajouter un exercice</span>
      </button>

      {catalog && (
        <CatalogSheet
          target={catalog}
          existingExerciseIds={session.exercises.map((e) => e.exerciseId)}
          loadCatalog={loadCatalog}
          loadCatalogExercise={loadCatalogExercise}
          onClose={() => setCatalog(null)}
          onChosen={(exercise) => {
            if (catalog.mode === 'swap') {
              onSwapExercise(catalog.exerciseId, exercise);
            } else {
              onAddExercise(exercise);
            }
            setCatalog(null);
          }}
        />
      )}
    </div>
  );
}

/** Étiquette sobre d'un exo dévié (ajouté / remplacé) : forme + texte, pas que la couleur. */
function ExerciseDeviationTag({ kind }: { kind: 'added' | 'swapped' }) {
  const label = kind === 'added' ? 'Ajouté' : 'Remplacé';
  return (
    <span className="inline-flex shrink-0 items-center rounded-md border border-line px-1.5 py-0.5 text-[0.6875rem] font-medium text-ink-muted">
      {label}
    </span>
  );
}

// --- Feuille de sélection dans le catalogue ---------------------------------

/**
 * Sélecteur d'exo dans le catalogue (base + perso) pour l'ajout ou le swap.
 * Charge le catalogue à l'ouverture, filtre par recherche, exclut les exos déjà
 * dans la séance (un swap garde sa cible exclue aussi : on ne se remplace pas
 * par soi-même). Feuille modale simple, fermable par le fond ou « Annuler ».
 */
function CatalogSheet({
  target,
  existingExerciseIds,
  loadCatalog,
  loadCatalogExercise,
  onClose,
  onChosen,
}: {
  target: CatalogTarget;
  existingExerciseIds: string[];
  loadCatalog: () => Promise<ExerciseRow[]>;
  loadCatalogExercise: (row: Pick<ExerciseRow, 'id' | 'name'>) => Promise<SessionExercise>;
  onClose: () => void;
  onChosen: (exercise: SessionExercise) => void;
}) {
  const [rows, setRows] = useState<ExerciseRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  // Id de l'exo en cours de chargement (réf. + records) après un tap.
  const [picking, setPicking] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setRows(null);
    setError(null);
    void (async () => {
      try {
        const data = await loadCatalog();
        if (alive) setRows(data);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      alive = false;
    };
  }, [loadCatalog]);

  const excluded = useMemo(() => new Set(existingExerciseIds), [existingExerciseIds]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = foldAccents(query.trim());
    return rows
      .filter((r) => !excluded.has(r.id))
      .filter((r) => (q === '' ? true : foldAccents(r.name).includes(q)))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  }, [rows, excluded, query]);

  const handlePick = async (row: ExerciseRow) => {
    setPicking(row.id);
    try {
      const exercise = await loadCatalogExercise({ id: row.id, name: row.name });
      onChosen(exercise);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPicking(null);
    }
  };

  const title = target.mode === 'swap' ? `Remplacer ${target.name}` : 'Ajouter un exercice';

  return (
    <div className="fixed inset-0 z-30 flex flex-col">
      {/* Fond cliquable pour fermer. */}
      <button
        type="button"
        aria-label="Fermer"
        onClick={onClose}
        className="absolute inset-0 bg-bg/70 backdrop-blur-sm"
      />
      <div className="relative mt-auto flex max-h-[85vh] flex-col rounded-t-3xl border-t border-line bg-bg pb-[calc(env(safe-area-inset-bottom,0)+1rem)] shadow-2xl">
        <div className="mx-auto flex w-full max-w-md flex-col px-4 pt-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-lg font-semibold text-ink">{title}</h3>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 items-center rounded-lg px-2 text-sm font-medium text-ink-muted transition active:text-ink"
            >
              Annuler
            </button>
          </div>

          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Chercher un exercice"
            className="mb-3 h-11 w-full rounded-xl border border-line bg-surface px-4 text-base text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none"
          />
        </div>

        <div className="mx-auto w-full max-w-md flex-1 overflow-y-auto px-4">
          {error ? (
            <p className="py-8 text-center text-sm text-warn">{error}</p>
          ) : rows === null ? (
            <p className="py-8 text-center text-sm text-ink-muted">Chargement du catalogue…</p>
          ) : filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-ink-muted">
              {query.trim() === ''
                ? 'Aucun exercice disponible.'
                : 'Aucun exercice ne correspond.'}
            </p>
          ) : (
            <ul className="flex flex-col gap-2 pb-2">
              {filtered.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    disabled={picking !== null}
                    onClick={() => void handlePick(row)}
                    className="flex min-h-[3rem] w-full items-center gap-3 rounded-xl bg-surface px-4 py-3 text-left transition active:scale-[0.99] active:bg-surface-2 disabled:opacity-60"
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <span className="truncate text-base font-medium text-ink">
                        {row.name}
                      </span>
                      {row.unilateral && <UnilateralBadge />}
                    </span>
                    {picking === row.id && (
                      <span
                        className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-line border-t-accent"
                        role="status"
                        aria-label="Chargement"
                      />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Marqueur « Unilatéral » pour un exo du catalogue (issue #57). Mot EXPLICITE +
 * pastille de surface tonale : l'info n'est jamais portée par la seule couleur
 * (DESIGN.md). Sobre (surface-2 / ink-muted), sans accent violet (One Voice Rule).
 */
function UnilateralBadge() {
  return (
    <span className="inline-flex shrink-0 items-center rounded-md bg-surface-2 px-1.5 py-0.5 text-[0.6875rem] font-medium leading-none text-ink-muted">
      Unilatéral
    </span>
  );
}
