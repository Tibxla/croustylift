// Stepper « cluster instrument » de l'écran roi (Capture · log). Boutons ronds au
// pouce + gros readout central, encastrés dans la carte-instrument. Conserve la
// saisie tapée (issue #58) : l'<input> est TOUJOURS monté, donc taper la valeur
// lève le pavé numérique de l'OS au 1ᵉʳ tap (pas le clavier alpha). Distinct du
// `Stepper` rectangulaire générique (éditeurs, formulaires), qui reste inchangé.
import { useCallback, useState } from 'react';

import { parseTypedValue } from './stepper-utils';

interface ClusterStepperProps {
  /** Libellé (« POIDS », « REPS », « RIR »), aussi utilisé pour l'aria-label. */
  label: string;
  value: number;
  /** Pas principal (poids 2,5 kg ; reps/RIR 1). */
  step: number;
  /** Pas fin optionnel (poids 1,25 kg), rendu en seconde rangée discrète. */
  fineStep?: number;
  min?: number;
  max?: number;
  /** Unité affichée après la valeur (« kg »), variante hero seulement. */
  unit?: string;
  /** Formate la valeur (défaut : virgule FR). */
  format?: (value: number) => string;
  /** hero = poids (gros), compact = reps/rir (colonne). */
  variant: 'hero' | 'compact';
  onChange: (next: number) => void;
}

function defaultFormat(value: number): string {
  return (Math.round(value * 100) / 100).toString().replace('.', ',');
}

const MINUS = 'M5 12h14';
const PLUS = 'M12 5v14M5 12h14';

function RoundButton({
  path,
  title,
  hero,
  accent,
  disabled,
  ariaLabel,
  onClick,
}: {
  path: string;
  title: string;
  hero: boolean;
  accent?: boolean;
  disabled?: boolean;
  ariaLabel: string;
  onClick: () => void;
}) {
  const size = hero ? 'h-[54px] w-[54px]' : 'h-10 w-10';
  const skin = accent
    ? 'border-accent bg-accent-soft text-accent-ink'
    : 'border-hair-strong bg-surface-2 text-ink';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={`flex shrink-0 items-center justify-center rounded-full border shadow-[inset_0_1px_0_var(--spec)] transition active:scale-95 disabled:opacity-35 ${size} ${skin}`}
    >
      <svg
        viewBox="0 0 24 24"
        width={hero ? 24 : 20}
        height={hero ? 24 : 20}
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
    </button>
  );
}

export function ClusterStepper({
  label,
  value,
  step,
  fineStep,
  min = -Infinity,
  max = Infinity,
  unit,
  format = defaultFormat,
  variant,
  onChange,
}: ClusterStepperProps) {
  const hero = variant === 'hero';
  // draft : valeur brute en cours de saisie (null = affichage). L'<input> reste
  // monté ; le focus (tap direct) lève le pavé numérique au 1ᵉʳ tap (issue #58).
  const [draft, setDraft] = useState<string | null>(null);

  const clamp = useCallback(
    (n: number) => Math.min(max, Math.max(min, Math.round(n * 1000) / 1000)),
    [min, max],
  );
  const bump = useCallback(
    (delta: number) => onChange(clamp(value + delta)),
    [clamp, onChange, value],
  );

  const allowsDecimal = step % 1 !== 0 || (fineStep != null && fineStep % 1 !== 0);

  function handleFocus(e: React.FocusEvent<HTMLInputElement>) {
    if (draft === null) setDraft(format(value).replace(',', '.'));
    const el = e.currentTarget;
    requestAnimationFrame(() => el.select());
  }
  function commitDraft(raw: string) {
    onChange(parseTypedValue(raw, min, max, value, allowsDecimal));
    setDraft(null);
  }
  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitDraft(e.currentTarget.value);
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      setDraft(null);
      e.currentTarget.blur();
    }
  }

  const atMin = value <= min;
  const atMax = value >= max;
  const shown = draft ?? format(value);
  // Largeur en `ch` (mono tabulaire) : le readout se centre entre les boutons et
  // l'unité reste collée au nombre, sans champ « boîte ».
  const readoutWidth = `${Math.max(shown.length, 1)}ch`;

  const input = (
    <input
      type="text"
      inputMode={allowsDecimal ? 'decimal' : 'numeric'}
      value={shown}
      onFocus={handleFocus}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => commitDraft(e.target.value)}
      onKeyDown={handleKeyDown}
      style={{ width: readoutWidth }}
      className={`readout cursor-text bg-transparent text-center font-medium text-ink caret-accent outline-none ${
        hero ? 'text-[62px] leading-none tracking-[-0.03em]' : 'text-[30px] leading-none'
      }`}
      aria-label={`${label}${unit ? ` en ${unit}` : ''} : ${format(value)}. Appuyer pour saisir`}
    />
  );

  return (
    <div className={hero ? '' : 'flex-1 text-center'}>
      <div
        className={`readout text-[10px] font-semibold uppercase tracking-[0.15em] text-ink-faint ${
          hero ? 'text-center' : 'mb-2'
        }`}
      >
        {label}
      </div>

      <div className={`flex items-center justify-between ${hero ? 'mt-2' : ''}`}>
        <RoundButton
          path={MINUS}
          title="Moins"
          hero={hero}
          disabled={atMin}
          ariaLabel={`${label} : retirer ${defaultFormat(step)}`}
          onClick={() => bump(-step)}
        />

        {hero ? (
          <div className="flex flex-1 items-baseline justify-center gap-1.5">
            {input}
            {unit && <span className="text-xl font-medium text-ink-muted">{unit}</span>}
          </div>
        ) : (
          input
        )}

        <RoundButton
          path={PLUS}
          title="Plus"
          hero={hero}
          accent
          disabled={atMax}
          ariaLabel={`${label} : ajouter ${defaultFormat(step)}`}
          onClick={() => bump(step)}
        />
      </div>

      {/* Pas fin (poids) : rangée discrète, fonctionnalité conservée (issue #58). */}
      {fineStep != null && (
        <div className="mt-3 flex items-center justify-center gap-2">
          <button
            type="button"
            className="btn btn-secondary h-9 flex-1 rounded-xl text-sm font-medium"
            onClick={() => bump(-fineStep)}
            disabled={atMin}
            aria-label={`${label} : retirer ${defaultFormat(fineStep)}`}
          >
            − {defaultFormat(fineStep)}
          </button>
          <button
            type="button"
            className="btn btn-secondary h-9 flex-1 rounded-xl text-sm font-medium"
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
