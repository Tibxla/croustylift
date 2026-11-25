// PROTOTYPE JETABLE · Variante C « Étapes ».
//
// Idée : une chose à la fois. Trois étapes visibles en tête, Poids · Reps · RIR,
// chacune avec sa valeur : c'est à la fois le fil (où j'en suis) et le résumé de
// ce que Logger écrira. Dessous, la SEULE commande de l'étape en cours, en
// grand : la règle pour le poids, une grille de chiffres de 56 px pour les reps
// puis le RIR (un toucher choisit et passe à l'étape suivante). Les valeurs sont
// déjà amorcées : Logger marche à toute étape, sans passer par les trois ; on
// ne touche que ce qui change. Nouvelle série : retour au poids.
//
// « kg » : SOUS le nombre, en petit. Le nombre reste centré pile sur l'aiguille
// et le bloc nombre + unité est centré lui aussi.
import { useEffect, useState } from 'react';
import { IconButton, Sign } from '../../../ui';
import { formatRange, formatWeight } from '../format';
import { badgeStatus } from '../set-badges';
import type { VariantProps } from './ProtoSaisie';
import { ProtoWeight, SideChoice, setText, WeightRuler } from './parts';

type Step = 'kg' | 'reps' | 'rir';

/** Grille de chiffres : la fourchette du plan en blanc cassé, le reste en gris,
 *  le choisi en case pleine, la Référence d'un petit carré. Aucune animation. */
function Grid({
  values,
  value,
  presc,
  refValue,
  onPick,
  cols,
  cellH,
  label,
}: {
  values: number[];
  value: number;
  presc: [number, number];
  refValue: number | null;
  onPick: (n: number) => void;
  cols: number;
  cellH: number;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid gap-1.5 px-5" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {values.map((n) => {
        const sel = n === value;
        const inPlan = n >= presc[0] && n <= presc[1];
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={sel}
            onClick={() => onPick(n)}
            className={`tnum relative flex items-center justify-center rounded-block text-[24px] tracking-[-0.01em] ${
              sel ? 'bg-ink font-semibold text-bg' : `border border-line active:bg-line ${inPlan ? 'text-ink' : 'text-faint'}`
            }`}
            style={{ height: cellH }}
          >
            {n}
            {refValue === n && <span aria-hidden className={`absolute left-1/2 top-1.5 h-[5px] w-[5px] -translate-x-1/2 ${sel ? 'bg-on-ink' : 'bg-muted'}`} />}
          </button>
        );
      })}
    </div>
  );
}

/** Une fenêtre de `count` valeurs qui contient la fourchette du plan et la valeur. */
function windowOf(min: number, presc: [number, number], value: number, count: number): number[] {
  let start = Math.max(min, presc[0] - 2);
  if (value < start) start = Math.max(min, value - 1);
  if (value > start + count - 1) start = value - count + 2;
  return Array.from({ length: count }, (_, i) => start + i);
}

export function VariantC({ s, exercise, progress, exoPos, compact, tight, onEdit, onNotes, hasNote }: VariantProps) {
  const { prescription } = exercise;
  const [step, setStep] = useState<Step>('kg');
  useEffect(() => setStep('kg'), [s.draftKey]);
  const cellH = tight ? 48 : 56;

  const steps: { key: Step; n: number; title: string; value: string; unit?: string }[] = [
    { key: 'kg', n: 1, title: 'Poids', value: formatWeight(s.weightKg), unit: 'kg' },
    { key: 'reps', n: 2, title: 'Reps', value: `${s.reps}` },
    { key: 'rir', n: 3, title: 'RIR', value: `${s.rir}` },
  ];

  return (
    <div className="flex flex-1 flex-col pt-2">
      <header className="relative px-5">
        <p className="text-[14px] text-muted">
          Exo {exoPos.n} sur {exoPos.total} · <span className="font-semibold text-ink">série {s.rank} sur {Math.max(prescription.sets.max, s.rank)}</span>
        </p>
        <h2 className={`mt-0.5 truncate pr-10 font-[650] leading-[1.1] tracking-[-0.03em] text-ink ${tight ? 'text-[22px]' : compact ? 'text-[26px]' : 'text-[30px]'}`}>{exercise.name}</h2>
        <div className="absolute right-2.5 top-0">
          <IconButton icon="note" tone="muted" dot={hasNote} label={`Notes de ${exercise.name}`} onClick={onNotes} />
        </div>
      </header>

      {/* L'air libre est ici : le contexte de la série rejoint ses étapes, près du pouce. */}
      <div aria-hidden style={{ flex: '1 0 0px', minHeight: 0 }} />
      {/* Ce qu'il faut battre, en une ligne entre deux filets. */}
      <div className={`mx-5 flex items-baseline justify-between gap-3 border-y border-line ${tight ? 'py-2' : 'py-2.5'}`}>
        <span className="text-[14px] text-muted">À battre</span>
        <span className="tnum truncate text-[15px] font-medium text-ink">
          {s.refToBeat ? setText(s.refToBeat) : s.hasReference ? 'rien à cette série' : 'pas encore de réf.'}
        </span>
      </div>
      {/* Les séries faites, chacune se touche pour sa correction. */}
      <div className="mx-5 flex h-11 items-center gap-3 overflow-x-auto border-b border-line" style={{ scrollbarWidth: 'none' }} aria-label="Séries faites">
        <span className="flex-none text-[14px] text-muted">Faites</span>
        {progress.sets.length === 0 && <span className="text-[14px] text-faint">aucune</span>}
        {progress.sets.map((set, i) => {
          const id = progress.setIds[i];
          const st = badgeStatus(s.badges[i] ?? null);
          return (
            <button
              key={id ?? i}
              type="button"
              disabled={!id}
              onClick={() => id && onEdit(id)}
              aria-label={`Corriger la série ${set.order}, ${setText(set)}${st ? `, ${st.word}` : ''}`}
              className="flex h-11 flex-none items-center gap-1 whitespace-nowrap text-[14px] active:opacity-70"
            >
              <span className="tnum font-medium text-ink underline decoration-dim decoration-1 underline-offset-[5px]">
                {formatWeight(set.weightKg)} × {set.reps}
                {set.side === 'left' ? ' G' : set.side === 'right' ? ' D' : ''}
              </span>
              {st && (
                <span className={`inline-flex items-center gap-1 ${st.v === 'up' ? 'text-sig' : 'text-ink'}`}>
                  <Sign v={st.v} size={10} /> <span className="text-[13px]">{st.short}</span>
                </span>
              )}
            </button>
          );
        })}
      </div>
      {s.unilateral && s.side && (
        <div className="flex items-center justify-between px-5">
          <span className="text-[14px] text-muted">Côté</span>
          <SideChoice side={s.side} done={s.doneSides} onChoose={s.chooseSide} className="-mr-2.5" />
        </div>
      )}

      <div aria-hidden style={{ flex: '0 0 0px', minHeight: tight ? 6 : 10 }} />

      {/* Les trois étapes : le fil et le résumé de la série. */}
      <div role="tablist" aria-label="Étapes de la série" className="grid grid-cols-3 px-5">
        {steps.map((st) => {
          const on = st.key === step;
          return (
            <button
              key={st.key}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setStep(st.key)}
              className={`relative flex h-[60px] flex-col items-start justify-center border-b ${on ? 'border-ink' : 'border-line'} pr-2 text-left`}
            >
              <span className={`text-[13px] ${on ? 'font-semibold text-ink' : 'text-muted'}`}>
                {st.n} · {st.title}
              </span>
              <span className={`tnum mt-0.5 text-[22px] font-semibold leading-none tracking-[-0.01em] ${on ? 'text-ink' : 'text-muted'}`}>
                {st.value}
                {st.unit && <span className="ml-1 text-[13px] font-normal text-faint">{st.unit}</span>}
              </span>
              {on && <span aria-hidden className="absolute inset-x-0 bottom-0 h-[3px] bg-ink" />}
            </button>
          );
        })}
      </div>

      <div aria-hidden style={{ flex: '1 0 0px', minHeight: tight ? 8 : 12, maxHeight: 20 }} />

      {/* La commande de l'étape en cours, seule. */}
      <section aria-label={steps.find((x) => x.key === step)?.title} className="flex flex-col">
        {step === 'kg' && (
          <>
            <ProtoWeight value={s.weightKg} onChange={s.setWeight} size={tight ? 52 : compact ? 64 : 76} unit="below" />
            <div className="mt-2">
              <WeightRuler weightKg={s.weightKg} onChange={s.setWeight} stepKg={s.stepKg} height={tight ? 44 : 56} compact={tight} />
            </div>
            <div className="flex items-center justify-between px-5">
              <span className="text-[14px] text-muted">
                {s.live && (
                  <>
                    {s.live.label} <span className="tnum font-medium text-ink">{s.live.value}</span>
                  </>
                )}
                {s.gap && (
                  <>
                    {' · '}écart <span className="tnum font-medium text-ink">{s.gap.value}</span>
                  </>
                )}
              </span>
              <button type="button" onClick={() => setStep('reps')} className="-mr-2 flex h-11 items-center px-2 text-[16px] text-ink underline decoration-1 underline-offset-4">
                Reps ›
              </button>
            </div>
          </>
        )}
        {step === 'reps' && (
          <>
            <p className="mb-2 flex justify-between px-5 text-[14px] text-muted">
              <span className="font-semibold text-ink">Reps faites</span>
              <span>
                plan {formatRange(prescription.reps)}
                {s.refToBeat && ` · réf. ${s.refToBeat.reps}`}
              </span>
            </p>
            <Grid
              label="Reps"
              values={windowOf(1, [prescription.reps.min, prescription.reps.max], s.reps, 12)}
              value={s.reps}
              presc={[prescription.reps.min, prescription.reps.max]}
              refValue={s.refToBeat?.reps ?? null}
              onPick={(n) => {
                s.setReps(n);
                setStep('rir');
              }}
              cols={4}
              cellH={cellH}
            />
          </>
        )}
        {step === 'rir' && (
          <>
            <p className="mb-2 flex justify-between px-5 text-[14px] text-muted">
              <span className="font-semibold text-ink">Reps en réserve (RIR)</span>
              <span>
                plan {formatRange(prescription.rir)}
                {s.refToBeat && ` · réf. ${s.refToBeat.rir}`}
              </span>
            </p>
            <Grid
              label="RIR"
              values={windowOf(0, [prescription.rir.min, prescription.rir.max], s.rir, 8)}
              value={s.rir}
              presc={[prescription.rir.min, prescription.rir.max]}
              refValue={s.refToBeat?.rir ?? null}
              onPick={s.setRir}
              cols={4}
              cellH={cellH}
            />
            <p className="mt-2 px-5 text-[14px] text-muted">
              {s.live && (
                <>
                  {s.live.label} <span className="tnum font-medium text-ink">{s.live.value}</span>
                </>
              )}
              {s.gap && (
                <>
                  {' · '}écart <span className="tnum font-medium text-ink">{s.gap.value}</span>
                </>
              )}
            </p>
          </>
        )}
      </section>
      <div aria-hidden style={{ flex: '1 0 0px', minHeight: 6, maxHeight: 14 }} />
    </div>
  );
}
