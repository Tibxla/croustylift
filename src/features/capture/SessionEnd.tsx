// Flux de fin de séance. La DURÉE est AUTO-CHRONOMÉTRÉE (lancement -> clôture,
// cf. state.startedAt / CaptureScreen) : elle s'affiche en readout lecture seule,
// jamais saisie. Le BPM moyen reste, lui, une saisie MANUELLE et OPTIONNELLE
// (cf. décisions produit révisées). Un récap sobre encadre la saisie, puis un
// écran de confirmation clôt la séance.
//
// L'« optionnel » du BPM est matérialisé : non saisi = ligne repliée avec un
// bouton « + Ajouter… » ; on l'ouvre pour révéler un Stepper (DESIGN.md, jamais
// d'<input> ni de clavier OS), on le retire pour revenir à « non saisi ». Le
// bouton « Clôturer sans noter » clôt sans BPM. Le primaire (accent violet, la
// seule tache de couleur de l'écran) enregistre puis bascule en confirmation.
import { useState } from 'react';
import { Stepper } from './Stepper';
import { MetricRow } from './MetricRow';
import { orderMusclesCanonical } from '../authoring/exercise-input';

/** Ce que la fin de séance remonte au parent pour persistance (champ omis = non saisi). */
export interface SessionEndValues {
  bpmAvg?: number | null;
}

/** Récap sobre de l'exécution close : exos faits / total + décompte des séries. */
export interface SessionSummary {
  sessionName: string;
  exercisesDone: number;
  exercisesTotal: number;
  /**
   * Total des séries selon la règle de décompte pondérée par reps (issue #60,
   * affine #37) : chaque série compte `min(reps,5)/5` ; une série unilatérale
   * somme ses deux côtés. Valeur FRACTIONNAIRE (affichée à une décimale).
   */
  totalSets: number;
  /**
   * Décompte RÉEL des séries par muscle principal (issue #60), dérivé des séries
   * loggées et pondéré par reps (côté faible pour l'unilatéral), appliqué à chaque
   * muscle principal de l'exo. Valeurs FRACTIONNAIRES. Vide si aucune série loggée
   * (ou aucun muscle renseigné sur les exos faits).
   */
  setsByMuscle: Record<string, number>;
}

interface SessionEndProps {
  summary: SessionSummary;
  /**
   * Durée chronométrée de la séance (min), calculée du lancement à la clôture.
   * `null` = cas dégénéré (lancement non horodaté) : on n'affiche aucune durée.
   */
  durationMin: number | null;
  /** Enregistre les métriques (peut échouer côté réseau ; le parent gère le retry). */
  onSave: (values: SessionEndValues) => Promise<void> | void;
  /** Retour à la capture (la séance n'est pas close). */
  onBack: () => void;
  /** Repart sur une séance fraîche, depuis l'écran de confirmation de clôture. */
  onNewSession: () => void;
}

const BPM_DEFAULT = 130;
const BPM_STEP = 5;
const BPM_FINE = 1;

function intFormat(value: number): string {
  return String(Math.round(value));
}

/**
 * Format d'un décompte de séries FRACTIONNAIRE (issue #60, pondération par reps) :
 * une décimale, virgule décimale FR (jamais de point, jamais de tiret long, cf.
 * DESIGN.md). Ex. « 1,8 ».
 */
function fmtCount(value: number): string {
  return value.toFixed(1).replace('.', ',');
}

export function SessionEnd({
  summary,
  durationMin,
  onSave,
  onBack,
  onNewSession,
}: SessionEndProps) {
  // BPM : activé (saisi) ? + sa valeur. Replié par défaut = « non saisi ».
  const [bpmOn, setBpmOn] = useState(false);
  const [bpm, setBpm] = useState(BPM_DEFAULT);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Phase de confirmation : on fige les valeurs réellement enregistrées.
  const [saved, setSaved] = useState<SessionEndValues | null>(null);

  async function commit(values: SessionEndValues) {
    setSaving(true);
    setError(null);
    try {
      await onSave(values);
      setSaved(values);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  // Champ omis (undefined) = colonne inchangée côté DB ; on n'envoie que le saisi.
  const handleSaveAndClose = () => void commit({ bpmAvg: bpmOn ? bpm : undefined });

  const handleSkip = () => void commit({});

  // Une fois enregistré : confirmation « Séance terminée » dans la foulée (récap
  // immédiat, état local — la clôture est transitoire, ADR 0009, elle ne survit
  // pas à un remontage).
  if (saved) {
    return (
      <SessionDone
        summary={summary}
        durationMin={durationMin}
        values={saved}
        onNewSession={onNewSession}
      />
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col px-4 pb-32 pt-3">
      {/* Retour à la capture */}
      <button
        type="button"
        onClick={onBack}
        className="btn btn-ghost -ml-1 mb-2 self-start rounded-lg py-2 pr-3 text-sm font-medium"
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
        Retour à la capture
      </button>

      <h2 className="text-3xl font-semibold leading-tight tracking-[-0.025em] text-ink">
        Fin de séance
      </h2>
      <p className="mt-1.5 text-[15px] text-ink-muted">{summary.sessionName}</p>

      <SummaryCard summary={summary} durationMin={durationMin} />
      <MuscleBreakdown setsByMuscle={summary.setsByMuscle} />

      <p className="mt-7 text-sm text-ink-muted">
        Note ton BPM moyen si tu veux, c&apos;est optionnel.
      </p>

      <div className="mt-3 flex flex-col gap-3">
        <MetricRow
          title="BPM moyen"
          addLabel="Ajouter le BPM moyen"
          hint="Fréquence cardiaque moyenne de la séance."
          on={bpmOn}
          onAdd={() => setBpmOn(true)}
          onRemove={() => setBpmOn(false)}
        >
          <Stepper
            label="BPM moyen"
            unit="bpm"
            value={bpm}
            step={BPM_STEP}
            fineStep={BPM_FINE}
            min={30}
            max={240}
            format={intFormat}
            onChange={setBpm}
          />
        </MetricRow>
      </div>

      {error && (
        <p className="mt-4 break-words text-xs text-warn" role="alert">
          Échec de l&apos;enregistrement : {error}
        </p>
      )}

      {/* Actions fixes en bas (zone du pouce). Primaire = accent violet. */}
      <div className="fixed inset-x-0 bottom-[var(--nav-offset)] z-10 border-t border-hair bg-bg/95 px-4 pb-[calc(env(safe-area-inset-bottom,0)+0.75rem)] pt-3 backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-md flex-col gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={handleSaveAndClose}
            className="btn btn-primary h-14 w-full rounded-2xl text-lg"
          >
            {saving ? 'Enregistrement…' : 'Enregistrer et clôturer'}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={handleSkip}
            className="btn btn-ghost h-11 rounded-xl px-4 text-sm font-medium"
          >
            Clôturer sans noter
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Carte de récap : exos faits / total + total de séries + durée auto (chiffres
 * en mono). La durée est un readout lecture seule, jamais saisie ; absente si
 * non chronométrée.
 */
function SummaryCard({
  summary,
  durationMin,
}: {
  summary: SessionSummary;
  durationMin: number | null;
}) {
  return (
    <div className="mt-4 grid grid-cols-2 gap-2.5">
      <div className="surface-card rounded-2xl px-4 py-3.5">
        <p className="text-xs font-medium text-ink-muted">Exercices faits</p>
        <p className="readout mt-1 text-2xl font-medium tabular-nums text-ink">
          {summary.exercisesDone}
          <span className="text-base text-ink-muted">/{summary.exercisesTotal}</span>
        </p>
      </div>
      <div className="surface-card rounded-2xl px-4 py-3.5">
        <p className="text-xs font-medium text-ink-muted">Séries loggées</p>
        <p className="readout mt-1 text-2xl font-medium tabular-nums text-ink">
          {fmtCount(summary.totalSets)}
        </p>
      </div>
      {durationMin != null && (
        <div className="surface-card rounded-2xl px-4 py-3.5">
          <p className="text-xs font-medium text-ink-muted">Durée</p>
          <p className="readout mt-1 text-2xl font-medium tabular-nums text-ink">
            {durationMin}
            <span className="text-base text-ink-muted"> min</span>
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Décompte RÉEL des séries par muscle principal (issue #60), affiché en fin de
 * séance sous le récap. Dérivé des séries loggées et pondéré par reps (cf.
 * buildSummary). On ne parle PAS de « volume » (terme proscrit, CONTEXT.md) :
 * « séries par muscle ».
 *
 * DESIGN.md : chiffres en mono tabulaire (.readout) alignés en colonne, un muscle
 * par ligne, ordre canonique stable, décompte fractionnaire à une décimale
 * (virgule FR). Rendu seulement s'il y a au moins un muscle (sinon le récap suffit).
 */
function MuscleBreakdown({ setsByMuscle }: { setsByMuscle: Record<string, number> }) {
  const muscles = orderMusclesCanonical(Object.keys(setsByMuscle));
  if (muscles.length === 0) return null;

  // Barre proportionnelle au max (le muscle dominant fait 100 % + un léger glow).
  const max = Math.max(...muscles.map((m) => setsByMuscle[m] ?? 0), 1);

  return (
    <section
      className="panel mt-2.5 rounded-2xl px-4 py-4"
      aria-label="Séries par muscle"
    >
      <p className="readout text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
        Séries par muscle
      </p>
      <ul className="mt-3 flex flex-col gap-3">
        {muscles.map((muscle) => {
          const value = setsByMuscle[muscle] ?? 0;
          const pct = Math.round((value / max) * 100);
          const dominant = value === max;
          return (
            <li key={muscle}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-sm text-ink">{muscle}</span>
                <span className="readout shrink-0 text-[13px] tabular-nums text-ink">
                  {fmtCount(value)}
                </span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-2">
                <div
                  className={`h-full rounded-full bg-accent ${
                    dominant ? 'shadow-[0_0_10px_var(--color-accent-soft)]' : ''
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// --- Confirmation -----------------------------------------------------------

/* `MetricRow` est désormais une primitive partagée (`./MetricRow`), réutilisée
   par l'édition d'une séance passée (PastSessionEditor). */

/** Écran de confirmation : séance close, récap + durée auto + BPM saisi (si présent). */
function SessionDone({
  summary,
  durationMin,
  values,
  onNewSession,
}: {
  summary: SessionSummary;
  durationMin: number | null;
  values: SessionEndValues;
  onNewSession: () => void;
}) {
  const hasBpm = typeof values.bpmAvg === 'number';

  return (
    <div className="mx-auto flex min-h-[calc(100vh-3.5rem)] w-full max-w-md flex-col px-4 pb-12 pt-10">
      <div className="flex flex-col items-center text-center">
        <span
          className="flex h-14 w-14 items-center justify-center rounded-full border text-good"
          style={{
            background: 'color-mix(in oklab, var(--color-good), transparent 84%)',
            borderColor: 'color-mix(in oklab, var(--color-good), transparent 55%)',
          }}
          aria-hidden="true"
        >
          <svg
            viewBox="0 0 24 24"
            width="28"
            height="28"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 12l5 5L20 6" />
          </svg>
        </span>
        <h2 className="mt-4 text-3xl font-semibold tracking-[-0.025em] text-ink">Séance terminée</h2>
        <p className="mt-1.5 text-[15px] text-ink-muted">{summary.sessionName}</p>
      </div>

      <SummaryCard summary={summary} durationMin={durationMin} />
      <MuscleBreakdown setsByMuscle={summary.setsByMuscle} />

      {hasBpm && (
        <div className="mt-2.5">
          <div className="surface-card rounded-2xl px-4 py-3.5">
            <p className="text-xs font-medium text-ink-muted">BPM moyen</p>
            <p className="readout mt-1 text-2xl font-medium tabular-nums text-ink">
              {values.bpmAvg}
              <span className="text-base text-ink-muted"> bpm</span>
            </p>
          </div>
        </div>
      )}

      <p className="mt-6 text-center text-sm text-ink-muted">
        C&apos;est noté. Tu peux ranger le téléphone.
      </p>

      <button
        type="button"
        onClick={onNewSession}
        className="btn btn-primary mt-8 h-12 w-full rounded-2xl text-base"
      >
        Nouvelle séance
      </button>
    </div>
  );
}
