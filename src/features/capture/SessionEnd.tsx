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

/** Ce que la fin de séance remonte au parent pour persistance (champ omis = non saisi). */
export interface SessionEndValues {
  bpmAvg?: number | null;
}

/** Récap sobre de l'exécution close : exos faits / total + total des séries. */
export interface SessionSummary {
  sessionName: string;
  exercisesDone: number;
  exercisesTotal: number;
  totalSets: number;
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
}

const BPM_DEFAULT = 130;
const BPM_STEP = 5;
const BPM_FINE = 1;

function intFormat(value: number): string {
  return String(Math.round(value));
}

export function SessionEnd({ summary, durationMin, onSave, onBack }: SessionEndProps) {
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

  if (saved) {
    return <SessionDone summary={summary} durationMin={durationMin} values={saved} />;
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col px-4 pb-32 pt-3">
      {/* Retour à la capture */}
      <button
        type="button"
        onClick={onBack}
        className="-ml-1 mb-2 inline-flex items-center gap-1.5 self-start rounded-lg py-2 pr-3 text-sm font-medium text-ink-muted transition active:text-ink"
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

      <h2 className="text-3xl font-bold leading-tight tracking-tight text-ink">
        Fin de séance
      </h2>
      <p className="mt-1.5 text-sm text-ink-muted">{summary.sessionName}</p>

      <SummaryCard summary={summary} durationMin={durationMin} />

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
        <p className="readout mt-4 break-words text-xs text-warn" role="alert">
          Échec de l&apos;enregistrement : {error}
        </p>
      )}

      {/* Actions fixes en bas (zone du pouce). Primaire = accent violet. */}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-bg/95 px-4 pb-[calc(env(safe-area-inset-bottom,0)+0.75rem)] pt-3 backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-md flex-col gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={handleSaveAndClose}
            className="flex h-14 w-full items-center justify-center rounded-2xl bg-accent-strong text-lg font-semibold text-on-accent shadow-lg shadow-accent/20 transition active:scale-[0.98] active:bg-accent disabled:opacity-50 disabled:active:scale-100"
          >
            {saving ? 'Enregistrement…' : 'Enregistrer et clôturer'}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={handleSkip}
            className="inline-flex h-11 items-center justify-center rounded-xl px-4 text-sm font-medium text-ink-muted transition active:text-ink disabled:opacity-50"
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
      <div className="rounded-2xl bg-surface px-4 py-3.5">
        <p className="text-xs font-medium text-ink-muted">Exercices faits</p>
        <p className="readout mt-1 text-2xl font-medium tabular-nums text-ink">
          {summary.exercisesDone}
          <span className="text-base text-ink-muted">/{summary.exercisesTotal}</span>
        </p>
      </div>
      <div className="rounded-2xl bg-surface px-4 py-3.5">
        <p className="text-xs font-medium text-ink-muted">Séries loggées</p>
        <p className="readout mt-1 text-2xl font-medium tabular-nums text-ink">
          {summary.totalSets}
        </p>
      </div>
      {durationMin != null && (
        <div className="rounded-2xl bg-surface px-4 py-3.5">
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

/** Une métrique optionnelle : repliée (« + Ajouter… ») ou ouverte (Stepper + retrait). */
function MetricRow({
  title,
  addLabel,
  hint,
  on,
  onAdd,
  onRemove,
  children,
}: {
  title: string;
  /** Libellé de l'action « ajouter » (grammaire FR explicite, pas de bricolage le/la). */
  addLabel: string;
  hint: string;
  on: boolean;
  onAdd: () => void;
  onRemove: () => void;
  children: React.ReactNode;
}) {
  if (!on) {
    return (
      <button
        type="button"
        onClick={onAdd}
        className="flex min-h-[3.25rem] w-full items-center gap-3 rounded-2xl bg-surface px-4 py-3 text-left transition active:scale-[0.99] active:bg-surface-2"
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
        <span className="min-w-0 flex-1">
          <span className="block text-base font-semibold text-ink">{addLabel}</span>
          <span className="mt-0.5 block text-xs text-ink-muted">{hint}</span>
        </span>
      </button>
    );
  }

  return (
    <div className="rounded-2xl bg-surface px-4 py-3.5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-base font-semibold text-ink">{title}</span>
        <button
          type="button"
          onClick={onRemove}
          className="inline-flex h-9 items-center rounded-lg px-2.5 text-xs font-medium text-ink-muted transition active:text-ink"
        >
          Retirer
        </button>
      </div>
      {children}
    </div>
  );
}

// --- Confirmation -----------------------------------------------------------

/** Écran de confirmation : séance close, récap + durée auto + BPM saisi (si présent). */
function SessionDone({
  summary,
  durationMin,
  values,
}: {
  summary: SessionSummary;
  durationMin: number | null;
  values: SessionEndValues;
}) {
  const hasBpm = typeof values.bpmAvg === 'number';

  return (
    <div className="mx-auto flex min-h-[calc(100vh-3.5rem)] w-full max-w-md flex-col px-4 pb-12 pt-10">
      <div className="flex flex-col items-center text-center">
        <span
          className="flex h-12 w-12 items-center justify-center rounded-full bg-surface text-good"
          aria-hidden="true"
        >
          <svg
            viewBox="0 0 24 24"
            width="26"
            height="26"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 12l5 5L20 6" />
          </svg>
        </span>
        <h2 className="mt-4 text-3xl font-bold tracking-tight text-ink">Séance terminée</h2>
        <p className="mt-1.5 text-sm text-ink-muted">{summary.sessionName}</p>
      </div>

      <SummaryCard summary={summary} durationMin={durationMin} />

      {hasBpm && (
        <div className="mt-2.5">
          <div className="rounded-2xl bg-surface px-4 py-3.5">
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
    </div>
  );
}
