// Stepper +/− au pouce (DESIGN.md) — JAMAIS d'<input> ni de clavier OS.
// La valeur s'ajuste par paliers ; un palier fin optionnel pour le réglage précis.
import { useCallback } from 'react';

interface StepperProps {
  /** Libellé du champ (ex. « Poids »), aussi utilisé pour l'aria-label des boutons. */
  label: string;
  value: number;
  /** Pas principal (ex. 2,5 kg pour le poids, 1 pour reps/RIR). */
  step: number;
  /** Pas fin optionnel (ex. 1,25 kg). Rendu en seconde rangée si fourni. */
  fineStep?: number;
  min?: number;
  max?: number;
  /** Unité affichée après la valeur (ex. « kg »). */
  unit?: string;
  /** Formate la valeur pour l'affichage (défaut : nombre brut, virgule FR). */
  format?: (value: number) => string;
  onChange: (next: number) => void;
}

function defaultFormat(value: number): string {
  return (Math.round(value * 100) / 100).toString().replace('.', ',');
}

const MINUS =
  'M5 12h14'; // trait horizontal
const PLUS =
  'M12 5v14M5 12h14'; // croix

function Icon({ path, title }: { path: string; title: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      aria-hidden="true"
      role="img"
    >
      <title>{title}</title>
      <path d={path} />
    </svg>
  );
}

export function Stepper({
  label,
  value,
  step,
  fineStep,
  min = -Infinity,
  max = Infinity,
  unit,
  format = defaultFormat,
  onChange,
}: StepperProps) {
  const clamp = useCallback(
    (n: number) => Math.min(max, Math.max(min, Math.round(n * 1000) / 1000)),
    [min, max],
  );

  const bump = useCallback(
    (delta: number) => onChange(clamp(value + delta)),
    [clamp, onChange, value],
  );

  const atMin = value <= min;
  const atMax = value >= max;

  const btn =
    'flex items-center justify-center rounded-xl bg-surface-2 text-ink ' +
    'transition active:scale-95 active:bg-[color-mix(in_oklch,var(--color-surface-2),white_8%)] ' +
    'disabled:opacity-35 disabled:active:scale-100';

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between px-0.5">
        <span className="text-sm font-medium text-ink-muted">{label}</span>
        {unit && <span className="text-xs text-ink-muted">{unit}</span>}
      </div>

      <div className="flex items-stretch gap-2">
        <button
          type="button"
          className={`${btn} h-14 w-14 shrink-0`}
          onClick={() => bump(-step)}
          disabled={atMin}
          aria-label={`${label} : retirer ${defaultFormat(step)}`}
        >
          <Icon path={MINUS} title="Moins" />
        </button>

        <output
          className="readout flex flex-1 items-baseline justify-center gap-1 rounded-xl bg-bg/40 text-2xl font-medium tabular-nums"
          aria-live="off"
        >
          <span>{format(value)}</span>
          {unit && <span className="text-sm text-ink-muted">{unit}</span>}
        </output>

        <button
          type="button"
          className={`${btn} h-14 w-14 shrink-0`}
          onClick={() => bump(step)}
          disabled={atMax}
          aria-label={`${label} : ajouter ${defaultFormat(step)}`}
        >
          <Icon path={PLUS} title="Plus" />
        </button>
      </div>

      {fineStep != null && (
        <div className="flex items-center justify-center gap-2">
          <button
            type="button"
            className={`${btn} h-9 flex-1 text-sm font-medium`}
            onClick={() => bump(-fineStep)}
            disabled={atMin}
            aria-label={`${label} : retirer ${defaultFormat(fineStep)}`}
          >
            − {defaultFormat(fineStep)}
          </button>
          <button
            type="button"
            className={`${btn} h-9 flex-1 text-sm font-medium`}
            onClick={() => bump(fineStep)}
            disabled={atMax}
            aria-label={`${label} : ajouter ${defaultFormat(fineStep)}`}
          >
            + {defaultFormat(fineStep)}
          </button>
        </div>
      )}
    </div>
  );
}
