// Édition d'une séance PASSÉE (issue #38), ouverte depuis le journal.
//
// On corrige le réalisé d'un jour antérieur : ajouter / modifier / supprimer des
// séries d'un exo déjà loggé. La saisie réutilise le Stepper au pouce de la
// capture (jamais d'<input>/clavier OS, cf. DESIGN.md). L'écriture passe par le
// MÊME chemin que la capture du jour : on dérive les ops d'outbox (logique pure
// `diffSetsToOps`) et on les enfile/flush via `flushOps` (outbox FIFO,
// idempotent par id, cf. ADR 0003). Aucun second chemin d'écriture, aucune
// mutation des autres jours : chaque op porte l'id de SA ligne, scopée à cette
// exécution.
import { useEffect, useMemo, useState } from 'react';
import { Stepper } from '../capture/Stepper';
import { MetricRow } from '../capture/MetricRow';
import { formatWeight } from '../capture/format';
import { newId } from '../capture/state';
import { loadExecutionForEdit, type EditableExecution } from '../capture/data';
import {
  addSet,
  updateSet,
  removeSet,
  diffSetsToOps,
  groupIntoLogicalSets,
  buildExecutionMetricsOp,
  type EditableSet,
  type LogicalSet,
} from '../capture/past-session-edit';
import { flushOps } from '../capture/sync';
import type { OutboxOp } from '../capture/outbox';
import type { Side } from '../../domain/types';

const WEIGHT_STEP = 2.5;
const WEIGHT_FINE = 1.25;

// Édition des métriques de fin (durée + BPM) d'une séance CLÔTURÉE. Pas au pouce
// avec un palier fin (DESIGN.md, comme la clôture). Durée non-null (CHECK DB
// `> 0`) ; BPM optionnel et nullable.
const DURATION_STEP = 5;
const DURATION_FINE = 1;
const DURATION_MIN = 1;
const DURATION_MAX = 600;
/** Durée proposée si la séance close n'avait pas de chrono (`duration_min` null, cas dégénéré). */
const DURATION_DEFAULT = 60;
const BPM_STEP = 5;
const BPM_FINE = 1;
const BPM_DEFAULT = 130;

/** 'YYYY-MM-DD' -> 'mer. 8 janv. 2026' (date longue lisible, locale fr). */
function formatDateLong(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** État d'édition par exo : l'original (base) gardé pour le diff + l'édité courant. */
interface ExerciseEditState {
  exerciseId: string;
  name: string;
  /** Séries telles qu'en base (ids réels) : référence stable du diff. */
  original: EditableSet[];
  /** Séries après éditions de l'user. */
  edited: EditableSet[];
  /**
   * L'exo est-il UNILATÉRAL ? Figé AU CHARGEMENT depuis l'ORIGINAL (un côté loggé
   * suffit, ADR 0005), jamais réinféré de la liste éditée. Sinon, après avoir
   * supprimé toutes les séries d'un exo unilatéral, « Ajouter une série »
   * retomberait sur une ligne bilatérale (side null) faute de côté restant à
   * inspecter — la nouvelle paire G/D serait perdue.
   */
  unilateral: boolean;
}

/**
 * État d'édition des MÉTRIQUES de fin (durée + BPM) d'une séance CLÔTURÉE. Vit
 * dans la phase 'ready' (comme les exos) pour éviter toute init asynchrone. `null`
 * quand la séance n'est PAS clôturée : on n'édite alors pas les métriques (poser
 * une durée la ferait passer pour close côté `loadTodayExecution`). La durée est
 * toujours un nombre (non-null, décision produit) ; le BPM suit le motif optionnel
 * (replié = non saisi), comme à la clôture.
 */
interface MetricsEditState {
  /** Métriques telles qu'en base : référence stable du diff. */
  original: { bpmAvg: number | null; durationMin: number | null };
  /** Durée éditée (min), toujours un nombre. */
  durationMin: number;
  /** BPM activé (saisi) ? Replié (`false`) = « non saisi » → BPM retiré au save. */
  bpmOn: boolean;
  /** Valeur du Stepper BPM (n'a d'effet que si `bpmOn`). */
  bpm: number;
}

type LoadPhase =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | {
      phase: 'ready';
      date: string;
      exercises: ExerciseEditState[];
      /** Édition durée/BPM : `null` si la séance n'est pas clôturée (cf. MetricsEditState). */
      metrics: MetricsEditState | null;
    };

type SavePhase =
  | { phase: 'idle' }
  | { phase: 'saving' }
  | { phase: 'error'; message: string };

// Suppression de l'exécution entière (issue #44, ADR 0008 : hard delete). Un état
// dédié, parallèle à `SavePhase` : `confirming` ouvre la feuille de confirmation
// in-app (jamais window.confirm), `deleting` désarme les boutons pendant l'enqueue.
type DeletePhase =
  | { phase: 'idle' }
  | { phase: 'confirming' }
  | { phase: 'deleting' }
  | { phase: 'error'; message: string };

export function PastSessionEditor({
  executionId,
  onClose,
  onSaved,
  onDeleted,
}: {
  executionId: string;
  /** Fermer l'éditeur sans rien changer (retour au journal). */
  onClose: () => void;
  /** Appelé après une sauvegarde réussie : le parent recharge le journal/l'analyse. */
  onSaved: () => void;
  /**
   * Appelé après la suppression de l'exécution entière (ADR 0008) : le parent
   * ferme l'éditeur et recharge le journal/l'analyse, MÊME voie que `onSaved`.
   */
  onDeleted: () => void;
}) {
  const [load, setLoad] = useState<LoadPhase>({ phase: 'loading' });
  const [save, setSave] = useState<SavePhase>({ phase: 'idle' });
  const [del, setDel] = useState<DeletePhase>({ phase: 'idle' });

  useEffect(() => {
    let active = true;
    setLoad({ phase: 'loading' });

    void (async () => {
      try {
        const exec = await loadExecutionForEdit(executionId);
        if (!active) return;
        setLoad({
          phase: 'ready',
          date: exec.date,
          exercises: toEditStates(exec),
          metrics: toMetricsState(exec),
        });
      } catch (err) {
        if (!active) return;
        setLoad({
          phase: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    })();

    return () => {
      active = false;
    };
  }, [executionId]);

  // Une édition est en cours dès qu'un exo diffère de son original, OU que les
  // métriques (durée/BPM) diffèrent des leurs.
  const dirty = useMemo(() => {
    if (load.phase !== 'ready') return false;
    const setsDirty = load.exercises.some((ex) => buildOps(ex, executionId).length > 0);
    const metricsDirty =
      load.metrics !== null &&
      buildExecutionMetricsOp(executionId, load.metrics.original, editedMetrics(load.metrics)) !==
        null;
    return setsDirty || metricsDirty;
  }, [load, executionId]);

  function patchExercise(
    exerciseId: string,
    fn: (sets: EditableSet[]) => EditableSet[],
  ) {
    setLoad((prev) => {
      if (prev.phase !== 'ready') return prev;
      return {
        ...prev,
        exercises: prev.exercises.map((ex) =>
          ex.exerciseId === exerciseId ? { ...ex, edited: fn(ex.edited) } : ex,
        ),
      };
    });
    // Une nouvelle édition annule un éventuel message d'erreur de sauvegarde.
    setSave((s) => (s.phase === 'error' ? { phase: 'idle' } : s));
  }

  /** Patche les MÉTRIQUES éditées (durée/BPM). Sans effet si la séance n'est pas close. */
  function patchMetrics(fn: (m: MetricsEditState) => MetricsEditState) {
    setLoad((prev) => {
      if (prev.phase !== 'ready' || prev.metrics === null) return prev;
      return { ...prev, metrics: fn(prev.metrics) };
    });
    setSave((s) => (s.phase === 'error' ? { phase: 'idle' } : s));
  }

  async function handleSave() {
    if (load.phase !== 'ready') return;
    const ops: OutboxOp[] = load.exercises.flatMap((ex) => buildOps(ex, executionId));
    // Métriques de fin (durée/BPM) : une op `updateExecution` minimale, seulement
    // si elles ont changé. Indépendante des séries (ligne `executions`), l'ordre
    // FIFO vis-à-vis des ops de séries est sans incidence.
    if (load.metrics !== null) {
      const metricsOp = buildExecutionMetricsOp(
        executionId,
        load.metrics.original,
        editedMetrics(load.metrics),
      );
      if (metricsOp) ops.push(metricsOp);
    }
    if (ops.length === 0) {
      onClose();
      return;
    }
    setSave({ phase: 'saving' });
    try {
      // `flush` ne REJETTE PAS sur une coupure réseau : il s'arrête à l'op en
      // échec et renvoie `remaining > 0` (cf. outbox.ts). On inspecte donc le
      // résultat, pas seulement les exceptions, sinon on fermerait l'éditeur en
      // croyant la sauvegarde passée alors que les corrections sont encore en
      // file (le journal rechargé montrerait l'ancien réalisé).
      const result = await flushOps(ops);
      if (result.remaining > 0) {
        // Ops durables (déjà enfilées) mais pas encore remontées : on garde
        // l'éditeur ouvert et on explique qu'elles partiront au retour du réseau.
        setSave({ phase: 'error', message: 'Pas de réseau pour le moment.' });
        return;
      }
      onSaved();
    } catch (err) {
      // Erreur inattendue (pas une simple coupure) : les ops restent durables et
      // remonteront au prochain flush ; on garde l'éditeur ouvert pour réessayer.
      setSave({
        phase: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function handleDelete() {
    setDel({ phase: 'deleting' });
    try {
      // Hard delete (ADR 0008) : une seule op `deleteExecution`, la cascade DB
      // efface séries + notes datées. L'op est DURABLE dès l'enqueue (localStorage)
      // et le flush GLOBAL de l'app (App.tsx, montage + 'online') garantit sa
      // remontée même si on ne repasse pas par la Capture.
      // `flush` ne REJETTE PAS sur une coupure : il s'arrête à l'op en échec et
      // renvoie `remaining > 0` (cf. outbox.ts). Si la suppression n'a pas pu
      // remonter tout de suite (offline), on GARDE la feuille en `error` pour le
      // signaler honnêtement (« partira au retour du réseau ») plutôt que de
      // fermer en laissant croire à une synchro immédiate. Sinon, fermeture
      // optimiste : l'éditeur se referme sur l'exécution supprimée.
      const result = await flushOps([{ type: 'deleteExecution', id: executionId }]);
      if (result.remaining > 0) {
        setDel({ phase: 'error', message: 'Pas de réseau pour le moment.' });
        return;
      }
      onDeleted();
    } catch (err) {
      // Erreur inattendue (pas une simple coupure) : l'op reste durable et
      // remontera au prochain flush. On garde la feuille pour signaler l'échec.
      setDel({
        phase: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (load.phase === 'loading') {
    return <EditorShell onClose={onClose}>{<EditorSkeleton />}</EditorShell>;
  }

  if (load.phase === 'error') {
    return (
      <EditorShell onClose={onClose}>
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-sm text-ink-muted">Impossible de charger cette séance.</p>
          <p className="readout max-w-full break-words text-xs text-warn">
            {load.message}
          </p>
        </div>
      </EditorShell>
    );
  }

  // Ce que la suppression effacera, chiffré pour la confirmation (ADR 0008) :
  //   M = nombre d'exos chargés ; N = total des SÉRIES LOGIQUES réelles en base
  // (`original`, jamais `edited` qui refléterait des corrections non sauvegardées).
  // On compte les séries, pas les lignes : une série unilatérale = 2 lignes (G/D)
  // mais UNE série (le libellé de confirmation parle de « séries », ADR 0005).
  const exerciseCount = load.exercises.length;
  const setCount = load.exercises.reduce(
    (sum, ex) => sum + groupIntoLogicalSets(ex.original).length,
    0,
  );

  return (
    <EditorShell onClose={onClose} date={load.date}>
      <div className="flex flex-col gap-5 pb-56">
        {/* Métriques de fin (durée + BPM), seulement pour une séance CLÔTURÉE
            (cf. MetricsEditState). Au-dessus des exos : c'est une donnée de la
            séance entière, pas d'un exo. */}
        {load.metrics !== null && (
          <MetricsEditor
            metrics={load.metrics}
            onDuration={(durationMin) => patchMetrics((m) => ({ ...m, durationMin }))}
            onBpmAdd={() => patchMetrics((m) => ({ ...m, bpmOn: true }))}
            onBpmRemove={() => patchMetrics((m) => ({ ...m, bpmOn: false }))}
            onBpm={(bpm) => patchMetrics((m) => ({ ...m, bpm }))}
          />
        )}

        {load.exercises.map((ex) => (
          <ExerciseEditor
            key={ex.exerciseId}
            exercise={ex}
            onUpdateSet={(id, values) =>
              patchExercise(ex.exerciseId, (sets) => updateSet(sets, id, values))
            }
            onRemoveSet={(ids) =>
              patchExercise(ex.exerciseId, (sets) =>
                // Une série unilatérale supprimée part en entier (les deux côtés) :
                // jamais une série à un seul côté (ADR 0005).
                ids.reduce((acc, id) => removeSet(acc, id), sets),
              )
            }
            onAddSet={() =>
              patchExercise(ex.exerciseId, (sets) =>
                // Reprend la même paire G/D pour un exo unilatéral, une ligne sinon.
                // L'unilatéralité vient de l'état (figé au chargement), pas de la
                // liste courante : ajouter reste correct même après tout supprimer.
                seedNewSets(sets, ex.unilateral).reduce((acc, s) => addSet(acc, s), sets),
              )
            }
          />
        ))}

        {load.exercises.length === 0 && (
          <p className="px-1 text-sm text-ink-muted">
            Aucune série loggée ce jour. Rien à corriger.
          </p>
        )}

        {/* Suppression de l'exécution entière (ADR 0008). Discret, séparé du flux
            d'édition : pas l'accent violet (réservé à l'action primaire / la
            sélection), un simple lien en ton `warn` qui ouvre la confirmation. */}
        <div className="mt-2 border-t border-line pt-5">
          <button
            type="button"
            onClick={() => setDel({ phase: 'confirming' })}
            className="inline-flex h-11 items-center gap-2 rounded-lg px-1 text-sm font-medium text-warn transition active:opacity-70"
          >
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
              <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
            </svg>
            Supprimer cette séance
          </button>
        </div>
      </div>

      {/* Barre d'action fixe : enregistrer les corrections. L'éditeur couvre la
          tab bar (modal z-30) donc on s'ancre tout en bas, pas sur --nav-offset,
          en réservant la safe-area iOS comme les barres de la capture. */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/95 pb-[env(safe-area-inset-bottom,0px)] backdrop-blur">
        <div className="mx-auto w-full max-w-md px-4 py-3">
          {save.phase === 'error' && (
            <p className="readout mb-2 break-words text-xs text-warn">
              La synchronisation a échoué. Tes corrections sont enregistrées en local
              et remonteront au retour du réseau. {save.message}
            </p>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={save.phase === 'saving' || (!dirty && save.phase !== 'error')}
            className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-accent-strong text-base font-semibold text-on-accent transition active:scale-[0.99] active:bg-accent disabled:cursor-not-allowed disabled:bg-surface disabled:text-ink-muted disabled:active:scale-100"
          >
            {save.phase === 'saving'
              ? 'Enregistrement...'
              : dirty
                ? 'Enregistrer les corrections'
                : 'Aucune correction'}
          </button>
        </div>
      </div>

      {del.phase !== 'idle' && (
        <DeleteConfirmSheet
          date={load.date}
          setCount={setCount}
          exerciseCount={exerciseCount}
          phase={del}
          onCancel={() => setDel({ phase: 'idle' })}
          onConfirm={handleDelete}
        />
      )}
    </EditorShell>
  );
}

// --- Feuille de confirmation de suppression (ADR 0008) ----------------------
//
// Surface in-app (jamais window.confirm, jamais d'input OS) montée AU-DESSUS de
// l'éditeur. Elle CHIFFRE la conséquence concrète (date, N séries, M exos) avant
// un hard delete irréversible : la confirmation est la seule barrière, donc elle
// doit nommer ce qui part. [Annuler] [Supprimer], Supprimer en ton `warn`.
function DeleteConfirmSheet({
  date,
  setCount,
  exerciseCount,
  phase,
  onCancel,
  onConfirm,
}: {
  date: string;
  setCount: number;
  exerciseCount: number;
  phase: DeletePhase;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const busy = phase.phase === 'deleting';
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-bg/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-exec-title"
    >
      <div className="w-full max-w-md rounded-t-2xl border-t border-line bg-surface p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] shadow-2xl">
        <h2 id="delete-exec-title" className="text-lg font-bold leading-tight text-ink">
          Supprimer cette séance ?
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          La séance du{' '}
          <span className="readout tabular-nums text-ink">{formatDateLong(date)}</span> et
          ses{' '}
          <span className="readout tabular-nums text-ink">{setCount}</span>{' '}
          {setCount > 1 ? 'séries' : 'série'} sur{' '}
          <span className="readout tabular-nums text-ink">{exerciseCount}</span>{' '}
          {exerciseCount > 1 ? 'exercices' : 'exercice'} seront définitivement
          effacées. Action irréversible.
        </p>

        {phase.phase === 'error' && (
          <p className="readout mt-3 break-words text-xs text-warn">
            La suppression n'a pas pu remonter. Elle est enregistrée en local et
            partira au retour du réseau. {phase.message}
          </p>
        )}

        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="inline-flex h-12 flex-1 items-center justify-center rounded-xl bg-surface-2 text-base font-semibold text-ink transition active:scale-[0.99] active:bg-surface disabled:opacity-60"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="inline-flex h-12 flex-1 items-center justify-center rounded-xl bg-warn text-base font-semibold text-bg transition active:scale-[0.99] active:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? 'Suppression...' : 'Supprimer'}
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Édition des métriques de fin (durée + BPM) ------------------------------
//
// Durée et BPM d'une séance CLÔTURÉE, au pouce (DESIGN.md, jamais d'<input>). La
// durée est un Stepper toujours visible (non-null) ; le BPM suit le motif optionnel
// partagé `MetricRow` (replié = non saisi → retiré au save), comme à la clôture.
// Bloc « niveau séance », posé au-dessus des cartes d'exos. Steppers sur `bg-surface`
// (contraste sur le fond `bg-bg` de l'éditeur), comme à la clôture.
function MetricsEditor({
  metrics,
  onDuration,
  onBpmAdd,
  onBpmRemove,
  onBpm,
}: {
  metrics: MetricsEditState;
  onDuration: (durationMin: number) => void;
  onBpmAdd: () => void;
  onBpmRemove: () => void;
  onBpm: (bpm: number) => void;
}) {
  return (
    <section aria-label="Durée et BPM de la séance">
      <h3 className="mb-3 text-base font-semibold leading-tight text-ink">Durée et BPM</h3>
      <div className="flex flex-col gap-3">
        <div className="rounded-2xl bg-surface px-4 py-3.5">
          <Stepper
            label="Durée"
            unit="min"
            value={metrics.durationMin}
            step={DURATION_STEP}
            fineStep={DURATION_FINE}
            min={DURATION_MIN}
            max={DURATION_MAX}
            onChange={onDuration}
          />
        </div>
        <MetricRow
          title="BPM moyen"
          addLabel="Ajouter le BPM moyen"
          hint="Fréquence cardiaque moyenne de la séance."
          on={metrics.bpmOn}
          onAdd={onBpmAdd}
          onRemove={onBpmRemove}
        >
          <Stepper
            label="BPM moyen"
            unit="bpm"
            value={metrics.bpm}
            step={BPM_STEP}
            fineStep={BPM_FINE}
            min={30}
            max={240}
            onChange={onBpm}
          />
        </MetricRow>
      </div>
    </section>
  );
}

// --- Édition d'un exo --------------------------------------------------------
//
// On édite par SÉRIE LOGIQUE, pas par ligne (ADR 0005) : une série bilatérale
// tient sur une ligne, une série unilatérale sur deux côtés (gauche/droite)
// éditables séparément mais dans UN bloc « Série N ». Conséquences pour ne jamais
// corrompre le côté faible : (a) `side` n'est jamais touché par l'édition de
// valeurs (`updateSet` ne change que poids/reps/RIR) ; (b) supprimer une série
// unilatérale retire LES DEUX côtés d'un coup ; (c) ajouter une série rajoute la
// paire complète. Le regroupement vient de `groupIntoLogicalSets` (module pur).

type RemoveSet = (ids: string[]) => void;
type UpdateSet = (id: string, values: Pick<EditableSet, 'weightKg' | 'reps' | 'rir'>) => void;

function ExerciseEditor({
  exercise,
  onUpdateSet,
  onRemoveSet,
  onAddSet,
}: {
  exercise: ExerciseEditState;
  onUpdateSet: UpdateSet;
  onRemoveSet: RemoveSet;
  onAddSet: () => void;
}) {
  const logicalSets = groupIntoLogicalSets(exercise.edited);

  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <h3 className="text-base font-semibold leading-tight text-ink">{exercise.name}</h3>

      <ol className="mt-3 flex flex-col gap-4">
        {logicalSets.map((logical, index) => (
          <LogicalSetEditor
            key={logical.both?.id ?? `${logical.left?.id ?? 'l'}-${logical.right?.id ?? 'r'}`}
            logical={logical}
            index={index}
            onUpdateSet={onUpdateSet}
            onRemoveSet={onRemoveSet}
          />
        ))}
      </ol>

      <button
        type="button"
        onClick={onAddSet}
        className="mt-3 inline-flex min-h-[3rem] w-full items-center justify-center gap-2 rounded-xl bg-surface-2 text-sm font-semibold text-ink transition active:scale-[0.99] active:bg-surface"
      >
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
        Ajouter une série
      </button>
    </section>
  );
}

/** Une série logique éditable : une ligne (bilatéral) ou deux côtés G/D (unilatéral). */
function LogicalSetEditor({
  logical,
  index,
  onUpdateSet,
  onRemoveSet,
}: {
  logical: LogicalSet;
  index: number;
  onUpdateSet: UpdateSet;
  onRemoveSet: RemoveSet;
}) {
  // Les ids des lignes de CETTE série logique : 1 (bilatéral) ou 2 (la paire G/D).
  const ids = [logical.both, logical.left, logical.right]
    .filter((s): s is EditableSet => s !== null)
    .map((s) => s.id);

  return (
    <li className="rounded-xl bg-surface-2/60 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="readout text-sm font-medium tabular-nums text-ink-muted">
          Série <span className="text-ink">{index + 1}</span>
        </span>
        <button
          type="button"
          onClick={() => onRemoveSet(ids)}
          className="inline-flex h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-ink-muted transition active:bg-surface active:text-ink"
          aria-label={`Supprimer la série ${index + 1}`}
        >
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
            <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
          </svg>
          Supprimer
        </button>
      </div>

      {logical.both !== null ? (
        <SetFields set={logical.both} onUpdateSet={onUpdateSet} />
      ) : (
        <div className="flex flex-col gap-3">
          {logical.left !== null && (
            <SetFields set={logical.left} side="left" onUpdateSet={onUpdateSet} />
          )}
          {logical.right !== null && (
            <SetFields set={logical.right} side="right" onUpdateSet={onUpdateSet} />
          )}
        </div>
      )}
    </li>
  );
}

/** Les steppers d'UNE ligne (poids/reps/RIR), précédés du label de côté en unilatéral. */
function SetFields({
  set,
  side,
  onUpdateSet,
}: {
  set: EditableSet;
  /** Côté affiché (unilatéral) ; absent en bilatéral (pas de label). */
  side?: Side;
  onUpdateSet: UpdateSet;
}) {
  return (
    <div>
      {side !== undefined && (
        <span className="mb-1.5 inline-block text-xs font-semibold uppercase tracking-wide text-ink-muted">
          {side === 'left' ? 'Gauche' : 'Droite'}
        </span>
      )}
      <Stepper
        label="Poids"
        unit="kg"
        value={set.weightKg}
        step={WEIGHT_STEP}
        fineStep={WEIGHT_FINE}
        min={0}
        format={formatWeight}
        onChange={(weightKg) =>
          onUpdateSet(set.id, { weightKg, reps: set.reps, rir: set.rir })
        }
      />
      <div className="mt-3 grid grid-cols-2 gap-4">
        <Stepper
          label="Reps"
          value={set.reps}
          step={1}
          min={1}
          onChange={(reps) =>
            onUpdateSet(set.id, { weightKg: set.weightKg, reps, rir: set.rir })
          }
        />
        <Stepper
          label="RIR"
          value={set.rir}
          step={1}
          min={0}
          onChange={(rir) =>
            onUpdateSet(set.id, { weightKg: set.weightKg, reps: set.reps, rir })
          }
        />
      </div>
    </div>
  );
}

// --- Chrome de l'éditeur (plein écran modal) --------------------------------

function EditorShell({
  children,
  onClose,
  date,
}: {
  children: React.ReactNode;
  onClose: () => void;
  date?: string;
}) {
  return (
    <div className="fixed inset-0 z-30 overflow-y-auto bg-bg">
      <div className="mx-auto w-full max-w-md px-4 pb-8 pt-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-xl font-bold leading-tight text-ink">
              Corriger la séance
            </h2>
            {date && (
              <p className="readout mt-0.5 text-sm tabular-nums text-ink-muted">
                {formatDateLong(date)}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="-mr-1 inline-flex h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-ink-muted transition active:text-ink"
            aria-label="Fermer sans enregistrer"
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
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
            Fermer
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function EditorSkeleton() {
  return (
    <ul className="flex flex-col gap-5" role="status" aria-label="Chargement de la séance">
      {[0, 1].map((i) => (
        <li key={i} className="rounded-2xl border border-line bg-surface p-4">
          <div className="mb-3 h-5 w-40 animate-pulse rounded bg-surface-2" />
          <div className="h-24 w-full animate-pulse rounded-xl bg-surface-2" />
        </li>
      ))}
    </ul>
  );
}

// --- Helpers (pas de logique métier ici : tout le diff vit dans le module pur) ---

/**
 * État d'édition des métriques depuis l'exécution chargée, ou `null` si la séance
 * n'est PAS clôturée (on n'édite alors pas durée/BPM, cf. MetricsEditState). Durée
 * pré-remplie avec la valeur en base, ou un défaut sobre si la séance close n'avait
 * pas de chrono (`duration_min` null). BPM « saisi » ssi une valeur est en base.
 */
function toMetricsState(exec: EditableExecution): MetricsEditState | null {
  if (exec.closedAt === null) return null;
  return {
    original: { bpmAvg: exec.bpmAvg, durationMin: exec.durationMin },
    durationMin: exec.durationMin ?? DURATION_DEFAULT,
    bpmOn: exec.bpmAvg !== null,
    bpm: exec.bpmAvg ?? BPM_DEFAULT,
  };
}

/** Les métriques éditées sous la forme attendue par `buildExecutionMetricsOp` (BPM replié = retiré). */
function editedMetrics(m: MetricsEditState): { bpmAvg: number | null; durationMin: number } {
  return { bpmAvg: m.bpmOn ? m.bpm : null, durationMin: m.durationMin };
}

/** Transforme l'exécution chargée en états d'édition (original figé = édité au départ). */
function toEditStates(exec: EditableExecution): ExerciseEditState[] {
  return exec.exercises.map((ex) => ({
    exerciseId: ex.exerciseId,
    name: ex.name,
    original: ex.sets,
    // Copie distincte : l'édition ne doit jamais muter la référence du diff.
    edited: ex.sets.map((s) => ({ ...s })),
    // Unilatéralité figée depuis l'ORIGINAL : un côté loggé suffit (ADR 0005).
    // Reste vrai même si l'user supprime ensuite toutes les séries.
    unilateral: ex.sets.some((s) => s.side !== undefined),
  }));
}

/** Ops d'outbox d'un exo : diff (original -> édité), scopé à cette exécution/exo. */
function buildOps(ex: ExerciseEditState, executionId: string): OutboxOp[] {
  return diffSetsToOps(ex.original, ex.edited, {
    executionId,
    exerciseId: ex.exerciseId,
  });
}

/**
 * Les lignes d'une série AJOUTÉE : report des valeurs de la dernière série (le
 * plus probable en muscu, on reprend la même charge), sinon un point de départ
 * neutre. Chaque ligne reçoit un UUID client neuf (cf. ADR 0003) pour que
 * l'insert ne collisionne pas.
 *
 * `unilateral` vient de l'état d'édition (figé au chargement depuis l'original),
 * PAS de la liste `sets` courante : sinon, après avoir supprimé toutes les séries
 * d'un exo unilatéral, la liste vide ferait conclure « bilatéral » et l'ajout
 * créerait une ligne `side: null` (upsert bilatéral) au lieu d'une paire G/D.
 *
 * Pour un exo UNILATÉRAL, on ajoute une PAIRE complète (gauche + droite) : jamais
 * une série à un seul côté (ADR 0005), avec les valeurs du côté correspondant en
 * base. Pour un exo bilatéral, une seule ligne sans `side`. Les `sets` ne servent
 * qu'au REPORT des valeurs (dernière série du côté visé), jamais à décider du côté.
 */
function seedNewSets(sets: EditableSet[], unilateral: boolean): EditableSet[] {
  const seedValues = (side?: Side): EditableSet => {
    const ref =
      [...sets].reverse().find((s) => s.side === side) ?? sets[sets.length - 1];
    const base = ref
      ? { weightKg: ref.weightKg, reps: ref.reps, rir: ref.rir }
      : { weightKg: 20, reps: 10, rir: 1 };
    return { id: newId(), ...base, side };
  };
  if (unilateral) {
    return [seedValues('left'), seedValues('right')];
  }
  return [seedValues(undefined)];
}
