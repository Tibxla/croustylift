// Corriger une séance PASSÉE (issue #38), ouverte depuis le journal.
//
// On corrige le réalisé d'un jour antérieur : modifier, ajouter ou supprimer des
// séries d'un exo déjà loggé, et la durée et le BPM d'une séance close. Écran du
// kit E, dans le flux de l'Analyse (plus d'overlay plein écran) : chaque série
// est une ligne ; la toucher ouvre une feuille avec les contrôles de la Salle (la
// lecture du poids, la règle, reps et RIR en un tap, aucun clavier imposé). Les
// corrections restent un brouillon jusqu'à « Enregistrer les corrections », en
// bas, dans la barre collée (`sticky`, jamais `fixed`).
//
// L'écriture passe par le MÊME chemin que la capture du jour : on dérive les ops
// d'outbox (logique pure `diffSetsToOps`) et on les enfile et vide via
// `flushOps` (outbox FIFO, idempotent par id, cf. ADR 0003). Aucun second chemin
// d'écriture, aucune mutation des autres jours : chaque op porte l'id de SA
// ligne, scopée à cette exécution.
//
// Un brouillon ne se perd pas en silence : quitter l'écran (retour, ou un mot de
// la navigation, par la garde `setLeaveGuard`) passe par une confirmation, et
// aucun rechargement automatique n'a lieu tant qu'il existe
// (`useReloadBlockWhile`).
import { useEffect, useMemo, useState } from 'react';
import { Icon, IconButton, NumberRow, PrimaryButton, Ruler, ScreenHeader, SecondaryButton, SectionTitle, Sheet, Screen, TextLink } from '../../ui';
import { useReglages } from '../../settings/reglages';
import { formatWeight } from '../capture/format';
import { roundWeightKg } from '../capture/stepper-utils';
import { WeightReadout } from '../capture/WeightReadout';
import { clearPersistedExecution, newId } from '../capture/state';
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
import { unsavedWritesLabel } from '../capture/sync-label';
import { SESSION_DURATION_MAX_MIN } from '../capture/summary';
import type { OutboxOp } from '../capture/outbox';
import type { Side } from '../../domain/types';
import { setLeaveGuard } from '../authoring/seance-dirty';
import { useReloadBlockWhile } from '../../pwa/useReloadBlockWhile';
import { errorMessage } from '../../lib/error-message';
import { formatDateLong, formatDuration } from './format';

/** Raison du blocage de rechargement tenu par des corrections non sauvées d'une séance passée. */
const PAST_SESSION_DRAFT_BLOCK = 'brouillon-seance-passee';

// Métriques de fin (durée + BPM) d'une séance CLÔTURÉE, à la règle (comme la fin
// de séance). Optionnelles : retirées, elles sont « non notées » (`null` en
// base), y compris une durée déjà enregistrée que l'on efface.
const DURATION_MIN = 1;
const DURATION_MAX = SESSION_DURATION_MAX_MIN;
/** Valeur de départ quand on AJOUTE une durée à une séance close qui n'en avait pas. */
const DURATION_DEFAULT = 60;
const BPM_MIN = 30;
const BPM_MAX = 240;
const BPM_DEFAULT = 130;
const REPS_ROW_MAX = 50;
const RIR_ROW_MAX = 10;
const RULER_MAX_KG = 500;

const values = (s: Pick<EditableSet, 'weightKg' | 'reps' | 'rir'>) => `${formatWeight(s.weightKg)} kg × ${s.reps} · RIR ${s.rir}`;
const sideWord = (s: Side) => (s === 'left' ? 'gauche' : 'droite');

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
   * inspecter : la nouvelle paire G/D serait perdue.
   */
  unilateral: boolean;
}

/**
 * État d'édition des MÉTRIQUES de fin (durée + BPM) d'une séance CLÔTURÉE. Vit
 * dans la phase 'ready' (comme les exos) pour éviter toute init asynchrone. `null`
 * quand la séance n'est PAS clôturée : on n'édite alors pas les métriques (poser
 * une durée la ferait passer pour close côté `loadTodayExecution`). Durée et BPM
 * suivent le même motif optionnel (replié = non saisi) : corriger une séance
 * close sans durée n'en écrit pas une.
 */
interface MetricsEditState {
  /** Métriques telles qu'en base : référence stable du diff. */
  original: { bpmAvg: number | null; durationMin: number | null };
  /**
   * Durée activée (saisie) ? Repliée (`false`) = « non saisie » : une séance close
   * sans durée reste sans durée tant qu'on ne l'ajoute pas (jamais de valeur
   * inventée, même principe que le BPM).
   */
  durationOn: boolean;
  /** Durée réglée (n'a d'effet que si `durationOn`). */
  durationMin: number;
  /** BPM activé (saisi) ? Replié (`false`) = « non saisi » → BPM retiré au save. */
  bpmOn: boolean;
  /** BPM réglé (n'a d'effet que si `bpmOn`). */
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

/** La série ouverte dans la feuille : une ligne, et sa série logique (ses deux côtés). */
interface Editing {
  exerciseId: string;
  exerciseName: string;
  rank: number;
  set: EditableSet;
  /** Les ids de la série logique : 1 (bilatéral) ou 2 (gauche et droite). */
  logicalIds: string[];
  /** Série ajoutée dans ce brouillon (pas encore en base) : ses valeurs sont reprises de la précédente. */
  added: boolean;
}

export function PastSessionEditor({
  executionId,
  onClose,
  onSaved,
  onDeleted,
}: {
  executionId: string;
  /** Quitter l'éditeur sans rien changer (retour à la séance). */
  onClose: () => void;
  /** Appelé après une sauvegarde réussie : le parent recharge le journal et l'analyse. */
  onSaved: () => void;
  /**
   * Appelé après la suppression de l'exécution entière (ADR 0008) : le parent
   * ferme l'éditeur et recharge le journal et l'analyse, MÊME voie que `onSaved`.
   */
  onDeleted: () => void;
}) {
  const [load, setLoad] = useState<LoadPhase>({ phase: 'loading' });
  const [save, setSave] = useState<SavePhase>({ phase: 'idle' });
  const [del, setDel] = useState<DeletePhase>({ phase: 'idle' });
  const [editing, setEditing] = useState<Editing | null>(null);
  // Sortie demandée sur un brouillon : la suite à jouer si l'on abandonne
  // (retour, ou navigation vers une autre surface).
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const exec = await loadExecutionForEdit(executionId);
        if (!active) return;
        setLoad({ phase: 'ready', date: exec.date, exercises: toEditStates(exec), metrics: toMetricsState(exec) });
      } catch (err) {
        if (active) setLoad({ phase: 'error', message: errorMessage(err) });
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
      load.metrics !== null && buildExecutionMetricsOp(executionId, load.metrics.original, editedMetrics(load.metrics)) !== null;
    return setsDirty || metricsDirty;
  }, [load, executionId]);

  // Corrections non sauvées : aucun rechargement automatique tant qu'elles ne
  // vivent qu'en mémoire. Levé au démontage ; `releaseDraft` le lève tout de
  // suite à l'enregistrement réussi et à l'abandon (cf. pwa/useReloadBlockWhile).
  const releaseDraft = useReloadBlockWhile(PAST_SESSION_DRAFT_BLOCK, dirty);

  // Garde de sortie (cf. authoring/seance-dirty) : tant qu'un brouillon existe,
  // un mot de la navigation passe par la confirmation ci-dessous au lieu de
  // démonter l'écran et de perdre les corrections.
  useEffect(() => {
    if (!dirty) return;
    setLeaveGuard((proceed) => {
      setEditing(null);
      setDel({ phase: 'idle' });
      setPendingLeave(() => proceed);
    });
    return () => setLeaveGuard(null);
  }, [dirty]);

  /** Retour gardé : confirmation sur un brouillon, sortie directe sinon. */
  function requestClose() {
    if (dirty) setPendingLeave(() => onClose);
    else onClose();
  }

  function patchExercise(exerciseId: string, fn: (sets: EditableSet[]) => EditableSet[]) {
    setLoad((prev) => {
      if (prev.phase !== 'ready') return prev;
      return { ...prev, exercises: prev.exercises.map((ex) => (ex.exerciseId === exerciseId ? { ...ex, edited: fn(ex.edited) } : ex)) };
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
      const metricsOp = buildExecutionMetricsOp(executionId, load.metrics.original, editedMetrics(load.metrics));
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
        // Ops durables (déjà enfilées) mais pas en base : on garde l'éditeur
        // ouvert et on dit pourquoi. En attente (elles partiront au retour du
        // réseau) et refusées par la base ne se disent pas pareil.
        setSave({ phase: 'error', message: unsavedWritesLabel(result) });
        return;
      }
      releaseDraft();
      onSaved();
    } catch (err) {
      // Erreur inattendue (pas une simple coupure) : les ops restent durables et
      // remonteront au prochain flush ; on garde l'éditeur ouvert pour réessayer.
      setSave({ phase: 'error', message: errorMessage(err) });
    }
  }

  async function handleDelete() {
    setDel({ phase: 'deleting' });
    try {
      // Hard delete (ADR 0008) : une seule op `deleteExecution`, la cascade DB
      // efface séries et notes datées. L'op est DURABLE dès l'enqueue
      // (localStorage) et le flush GLOBAL de l'app (App.tsx, montage + 'online')
      // garantit sa remontée même si on ne repasse pas par la Capture. `flush`
      // ne REJETTE PAS sur une coupure : s'il reste l'op, on le dit (« partira au
      // retour du réseau ») plutôt que de laisser croire à une synchro immédiate.
      //
      // Si la Capture tient encore CETTE exécution en cours (séance du jour non
      // clôturée), on efface son état local comme le fait l'Annulation : il prime
      // à la réhydratation, et la série suivante recréerait l'exécution supprimée.
      clearPersistedExecution(executionId);
      // Les exos de la séance sont connus ici : l'op les porte pour que leurs
      // copies locales d'historique soient relues à l'acquittement.
      const exerciseIds = load.phase === 'ready' ? load.exercises.map((ex) => ex.exerciseId) : undefined;
      const result = await flushOps([{ type: 'deleteExecution', id: executionId, ...(exerciseIds ? { exerciseIds } : {}) }]);
      if (result.remaining > 0) {
        setDel({ phase: 'error', message: unsavedWritesLabel(result) });
        return;
      }
      releaseDraft();
      onDeleted();
    } catch (err) {
      // Erreur inattendue : l'op reste durable et remontera au prochain flush.
      setDel({ phase: 'error', message: errorMessage(err) });
    }
  }

  const year = new Date().getFullYear();
  const back = { label: 'Séance', onClick: requestClose };

  if (load.phase === 'loading') {
    return (
      <EditorFrame>
        <ScreenHeader title="Corriger la séance" back={{ label: 'Séance', onClick: onClose }} />
        <p role="status" className="px-5 py-6 text-[15px] text-muted">
          Chargement de la séance…
        </p>
      </EditorFrame>
    );
  }

  if (load.phase === 'error') {
    return (
      <EditorFrame>
        <ScreenHeader title="Corriger la séance" back={{ label: 'Séance', onClick: onClose }} />
        <Alert>Impossible de charger cette séance : {load.message}</Alert>
      </EditorFrame>
    );
  }

  // Ce que la suppression effacera, chiffré pour la confirmation (ADR 0008) : le
  // nombre d'exos et de SÉRIES LOGIQUES réelles en base (`original`, jamais
  // `edited`). Une série unilatérale = deux lignes mais UNE série (ADR 0005).
  const exerciseCount = load.exercises.length;
  const setCount = load.exercises.reduce((sum, ex) => sum + groupIntoLogicalSets(ex.original).length, 0);
  const metrics = load.metrics;

  return (
    <EditorFrame
      bottom={
        <>
          {save.phase === 'error' && (
            <p role="alert" className="break-words border-l-[3px] border-ink pl-3 text-[15px] leading-[1.45] text-ink">
              Corrections gardées sur l’appareil, pas encore en base : {save.message}
            </p>
          )}
          <PrimaryButton onClick={handleSave} disabled={save.phase === 'saving' || (!dirty && save.phase !== 'error')}>
            {save.phase === 'saving' ? 'Enregistrement…' : dirty ? 'Enregistrer les corrections' : 'Aucune correction'}
          </PrimaryButton>
        </>
      }
    >
      <ScreenHeader title="Corriger la séance" meta={formatDateLong(load.date, year)} back={back} />

      {/* Métriques de fin, seulement pour une séance CLÔTURÉE (cf. MetricsEditState). */}
      {metrics !== null && (
        <section aria-labelledby="corriger-mesures">
          <SectionTitle id="corriger-mesures">Durée et BPM</SectionTitle>
          <div className="border-t border-line">
            <MeasureRuler
              label="Durée"
              noun="la durée"
              none="non notée"
              unit="min"
              on={metrics.durationOn}
              value={metrics.durationMin}
              min={DURATION_MIN}
              max={DURATION_MAX}
              display={formatDuration}
              spoken={(v) => `${v} minutes`}
              onAdd={() => patchMetrics((m) => ({ ...m, durationOn: true }))}
              onRemove={() => patchMetrics((m) => ({ ...m, durationOn: false }))}
              onChange={(durationMin) => patchMetrics((m) => ({ ...m, durationMin }))}
            />
            <MeasureRuler
              label="BPM moyen"
              noun="le BPM moyen"
              none="non noté"
              unit="bpm"
              on={metrics.bpmOn}
              value={metrics.bpm}
              min={BPM_MIN}
              max={BPM_MAX}
              display={String}
              spoken={(v) => `${v} battements par minute`}
              onAdd={() => patchMetrics((m) => ({ ...m, bpmOn: true }))}
              onRemove={() => patchMetrics((m) => ({ ...m, bpmOn: false }))}
              onChange={(bpm) => patchMetrics((m) => ({ ...m, bpm }))}
            />
          </div>
        </section>
      )}

      {load.exercises.length === 0 && (
        <p className="px-5 pt-6 text-[15px] leading-[1.45] text-muted">Aucune série loggée ce jour. Rien à corriger.</p>
      )}

      {load.exercises.map((ex) => (
        <ExerciseSets
          key={ex.exerciseId}
          exercise={ex}
          onOpen={(e) => setEditing(e)}
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

      {/* Suppression de l'exécution entière (ADR 0008) : un lien, loin du flux
          d'édition ; la feuille de confirmation chiffre ce qui part. */}
      <div className="px-5 pt-8">
        <TextLink tone="muted" onClick={() => setDel({ phase: 'confirming' })}>
          Supprimer cette séance
        </TextLink>
      </div>

      {editing && (
        <SetSheet
          key={editing.set.id}
          editing={editing}
          onClose={() => setEditing(null)}
          onSave={(v) => {
            patchExercise(editing.exerciseId, (sets) => updateSet(sets, editing.set.id, v));
            setEditing(null);
          }}
          onRemove={() => {
            // Une série unilatérale supprimée part en entier (les deux côtés) :
            // jamais une série à un seul côté (ADR 0005).
            patchExercise(editing.exerciseId, (sets) => editing.logicalIds.reduce((acc, id) => removeSet(acc, id), sets));
            setEditing(null);
          }}
        />
      )}

      <Sheet
        open={del.phase !== 'idle'}
        title="Supprimer la séance ?"
        onClose={() => {
          if (del.phase !== 'deleting') setDel({ phase: 'idle' });
        }}
        footer={
          <>
            {del.phase === 'error' && (
              <p role="alert" className="break-words border-l-[3px] border-ink pl-3 text-[15px] leading-[1.45] text-ink">
                Suppression gardée sur l’appareil, pas encore en base : {del.message}
              </p>
            )}
            <TextLink tone="muted" className="self-start" onClick={() => void handleDelete()}>
              {del.phase === 'deleting'
                ? 'Suppression…'
                : setCount === 1
                  ? 'Supprimer la séance et sa série'
                  : `Supprimer la séance et ses ${setCount} séries`}
            </TextLink>
            <PrimaryButton onClick={() => setDel({ phase: 'idle' })} disabled={del.phase === 'deleting'}>
              Garder la séance
            </PrimaryButton>
          </>
        }
      >
        <p className="px-5 pb-2 text-[16px] leading-[1.5] text-ink">
          Séance du {formatDateLong(load.date, year)}, {exerciseCount} exo{exerciseCount > 1 ? 's' : ''} et {setCount} série
          {setCount > 1 ? 's' : ''}.
        </p>
        <p className="px-5 pb-2 text-[15px] leading-[1.5] text-muted">
          Elles quittent le journal, les courbes et les records. La suppression ne se défait pas.
        </p>
      </Sheet>

      <Sheet
        open={pendingLeave !== null}
        title="Abandonner les corrections ?"
        onClose={() => setPendingLeave(null)}
        footer={
          <>
            <TextLink
              tone="muted"
              className="self-start"
              onClick={() => {
                const leave = pendingLeave;
                setPendingLeave(null);
                releaseDraft();
                leave?.();
              }}
            >
              Abandonner les corrections
            </TextLink>
            <PrimaryButton onClick={() => setPendingLeave(null)}>Continuer à corriger</PrimaryButton>
          </>
        }
      >
        <p className="px-5 pb-2 text-[16px] leading-[1.5] text-ink">
          Tes corrections de cette séance ne sont pas enregistrées. En quittant, elles sont perdues.
        </p>
      </Sheet>
    </EditorFrame>
  );
}

/** L'écran de l'éditeur : contenu centré, barre d'action collée en bas. */
function EditorFrame({ children, bottom }: { children: React.ReactNode; bottom?: React.ReactNode }) {
  return (
    <Screen bottom={bottom ? <div className="mx-auto flex w-full max-w-2xl flex-col gap-2">{bottom}</div> : undefined}>
      <div className="mx-auto w-full max-w-2xl pb-6">{children}</div>
    </Screen>
  );
}

function Alert({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="mx-5 mt-2 break-words border-l-[3px] border-ink pl-3 text-[15px] leading-[1.45] text-ink">
      {children}
    </p>
  );
}

/**
 * Une mesure optionnelle de la séance (durée, BPM), à la règle comme en fin de
 * séance. Non notée : une ligne et « + ». Notée : la valeur, la règle, et
 * « Retirer » (une durée déjà enregistrée s'efface ainsi).
 */
function MeasureRuler({
  label,
  noun,
  none,
  unit,
  on,
  value,
  min,
  max,
  display,
  spoken,
  onAdd,
  onRemove,
  onChange,
}: {
  label: string;
  /** « la durée », « le BPM moyen » : pour « Ajouter … », « Retirer … ». */
  noun: string;
  /** « non notée », « non noté ». */
  none: string;
  unit: string;
  on: boolean;
  value: number;
  min: number;
  max: number;
  display: (v: number) => string;
  spoken: (v: number) => string;
  onAdd: () => void;
  onRemove: () => void;
  onChange: (v: number) => void;
}) {
  if (!on) {
    return (
      <div className="flex min-h-14 items-center gap-3 border-b border-line px-5 py-2">
        <span className="min-w-0 flex-1">
          <span className="block text-[17px] font-medium text-ink">{label}</span>
          <span className="mt-0.5 block text-[14px] text-muted">{none}</span>
        </span>
        <IconButton icon="plus" framed label={`Ajouter ${noun}`} onClick={onAdd} />
      </div>
    );
  }
  return (
    <div className="border-b border-line pb-1 pt-3">
      <p className="flex items-baseline justify-between gap-3 px-5">
        <span className="text-[17px] font-medium text-ink">{label}</span>
        <span className="tnum text-[22px] font-medium text-ink" aria-hidden>
          {display(value)}
          {unit === 'bpm' && <span className="ml-1 text-[15px] font-normal text-muted">bpm</span>}
        </span>
      </p>
      <div className="mt-2">
        <Ruler
          label={label}
          // Une valeur hors bornes (durée 0 enregistrée) se lit telle quelle ;
          // la règle se cale sur la borne la plus proche.
          steps={Math.min(max - min, Math.max(0, value - min))}
          max={max - min}
          pxPerStep={8}
          isMajor={(s) => (s + min) % 10 === 0}
          isMid={(s) => (s + min) % 5 === 0}
          majorLabel={(s) => String(s + min)}
          format={(s) => spoken(s + min)}
          onChange={(s) => onChange(s + min)}
        />
      </div>
      <div className="flex justify-end px-5">
        <TextLink tone="muted" onClick={onRemove}>
          Retirer {noun}
        </TextLink>
      </div>
    </div>
  );
}

// --- Les séries d'un exo -----------------------------------------------------
//
// On édite par SÉRIE LOGIQUE (ADR 0005) : une série bilatérale tient sur une
// ligne, une série unilatérale sur deux (gauche, droite), sous le même rang.
// Conséquences pour ne jamais corrompre le côté faible : `side` n'est jamais
// touché par l'édition de valeurs (`updateSet` ne change que poids, reps, RIR) ;
// supprimer une série unilatérale retire LES DEUX côtés ; ajouter rajoute la
// paire complète. Le regroupement vient de `groupIntoLogicalSets` (module pur).

function ExerciseSets({
  exercise,
  onOpen,
  onAddSet,
}: {
  exercise: ExerciseEditState;
  onOpen: (e: Editing) => void;
  onAddSet: () => void;
}) {
  const logicalSets = groupIntoLogicalSets(exercise.edited);
  const original = new Map(exercise.original.map((s) => [s.id, s]));
  /** « corrigée », « ajoutée », ou rien : ce que l'enregistrement changera. */
  const change = (s: EditableSet): string | null => {
    const o = original.get(s.id);
    if (!o) return 'ajoutée';
    return o.weightKg !== s.weightKg || o.reps !== s.reps || o.rir !== s.rir ? 'corrigée' : null;
  };
  const removed = exercise.original.filter((o) => !exercise.edited.some((s) => s.id === o.id)).length;

  return (
    <section aria-label={exercise.name}>
      <SectionTitle aside={removed > 0 ? `${removed} ligne${removed > 1 ? 's' : ''} retirée${removed > 1 ? 's' : ''}` : undefined}>
        {exercise.name}
      </SectionTitle>
      <ul aria-label={`Séries de ${exercise.name}`} className="border-t border-line">
        {logicalSets.map((logical, index) => (
          <LogicalSetRows
            key={logical.both?.id ?? `${logical.left?.id ?? 'l'}-${logical.right?.id ?? 'r'}`}
            logical={logical}
            rank={index + 1}
            change={change}
            onOpen={(set) =>
              onOpen({
                exerciseId: exercise.exerciseId,
                exerciseName: exercise.name,
                rank: index + 1,
                set,
                logicalIds: [logical.both, logical.left, logical.right].filter((s): s is EditableSet => s !== null).map((s) => s.id),
                added: !original.has(set.id),
              })
            }
          />
        ))}
        <li className="border-b border-line">
          <button type="button" onClick={onAddSet} className="flex min-h-14 w-full items-center gap-3 px-5 text-left text-[16px] text-ink active:opacity-70">
            <Icon name="plus" />
            Ajouter une série
          </button>
        </li>
      </ul>
    </section>
  );
}

function LogicalSetRows({
  logical,
  rank,
  change,
  onOpen,
}: {
  logical: LogicalSet;
  rank: number;
  change: (s: EditableSet) => string | null;
  onOpen: (set: EditableSet) => void;
}) {
  const lines = logical.both !== null ? [logical.both] : [logical.left, logical.right].filter((s): s is EditableSet => s !== null);
  return (
    <>
      {lines.map((set) => {
        const side = set.side ? sideWord(set.side) : null;
        const tag = change(set);
        const meta = [side, tag].filter(Boolean).join(' · ');
        return (
          <li key={set.id} className="border-b border-line px-5">
            <button
              type="button"
              onClick={() => onOpen(set)}
              aria-label={`Série ${rank}${side ? ` ${side}` : ''}, ${values(set)}. Corriger`}
              className="flex min-h-14 w-full items-start gap-3 py-3 text-left active:opacity-70"
            >
              <span className="tnum w-6 flex-none pt-px text-[15px] text-faint">{rank}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[17px] font-medium leading-[1.3] text-ink">{values(set)}</span>
                {meta && <span className="mt-0.5 block text-[14px] text-muted">{meta}</span>}
              </span>
              <span className="flex-none self-center text-faint" aria-hidden>
                <Icon name="edit" size={20} />
              </span>
            </button>
          </li>
        );
      })}
    </>
  );
}

/**
 * La feuille d'une série : les contrôles de la Salle (lecture du poids, règle,
 * reps et RIR en un tap). « Valider » reporte la valeur dans le brouillon ;
 * rien n'est écrit avant « Enregistrer les corrections ». La suppression se
 * confirme (l'option sûre est le bouton) et emporte la série logique entière.
 */
function SetSheet({
  editing,
  onClose,
  onSave,
  onRemove,
}: {
  editing: Editing;
  onClose: () => void;
  onSave: (v: Pick<EditableSet, 'weightKg' | 'reps' | 'rir'>) => void;
  onRemove: () => void;
}) {
  const { stepKg } = useReglages();
  const orig = editing.set;
  const [v, setV] = useState({ weightKg: orig.weightKg, reps: orig.reps, rir: orig.rir });
  const [ask, setAsk] = useState(false);
  const side = orig.side ? sideWord(orig.side) : null;
  const what = `Série ${editing.rank}${side ? `, ${side}` : ''}`;
  const both = editing.logicalIds.length > 1;
  const changed = v.weightKg !== orig.weightKg || v.reps !== orig.reps || v.rir !== orig.rir;
  const majorEvery = Math.max(1, Math.round(5 / stepKg));
  const midEvery = majorEvery % 2 === 0 ? majorEvery / 2 : 0;

  return (
    <Sheet
      open
      title={ask ? `Supprimer la série ${editing.rank} ?` : `${what} · ${editing.exerciseName}`}
      onClose={onClose}
      footer={
        ask ? undefined : (
          <PrimaryButton
            meta={values(v)}
            ariaLabel={`Valider la série ${editing.rank}${side ? ` ${side}` : ''}, ${values(v)}`}
            onClick={() => (changed ? onSave(v) : onClose())}
          >
            Valider
          </PrimaryButton>
        )
      }
    >
      {ask ? (
        <div className="px-5 pb-2 pt-1">
          <p className="max-w-[36ch] text-[16px] leading-[1.45] text-ink">
            {both
              ? `La série ${editing.rank} sera retirée, gauche et droite.`
              : `La série ${editing.rank} (${values(orig)}) sera retirée.`}{' '}
            Rien ne part avant « Enregistrer les corrections ».
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
            <SecondaryButton onClick={() => setAsk(false)}>Garder la série</SecondaryButton>
            <TextLink tone="muted" ariaLabel={`Confirmer la suppression de la série ${editing.rank}`} onClick={onRemove}>
              Supprimer la série
            </TextLink>
          </div>
        </div>
      ) : (
        <div className="pb-1">
          <p className="flex items-baseline justify-between gap-3 px-5 text-[14px]">
            <span className="text-muted">{editing.added ? 'ajoutée, avant réglage' : 'loggée'}</span>
            <span className="tnum font-medium text-ink">{values(orig)}</span>
          </p>
          <WeightReadout value={v.weightKg} onChange={(kg) => setV((p) => ({ ...p, weightKg: roundWeightKg(kg) }))} />
          <div className="mt-1">
            <Ruler
              key={stepKg}
              label="Poids de la série"
              steps={v.weightKg / stepKg}
              max={Math.max(Math.round(RULER_MAX_KG / stepKg), Math.ceil(v.weightKg / stepKg))}
              pxPerStep={Math.max(8, 11.2 * stepKg)}
              isMajor={(s) => s % majorEvery === 0}
              isMid={(s) => midEvery > 0 && s % midEvery === 0}
              majorLabel={(s) => formatWeight(s * stepKg)}
              format={(s) => `${formatWeight(roundWeightKg(s * stepKg))} kg`}
              onChange={(s) => setV((p) => ({ ...p, weightKg: roundWeightKg(s * stepKg) }))}
            />
          </div>
          <div className="mt-3 flex flex-col gap-0.5">
            <NumberRow
              label="Reps"
              min={1}
              max={Math.max(REPS_ROW_MAX, v.reps, orig.reps)}
              value={v.reps}
              presc={[orig.reps, orig.reps]}
              rangeWord={editing.added ? 'avant' : 'loggé'}
              refValue={null}
              onPick={(n) => setV((p) => ({ ...p, reps: n }))}
            />
            <NumberRow
              label="RIR"
              min={0}
              max={Math.max(RIR_ROW_MAX, v.rir, orig.rir)}
              value={v.rir}
              presc={[orig.rir, orig.rir]}
              rangeWord={editing.added ? 'avant' : 'loggé'}
              refValue={null}
              onPick={(n) => setV((p) => ({ ...p, rir: n }))}
            />
          </div>
          <div className="px-5 pt-1">
            <TextLink tone="muted" ariaLabel={`Supprimer la série ${editing.rank}`} onClick={() => setAsk(true)}>
              Supprimer la série
            </TextLink>
          </div>
        </div>
      )}
    </Sheet>
  );
}

// --- Helpers (pas de logique métier ici : tout le diff vit dans le module pur) ---

/**
 * État d'édition des métriques depuis l'exécution chargée, ou `null` si la séance
 * n'est PAS clôturée (on n'édite alors pas durée/BPM, cf. MetricsEditState). Durée
 * et BPM « saisis » ssi une valeur est en base ; sinon repliés (« Ajouter… »).
 */
function toMetricsState(exec: EditableExecution): MetricsEditState | null {
  if (exec.closedAt === null) return null;
  return {
    original: { bpmAvg: exec.bpmAvg, durationMin: exec.durationMin },
    durationOn: exec.durationMin !== null,
    durationMin: exec.durationMin ?? DURATION_DEFAULT,
    bpmOn: exec.bpmAvg !== null,
    bpm: exec.bpmAvg ?? BPM_DEFAULT,
  };
}

/** Les métriques éditées sous la forme attendue par `buildExecutionMetricsOp` (repliée = retirée). */
function editedMetrics(m: MetricsEditState): {
  bpmAvg: number | null;
  durationMin: number | null;
} {
  return {
    bpmAvg: m.bpmOn ? m.bpm : null,
    durationMin: m.durationOn ? m.durationMin : null,
  };
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
