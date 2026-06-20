// Le LOG BRUT consultable, en JOURNAL DE SÉANCES enrichi (cf. issues #27/#32,
// DESIGN.md). Chaque séance s'ouvre sur un EN-TÊTE DE RÉCAP — nom, date, durée,
// BPM moyen (si saisi), nombre de séries, kg soulevés (Σ poids×reps) — qui se lit
// replié d'un coup d'œil ; dépliée, l'entrée montre le détail des séries telles
// qu'elles ont été loggées (poids × reps × RIR), sans aucune dérivation. Sur un
// exo unilatéral (ADR 0005), chaque côté est sur sa propre ligne, libellé G/D.
//
// Readout Rule : tout chiffre mesuré (poids, reps, RIR, dates, durée, BPM,
// kg soulevés) en mono tabulaire, aligné pour se lire comme un cadran. Sobre, sans
// accent (le log est une consultation, pas un signal de progression : l'accent
// reste aux courbes). Pas de récap trompeur : une métrique manquante (durée, BPM,
// nom hors-template) n'est tout simplement pas affichée. Composant pur : il prend
// des `RawLogEntry[]` et se monte sans réseau.
import { useState } from 'react';
import type { RawLogEntry } from './raw-log';
import { summarizeSession, type SessionSummary } from './session-summary';

/** 'YYYY-MM-DD' → 'mer. 8 janv. 2026' (date longue lisible, locale fr). */
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

/** Minutes → 'NN min' sous l'heure, 'N h NN' au-delà (durée de séance lisible). */
function formatDuration(min: number): string {
  if (min < 60) return `${min} min`;
  const hours = Math.floor(min / 60);
  const rest = min % 60;
  return `${hours} h ${String(rest).padStart(2, '0')}`;
}

/** kg soulevés (Σ poids×reps), séparateurs de milliers fr ('1 840', espace insécable). */
function formatLifted(kg: number): string {
  return kg.toLocaleString('fr-FR');
}

/** Libellé de côté d'une série unilatérale (ADR 0005), sobre : 'G'/'D' (rien en bilatéral). */
function sideLabel(side: 'left' | 'right' | undefined): string | null {
  if (side === 'left') return 'G';
  if (side === 'right') return 'D';
  return null;
}

export function RawLogView({
  entries,
  onEdit,
}: {
  entries: RawLogEntry[];
  /**
   * Ouvre une séance passée en édition (issue #38), par id d'exécution. Optionnel :
   * le harness de screenshot et la consultation pure montent la vue sans édition.
   */
  onEdit?: (executionId: string) => void;
}) {
  if (entries.length === 0) {
    return <RawLogEmptyState />;
  }

  return (
    <ul className="flex flex-col gap-3">
      {entries.map((entry, index) => (
        <li key={entry.executionId}>
          {/* La plus récente (en tête) est dépliée par défaut : on consulte
              d'abord ce qu'on vient de faire ; le reste reste replié. */}
          <SessionEntry entry={entry} defaultOpen={index === 0} onEdit={onEdit} />
        </li>
      ))}
    </ul>
  );
}

function SessionEntry({
  entry,
  defaultOpen,
  onEdit,
}: {
  entry: RawLogEntry;
  defaultOpen: boolean;
  onEdit?: (executionId: string) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const summary = summarizeSession(entry);

  return (
    <section className="surface-card rounded-2xl">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-start gap-3 p-4 text-left transition active:scale-[0.99]"
      >
        <div className="min-w-0 flex-1">
          <SessionHeader summary={summary} />
        </div>
        <svg
          viewBox="0 0 20 20"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={`mt-1 shrink-0 text-ink-muted transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        >
          <path d="M5 8l5 5 5-5" />
        </svg>
      </button>

      {open && (
        <div className="flex flex-col gap-3 px-4 pb-4">
          {entry.exercises.map((exercise) => (
            <div key={exercise.exerciseId}>
              <p className="text-sm font-medium leading-tight text-ink">
                {exercise.name}
              </p>

              <ul className="mt-1.5 flex flex-col gap-0.5">
                {exercise.sets.map((set) => (
                  // Clé COMPOSITE : en unilatéral (ADR 0005) deux lignes partagent
                  // le même order ; le côté les distingue (sinon clé dupliquée).
                  <li
                    key={`${set.order}-${set.side ?? 'both'}`}
                    className="readout flex items-baseline gap-2 text-sm tabular-nums text-ink"
                  >
                    <span className="flex min-w-[1.25rem] shrink-0 items-baseline gap-1 text-xs text-ink-muted">
                      {set.order}
                      {sideLabel(set.side) && (
                        <span className="font-medium text-ink">
                          {sideLabel(set.side)}
                        </span>
                      )}
                    </span>
                    <span className="font-medium">
                      {set.weightKg}
                      <span className="ml-0.5 text-xs font-normal text-ink-muted">
                        kg
                      </span>
                    </span>
                    <span className="text-ink-muted">×</span>
                    <span className="font-medium">
                      {set.reps}
                      <span className="ml-0.5 text-xs font-normal text-ink-muted">
                        reps
                      </span>
                    </span>
                    <span className="ml-auto text-ink-muted">
                      RIR <span className="text-ink">{set.rir}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {/* Corriger cette séance (issue #38) : ouvre l'éditeur des séries de ce
              jour. Action discrète, sobre (pas l'accent : la correction n'est pas
              un signal de progression). Affichée seulement si l'éditeur est câblé. */}
          {onEdit && (
            <button
              type="button"
              onClick={() => onEdit(entry.executionId)}
              className="btn btn-secondary mt-1 min-h-[44px] self-start rounded-xl px-4 text-sm font-medium"
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
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
              </svg>
              Corriger cette séance
            </button>
          )}
        </div>
      )}
    </section>
  );
}

// L'en-tête de récap : nom de séance (ou date seule si hors-template) en titre,
// puis une ligne de readouts. Une métrique absente (durée, BPM, nom) n'apparaît
// pas du tout — jamais de zéro ni de tiret pour combler (pas de récap trompeur).
function SessionHeader({ summary }: { summary: SessionSummary }) {
  const dateLabel = formatDateLong(summary.date);

  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h3 className="text-sm font-semibold leading-tight text-ink">
          {summary.sessionName ?? dateLabel}
        </h3>
        {summary.sessionName && (
          <span className="readout text-xs tabular-nums text-ink-muted">
            {dateLabel}
          </span>
        )}
      </div>

      <dl className="readout mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums text-ink-muted">
        <SummaryMetric
          label="séries"
          value={String(summary.setCount)}
        />
        <SummaryMetric
          label="kg soulevés"
          value={formatLifted(summary.totalVolumeKg)}
        />
        {summary.durationMin !== null && (
          <SummaryMetric label="durée" value={formatDuration(summary.durationMin)} />
        )}
        {summary.bpmAvg !== null && (
          <SummaryMetric
            label="BPM"
            value={
              <>
                {summary.bpmAvg}
                <span className="ml-0.5 font-normal text-ink-muted">moy</span>
              </>
            }
          />
        )}
      </dl>
    </>
  );
}

function SummaryMetric({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-1">
      <dt className="font-sans text-ink-muted">{label}</dt>
      <dd className="font-medium text-ink">{value}</dd>
    </div>
  );
}

function RawLogEmptyState() {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 px-8 text-center">
      <p className="text-sm text-ink-muted">
        Pas encore de séries loggées. Le détail de tes séances apparaîtra ici.
      </p>
    </div>
  );
}
