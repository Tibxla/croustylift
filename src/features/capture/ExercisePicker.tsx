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

const STATUS_LABEL: Record<string, string> = {
  todo: 'À faire',
  'in-progress': 'En cours',
  done: 'Fait',
  skipped: 'Passé',
};

/** Couleur du label de statut, calée sur la maquette : accent en cours, vert fait,
    ambre passé, neutre à faire (l'info reste portée par le texte + l'indicateur). */
const STATUS_LABEL_COLOR: Record<string, string> = {
  todo: 'text-ink-muted',
  'in-progress': 'text-accent-ink',
  done: 'text-good',
  skipped: 'text-warn',
};

/**
 * Indicateur d'état d'un exo : anneau (à faire), anneau accent + cœur plein (en
 * cours), disque vert + coche (fait), anneau ambre + tiret (passé). L'info tient
 * à la FORME autant qu'à la couleur (DESIGN.md, jamais la couleur seule) ; plus
 * lisible et plus « instrument » qu'un simple point.
 */
function StatusIndicator({ status }: { status: ExerciseStatus }) {
  return (
    <span className="relative mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center" aria-hidden="true">
      <svg viewBox="0 0 18 18" width="18" height="18" fill="none">
        {status === 'done' ? (
          <>
            <circle cx="9" cy="9" r="9" fill="var(--color-good)" />
            <path
              d="M5.4 9.2l2.3 2.3 4.9-5"
              stroke="var(--color-bg)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </>
        ) : status === 'skipped' ? (
          <>
            <circle cx="9" cy="9" r="8" stroke="var(--color-warn)" strokeWidth="1.5" opacity="0.55" />
            <path d="M5.5 9h7" stroke="var(--color-warn)" strokeWidth="2" strokeLinecap="round" />
          </>
        ) : status === 'in-progress' ? (
          <>
            <circle cx="9" cy="9" r="8" stroke="var(--color-accent)" strokeWidth="1.5" />
            <circle cx="9" cy="9" r="3.2" fill="var(--color-accent)" />
          </>
        ) : (
          <circle cx="9" cy="9" r="7.5" stroke="var(--color-line)" strokeWidth="1.75" />
        )}
      </svg>
    </span>
  );
}

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
        <h2 className="text-[27px] font-semibold tracking-[-0.025em] text-ink">{session.name}</h2>
        <p className="mt-1 text-[13.5px] text-ink-muted">
          Tape l&apos;exercice que tu attaques.{' '}
          <span className="readout tabular-nums">
            {doneCount}/{session.exercises.length}
          </span>{' '}
          fait{doneCount > 1 ? 's' : ''}.
        </p>
      </header>

      {allDone && (
        <div
          className="panel mb-4 rounded-2xl px-4 py-3 text-sm text-good"
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
            // Remplacement autorisé tant que l'exo n'est pas entamé (aucune série,
            // pas passé) : la séance courante peut encore évoluer (issue #36).
            const canSwap = count === 0 && !progress.skipped;
            return (
              <li
                key={ex.exerciseId}
                className="surface-interactive relative flex items-center gap-3.5 rounded-[18px] px-4 py-3.5"
              >
                {/* Carte entière tappable (= ouvrir l'exo). Bouton plein recouvrant,
                    pour que le bouton « Remplacer » reste un frère (jamais imbriqué). */}
                <button
                  type="button"
                  onClick={() => onPick(ex.exerciseId)}
                  aria-label={`Ouvrir ${ex.name}`}
                  className="absolute inset-0 rounded-[18px]"
                />
                <StatusIndicator status={status} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 truncate text-base font-semibold text-ink">
                      {ex.name}
                    </span>
                    {deviation && <ExerciseDeviationTag kind={deviation} />}
                  </span>
                  <span className="readout mt-0.5 block truncate text-[12.5px] text-ink-muted">
                    {formatPrescription(
                      ex.prescription.sets,
                      ex.prescription.reps,
                      ex.prescription.rir,
                    )}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-0.5">
                  <span className={`text-[11.5px] font-medium ${STATUS_LABEL_COLOR[status]}`}>
                    {STATUS_LABEL[status]}
                  </span>
                  {count > 0 && (
                    <span className="readout text-[13px] font-medium text-ink tabular-nums">
                      {count}/{formatRange(ex.prescription.sets)}
                    </span>
                  )}
                </span>
                {/* Remplacer inline : carré fantôme ⇄ dans la ligne (maquette), pas un
                    pied de carte. `z-10` pour capter son tap au-dessus du bouton plein. */}
                {canSwap && (
                  <button
                    type="button"
                    title="Remplacer l'exercice"
                    aria-label={`Remplacer ${ex.name}`}
                    onClick={() => setCatalog({ mode: 'swap', exerciseId: ex.exerciseId, name: ex.name })}
                    className="relative z-10 flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[10px] border border-hair-strong text-ink-muted transition active:bg-surface-2 active:text-ink"
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M16 3l4 4-4 4" />
                      <path d="M20 7H8" />
                      <path d="M8 21l-4-4 4-4" />
                      <path d="M4 17h12" />
                    </svg>
                  </button>
                )}
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
        className="mt-4 flex min-h-[3.25rem] w-full items-center gap-3 rounded-2xl border border-dashed border-hair-strong px-4 py-3 text-left text-ink-muted transition-colors duration-200 active:bg-surface active:text-ink"
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
          className="shrink-0"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
        <span className="text-base font-medium">Ajouter un exercice</span>
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
    <span className="inline-flex shrink-0 items-center rounded-md border border-hair-strong px-1.5 py-0.5 text-[0.6875rem] font-medium text-ink-muted">
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
      <div className="relative mt-auto flex max-h-[85vh] flex-col rounded-t-[26px] border-t border-hair-strong bg-bg pb-[calc(env(safe-area-inset-bottom,0)+1rem)] shadow-2xl">
        <div className="mx-auto mt-3 h-[5px] w-[42px] rounded-[3px] bg-surface-2" aria-hidden="true" />
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

          <div className="relative mb-3">
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
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.2-4.2" />
            </svg>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Chercher un exercice"
              className="field h-11 w-full rounded-[13px] pl-10 pr-4 text-base"
            />
          </div>
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
                    className="surface-interactive flex min-h-[3rem] w-full items-center gap-3 rounded-xl px-4 py-3 text-left disabled:opacity-60"
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
