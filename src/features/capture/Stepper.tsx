// Stepper +/− au pouce (DESIGN.md). La valeur s'ajuste par paliers ;
// un palier fin optionnel pour le réglage précis.
// Taper sur la valeur ouvre le pavé numérique de l'OS (inputmode="decimal" ou
// "numeric") — jamais le clavier texte alpha.
import { useCallback, useState } from 'react';

import { parseTypedValue } from './stepper-utils';

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
  // draft : valeur brute en cours de saisie (null = mode affichage).
  // L'<input> est TOUJOURS monté (cf. plus bas) : le passage en saisie se fait au
  // focus de l'input réel, donc dans le geste de tap de l'utilisateur — c'est ce
  // qui ouvre le pavé numérique au 1ᵉʳ tap (issue #58). Un focus programmatique
  // sur un input fraîchement inséré ne lèverait pas le clavier sur mobile.
  const [draft, setDraft] = useState<string | null>(null);

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

  // Au focus (= tap direct sur l'input réel) : on entre en saisie en amorçant le
  // draft avec la valeur courante (point décimal). Le clavier numérique est déjà
  // levé par le focus lui-même (geste de confiance), d'où l'ouverture au 1ᵉʳ tap.
  // On SÉLECTIONNE tout APRÈS le re-render (rAF) pour que la sélection porte sur
  // la valeur du draft, pas sur l'ancien affichage : le 1ᵉʳ chiffre tapé remplace.
  function handleFocus(e: React.FocusEvent<HTMLInputElement>) {
    if (draft === null) setDraft(format(value).replace(',', '.'));
    const el = e.currentTarget;
    requestAnimationFrame(() => el.select());
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    setDraft(e.target.value);
  }

  function commitDraft(raw: string) {
    // Saisie TAPÉE : précision préservée, jamais snappée au pas du +/− (issue
    // #58). `allowsDecimal` distingue le poids (décimales libres) des reps/RIR
    // (entiers). Seul le clamp [min, max] s'applique.
    const next = parseTypedValue(raw, min, max, value, allowsDecimal);
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
      e.currentTarget.blur();
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

        {/* L'<input> est TOUJOURS monté : le tap dessus est un geste de confiance
            qui ouvre le pavé numérique au 1ᵉʳ tap (issue #58). Au repos, il
            affiche la valeur formatée (virgule FR) ; au focus, on bascule en
            saisie (draft brut, point décimal) et on sélectionne tout. L'unité
            reste portée par le label du haut, jamais par la couleur seule. */}
        <input
          type="text"
          inputMode={allowsDecimal ? 'decimal' : 'numeric'}
          value={draft ?? format(value)}
          onFocus={handleFocus}
          onChange={handleInputChange}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          className={`${readoutBase} h-14 w-full min-w-0 cursor-text text-center`}
          aria-label={`${label}${unit ? ` en ${unit}` : ''} : ${format(value)}. Appuyer pour saisir`}
        />

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
