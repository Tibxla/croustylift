// Kit E · contrôles sans clavier : interrupteur, stepper de formulaire, choix en mots.
import type { ReactNode } from 'react';

/** Interrupteur, une ligne. Activé = case blanc cassé pleine + mot « Oui »
 *  (jamais le signal). */
export function Switch({
  label,
  meta,
  checked,
  onChange,
}: {
  label: string;
  meta?: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex min-h-14 w-full items-center gap-4 border-b border-line px-5 py-3 text-left"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[17px] font-medium text-ink">{label}</span>
        {meta && <span className="mt-0.5 block text-[14px] text-muted">{meta}</span>}
      </span>
      <span aria-hidden className="w-8 text-right text-[14px] text-muted">
        {checked ? 'Oui' : 'Non'}
      </span>
      <span aria-hidden className={`relative h-7 w-12 flex-none rounded-block border ${checked ? 'border-ink bg-ink' : 'border-muted'}`}>
        <span
          className={`absolute left-[3px] top-[3px] h-5 w-5 rounded-[3px] transition-transform duration-150 ease-out ${
            checked ? 'translate-x-5 bg-bg' : 'bg-muted'
          }`}
        />
      </span>
    </button>
  );
}

/** Stepper pour les formulaires hors salle (prescription, réglages) : − valeur +,
 *  carrés de 48 px, aucune saisie clavier. Sans `meta`, il tient sur une ligne :
 *  libellé à gauche, stepper à droite, valeur jamais coupée. */
export function Stepper({
  label,
  value,
  onChange,
  min = 0,
  max = 999,
  step = 1,
  format = String,
  meta,
  valueWidth,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  format?: (v: number) => string;
  meta?: ReactNode;
  /** Largeur fixe de la valeur (px) quand elle varie (« 1 kg », « 1,25 kg ») :
   *  les boutons ne bougent pas sous le pouce d'un tap à l'autre. */
  valueWidth?: number;
}) {
  const set = (v: number) => onChange(Math.min(max, Math.max(min, Math.round(v * 1000) / 1000)));
  const btn =
    'flex h-12 w-12 flex-none items-center justify-center rounded-block border border-muted text-[22px] text-ink active:bg-line disabled:border-line disabled:text-dim';
  return (
    <div className="flex min-h-16 items-center gap-3 border-b border-line px-5 py-2">
      <span className="min-w-0 flex-1">
        <span className="block text-[17px] font-medium text-ink">{label}</span>
        {meta && <span className="mt-0.5 block text-[14px] text-muted">{meta}</span>}
      </span>
      <button type="button" className={btn} aria-label={`${label} : moins`} disabled={value <= min} onClick={() => set(value - step)}>
        −
      </button>
      <output
        aria-live="polite"
        aria-label={label}
        className="tnum min-w-14 whitespace-nowrap text-center text-[22px] font-medium text-ink"
        style={valueWidth ? { width: valueWidth } : undefined}
      >
        {format(value)}
      </output>
      <button type="button" className={btn} aria-label={`${label} : plus`} disabled={value >= max} onClick={() => set(value + step)}>
        +
      </button>
    </div>
  );
}

/** Choix exclusif en mots soulignés (pas de pilules) : « 1,25 kg · 2,5 kg ». */
export function Choice<T extends string | number>({
  label,
  options,
  value,
  onChange,
  wrap = true,
  className = '',
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  /** false : une seule ligne (à placer dans un conteneur qui défile). */
  wrap?: boolean;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={`flex gap-x-1 ${wrap ? 'flex-wrap' : 'flex-nowrap whitespace-nowrap'} ${className}`}>
      {options.map((o) => {
        const sel = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={sel}
            onClick={() => onChange(o.value)}
            className={`h-11 flex-none px-2.5 text-[16px] ${
              sel ? 'font-semibold text-ink underline decoration-2 underline-offset-[7px]' : 'text-muted active:text-ink'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
