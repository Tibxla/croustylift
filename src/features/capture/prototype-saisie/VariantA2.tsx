// PROTOTYPE JETABLE · tour 2 · Variante A2 « Reps et RIR côte à côte ».
//
// Le haut de A1 (tout ce qui se lit). En bas, le poids et sa règle restent le
// centre, plus grands ; Reps et RIR deviennent deux réglages compacts côte à
// côte sur UNE rangée, − valeur +, séparés par un filet vertical. Le bas perd
// une rangée entière de chiffres : la hauteur rendue va au poids et à l'air.
// Sous la valeur, la Référence en petit (« réf. 8 ») tant qu'il y en a une ;
// la fourchette du plan est déjà écrite en haut.
// Boutons de 52 px, aucune animation (geste répété), valeur à largeur fixe pour
// que les boutons ne bougent pas sous le pouce.
import type { VariantProps } from './ProtoSaisie';
import { Air, HautA } from './VariantA1';
import { ProtoWeight, WeightRuler } from './parts';

const BTN = 'flex h-[52px] w-[52px] flex-none items-center justify-center rounded-block border border-muted text-[26px] leading-none text-ink active:bg-line disabled:border-line disabled:text-dim';

function Mini({
  label,
  value,
  onChange,
  min,
  max,
  refValue,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  refValue: number | null;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center">
      <span className="text-[15px] font-semibold text-ink">{label}</span>
      <div className="mt-1.5 flex items-center gap-1.5">
        <button type="button" aria-label={`${label} : moins`} disabled={value <= min} onClick={() => onChange(value - 1)} className={BTN}>
          −
        </button>
        <output aria-live="polite" aria-label={label} className="tnum w-11 text-center text-[32px] font-semibold leading-none tracking-[-0.02em] text-ink">
          {value}
        </output>
        <button type="button" aria-label={`${label} : plus`} disabled={value >= max} onClick={() => onChange(value + 1)} className={BTN}>
          +
        </button>
      </div>
      <span className="mt-1 h-[18px] text-[13px] text-faint">{refValue !== null ? `réf. ${refValue}` : ''}</span>
    </div>
  );
}

export function VariantA2(p: VariantProps) {
  const { s, tight, compact } = p;
  return (
    <div className="flex flex-1 flex-col pt-1">
      <HautA {...p} />
      <Air min={tight ? 8 : 14} max={9999} />
      <div data-zone="bas" className={`flex flex-col bg-raise ${tight || s.unilateral ? 'pt-2' : 'pt-4'} pb-2`}>
        <ProtoWeight value={s.weightKg} onChange={s.setWeight} size={tight ? 56 : compact ? (s.unilateral ? 56 : 72) : 80} unit="block" />
        <div className={tight ? 'mt-1' : 'mt-2'}>
          <WeightRuler weightKg={s.weightKg} onChange={s.setWeight} stepKg={s.stepKg} height={tight ? 44 : compact ? 52 : 60} compact={compact} />
        </div>
        <div className={`flex items-stretch border-t border-line px-3 ${tight ? 'pt-2' : 'pt-3'}`}>
          <Mini label="Reps" value={s.reps} onChange={s.setReps} min={1} max={999} refValue={s.refToBeat?.reps ?? null} />
          <div aria-hidden className="w-px flex-none bg-line" />
          <Mini label="RIR" value={s.rir} onChange={s.setRir} min={0} max={99} refValue={s.refToBeat?.rir ?? null} />
        </div>
      </div>
      <Air min={tight ? 4 : 8} max={12} />
    </div>
  );
}
