// Kit E · contrôles sans clavier : interrupteur, stepper de formulaire, choix en
// sélecteur à segments. L'interrupteur et le stepper sont des lignes de groupe
// arrondi (`GROUP_ROW`) : posés dans un `GROUP`, ils en prennent les filets.
import type { ReactNode } from 'react';
import { GROUP_ROW } from './layout';

/** Interrupteur, une ligne. Activé = case blanc cassé pleine + mot « Oui »
 *  (jamais le signal). */
export function Switch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`${GROUP_ROW} flex min-h-14 w-full items-center gap-4 px-4 py-3 text-left active:bg-line`}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[17px] font-medium text-ink">{label}</span>
      </span>
      <span aria-hidden className="w-8 text-right text-[14px] text-muted">
        {checked ? 'Oui' : 'Non'}
      </span>
      <span aria-hidden className={`relative h-7 w-12 flex-none rounded-block border ${checked ? 'border-ink bg-ink' : 'border-muted'}`}>
        <span
          className={`absolute left-[3px] top-[3px] h-5 w-5 rounded-[9px] transition-transform duration-150 ease-out ${
            checked ? 'translate-x-5 bg-bg' : 'bg-muted'
          }`}
        />
      </span>
    </button>
  );
}

/** Stepper pour les formulaires hors salle (prescription, réglages) : − valeur +,
 *  carrés de 44 px, aucune saisie clavier. Sans `meta`, il tient sur une ligne :
 *  libellé à gauche, stepper à droite, valeur jamais coupée (« Pas de la règle »
 *  tient sur une ligne dans un groupe, à 375 px). */
export function Stepper({
  label,
  value,
  onChange,
  min = 0,
  max = 999,
  step = 1,
  format = String,
  meta,
  below,
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
  /** Ligne entière sous le libellé et les boutons (un choix « Fixe · Fourchette »,
   *  trop large pour la colonne du libellé à côté des boutons). */
  below?: ReactNode;
  /** Largeur fixe de la valeur (px) quand elle varie (« 1 kg », « 1,25 kg ») :
   *  les boutons ne bougent pas sous le pouce d'un tap à l'autre. */
  valueWidth?: number;
}) {
  const set = (v: number) => onChange(Math.min(max, Math.max(min, Math.round(v * 1000) / 1000)));
  const btn =
    'flex h-11 w-11 flex-none items-center justify-center rounded-block border border-muted text-[22px] text-ink active:bg-line disabled:border-line disabled:text-dim';
  return (
    // Sous 350 px, le libellé prend sa ligne et les boutons passent dessous, à
    // droite : à côté d'eux, il ne lui restait que 70 px (« Pas de / la / règle »).
    <div className={`${GROUP_ROW} flex min-h-16 items-center gap-1.5 px-4 py-2 ${below ? 'flex-wrap gap-y-1' : ''} max-[349px]:flex-wrap max-[349px]:gap-y-2`}>
      <span className="mr-1.5 min-w-0 flex-1 max-[349px]:mr-0 max-[349px]:basis-full">
        <span className="block text-[17px] font-medium text-ink">{label}</span>
        {meta && <span className="mt-0.5 block text-[14px] text-muted">{meta}</span>}
      </span>
      <button type="button" className={`${btn} max-[349px]:ml-auto`} aria-label={`${label} : moins`} disabled={value <= min} onClick={() => set(value - step)}>
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
      {below && <div className="basis-full pb-1">{below}</div>}
    </div>
  );
}

/** Choix exclusif en sélecteur à segments : un bloc levé de 12 px de rayon, le
 *  choisi en pastille (aplat de filet, demi-gras), les autres en gris. Chaque
 *  segment garde 44 px de haut. `wrap={false}` : une seule ligne, à poser dans
 *  un conteneur qui défile (filtres par muscle). */
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
    <div
      role="radiogroup"
      aria-label={label}
      className={`flex w-fit gap-0.5 rounded-block bg-surface p-[3px] ${wrap ? 'max-w-full flex-wrap' : 'flex-nowrap whitespace-nowrap'} ${className}`}
    >
      {options.map((o) => {
        const sel = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={sel}
            onClick={() => onChange(o.value)}
            className={`h-11 flex-none rounded-[9px] px-2.5 text-[16px] ${sel ? 'bg-line font-semibold text-ink' : 'text-muted active:text-ink'}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
