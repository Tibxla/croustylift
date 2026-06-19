// Stepper +/− au pouce (DESIGN.md). La valeur s'ajuste par paliers ;
// un palier fin optionnel pour le réglage précis.
// Taper sur la valeur ouvre le pavé numérique de l'OS (inputmode="decimal" ou
// "numeric") — jamais le clavier texte alpha.
import { useCallback, useRef, useState } from 'react';

import { parseAndClamp } from './stepper-utils';

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
  // draft : valeur brute en cours de saisie (null = mode affichage)
  const [draft, setDraft] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const clamp = useCallback(
    (n: number) => Math.min(max, Math.max(min, Math.round(n * 1000) / 1000)),
    [min, max],
  );

  const bump = useCallback(
    (delta: number) => onChange(clamp(value + delta)),
    [clamp, onChange, value],
  );

  // Décimales permises si step < 1 (ex. 0.5 kg) ou si step a une partie décimale
  const allowsDecimal = step % 1 !== 0 || (fineStep != null && fineStep % 1 !== 0);

  function handleReadoutClick() {
    // Affiche la valeur avec point décimal (l'utilisateur peut taper directement)
    setDraft(format(value).replace(',', '.'));
    // Focus déclenché après le prochain rendu
    requestAnimationFrame(() => inputRef.current?.select());
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    setDraft(e.target.value);
  }

  function commitDraft(raw: string) {
    const next = parseAndClamp(raw, step, min, max, value);
    onChange(next);
    setDraft(null);
  }

  function handleBlur(e: React.FocusEvent<HTMLInputElement>) {
    commitDraft(e.target.value);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitDraft(e.currentTarget.value);
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      setDraft(null);
    }
  }

  const atMin = value <= min;
  const atMax = value >= max;

  const btn =
    'flex items-center justify-center rounded-xl bg-surface-2 text-ink ' +
    'transition active:scale-95 active:bg-[color-mix(in_oklch,var(--color-surface-2),white_8%)] ' +
    'disabled:opacity-35 disabled:active:scale-100';

  // Classe commune readout : tap-target ≥44px garanti par h-14 (56px)
  const readoutBase =
    'readout flex flex-1 items-center justify-center rounded-xl bg-bg/40 ' +
    'text-2xl font-medium tabular-nums';

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

        {draft !== null ? (
          // Mode saisie : input pavé numérique, même apparence que l'output
          <input
            ref={inputRef}
            type="text"
            inputMode={allowsDecimal ? 'decimal' : 'numeric'}
            value={draft}
            onChange={handleInputChange}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            // autoFocus géré via requestAnimationFrame (plus fiable sur iOS)
            className={`${readoutBase} h-14 w-full min-w-0 cursor-text text-center`}
            aria-label={`${label} : saisie directe`}
          />
        ) : (
          // Mode affichage : tap → bascule en mode saisie
          <button
            type="button"
            className={`${readoutBase} h-14 cursor-pointer`}
            onClick={handleReadoutClick}
            aria-label={`${label} : ${format(value)}${unit ? ' ' + unit : ''}. Appuyer pour saisir`}
          >
            <span className="flex items-baseline gap-1">
              <span>{format(value)}</span>
              {unit && <span className="text-sm text-ink-muted">{unit}</span>}
            </span>
          </button>
        )}

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
