// PROTOTYPE JETABLE · Variante D « Trois cadrans ».
//
// Idée (l'écran montre de Tracked) : la série en cours en TROIS CADRANS côte à
// côte, Poids · Reps · RIR, chacun avec son écart à la Référence écrit en tête
// (« +2,5 », « ±0 », « −1 »), en chiffres seuls, sans couleur ni ▲ (le signal ne
// juge que des séries faites). On voit d'un coup d'œil ce qu'on s'apprête à
// faire face à la dernière fois. Le cadran touché est cerclé de blanc cassé ;
// sa commande s'ouvre dessous (la règle pour le poids, la rangée pour Reps ou
// RIR). Au-dessus, les séries faites tiennent en une ligne de texte, chacune se
// touche pour sa correction.
//
// « kg » : dans l'EN-TÊTE du cadran (« Poids · kg ») ; le nombre est seul, centré
// dans son cadran. La règle n'a plus de nombre au-dessus de l'aiguille : le
// cadran levé, juste au-dessus, le porte.
import { useEffect, useState } from 'react';
import { IconButton, NumberRow, Sign } from '../../../ui';
import { ExerciseIndex } from '../ExerciseIndex';
import { formatRange, formatWeight } from '../format';
import { badgeStatus } from '../set-badges';
import type { VariantProps } from './ProtoSaisie';
import { SideChoice, setText, WeightRuler } from './parts';
import { delta } from './useSaisieProto';

type Dial = 'kg' | 'reps' | 'rir';

export function VariantD({ s, exercise, progress, index, compact, tight, onPick, onEdit, onNotes, hasNote }: VariantProps) {
  const { prescription } = exercise;
  const [dial, setDial] = useState<Dial>('kg');
  useEffect(() => setDial('kg'), [s.draftKey]);
  const r = s.refToBeat;
  const dials: { key: Dial; title: string; unit?: string; value: string; d: string | null }[] = [
    { key: 'kg', title: 'Poids', unit: 'kg', value: formatWeight(s.weightKg), d: r ? delta(s.weightKg, r.weightKg, 2) : null },
    { key: 'reps', title: 'Reps', value: `${s.reps}`, d: r ? delta(s.reps, r.reps) : null },
    { key: 'rir', title: 'RIR', value: `${s.rir}`, d: r ? delta(s.rir, r.rir) : null },
  ];
  const dialH = tight ? 76 : compact ? 96 : 108;

  return (
    <div className="flex flex-1 flex-col pt-1">
      {!tight && <ExerciseIndex items={index} activeId={exercise.exerciseId} onPick={onPick} />}
      <header className="relative px-5 pt-1.5">
        <h2 className={`truncate pr-10 font-[650] leading-[1.1] tracking-[-0.03em] text-ink ${tight ? 'text-[22px]' : compact ? 'text-[26px]' : 'text-[30px]'}`}>{exercise.name}</h2>
        <p className="mt-0.5 truncate text-[14px] text-muted">
          plan {formatRange(prescription.sets)} × {formatRange(prescription.reps)} · RIR {formatRange(prescription.rir)}
        </p>
        <div className="absolute right-2.5 top-0">
          <IconButton icon="note" tone="muted" dot={hasNote} label={`Notes de ${exercise.name}`} onClick={onNotes} />
        </div>
      </header>

      {/* L'air libre est ici : les séries faites rejoignent la série en cours, près du pouce. */}
      <div aria-hidden style={{ flex: '1 0 0px', minHeight: 0 }} />
      {/* Les séries faites, en une ligne de texte qui défile. */}
      <div className="mt-2 flex h-11 flex-none items-center gap-4 overflow-x-auto border-y border-line px-5" style={{ scrollbarWidth: 'none' }} aria-label="Séries faites">
        {progress.sets.length === 0 && <span className="text-[14px] text-muted">Aucune série faite</span>}
        {progress.sets.map((set, i) => {
          const id = progress.setIds[i];
          const st = badgeStatus(s.badges[i] ?? null);
          return (
            <button
              key={id ?? i}
              type="button"
              disabled={!id}
              onClick={() => id && onEdit(id)}
              className="flex h-11 flex-none items-center gap-1.5 whitespace-nowrap text-[14px] active:opacity-70"
              aria-label={`Corriger la série ${set.order}, ${setText(set)}${st ? `, ${st.word}` : ''}`}
            >
              <span className="tnum text-faint">
                {set.order}
                {set.side === 'left' ? 'G' : set.side === 'right' ? 'D' : ''}
              </span>
              <span className="tnum font-medium text-ink underline decoration-dim decoration-1 underline-offset-[5px]">
                {formatWeight(set.weightKg)} × {set.reps} · {set.rir}
              </span>
              {st && (
                <span className={st.v === 'up' ? 'text-sig' : 'text-ink'}>
                  <Sign v={st.v} size={10} />
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div aria-hidden style={{ flex: '0 0 0px', minHeight: tight ? 6 : 10 }} />

      {/* Où je suis et ce que je dois battre. */}
      <div className="flex items-baseline justify-between gap-3 px-5">
        <h3 className="text-[17px] font-semibold text-ink">
          Série {s.rank}
          <span className="font-normal text-muted"> sur {Math.max(prescription.sets.max, s.rank)}</span>
        </h3>
        <p className="tnum min-w-0 truncate text-[14px] text-muted">
          {r ? (
            <>
              réf. <span className="font-medium text-ink">{setText(r)}</span>
            </>
          ) : s.hasReference ? (
            'rien à battre'
          ) : (
            'pas encore de réf.'
          )}
        </p>
      </div>
      {s.unilateral && s.side && (
        <div className="flex items-center justify-between px-5">
          <span className="text-[14px] text-muted">Côté</span>
          <SideChoice side={s.side} done={s.doneSides} onChoose={s.chooseSide} className="-mr-2.5" />
        </div>
      )}

      {/* Les trois cadrans. */}
      <div role="tablist" aria-label="Valeurs de la série" className="mt-2 grid grid-cols-[1.45fr_1fr_1fr] gap-2 px-5">
        {dials.map((d) => {
          const on = d.key === dial;
          return (
            <button
              key={d.key}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setDial(d.key)}
              aria-label={`${d.title} ${d.value}${d.unit ? ` ${d.unit}` : ''}${d.d ? `, écart à la réf. ${d.d}` : ''}`}
              className={`flex flex-col rounded-block px-2.5 pt-2 text-left ${on ? 'border-2 border-ink bg-raise' : 'border border-line active:bg-raise'}`}
              style={{ height: dialH }}
            >
              <span className="flex w-full items-baseline justify-between gap-1 text-[13px] leading-none">
                <span className={on ? 'font-semibold text-ink' : 'text-muted'}>
                  {d.title}
                  {d.unit && <span className="font-normal text-faint"> · {d.unit}</span>}
                </span>
                {d.d && <span className="tnum text-muted">{d.d}</span>}
              </span>
              <span className={`tnum flex flex-1 items-center justify-center font-[650] leading-none tracking-[-0.03em] ${on ? 'text-ink' : 'text-muted'}`} style={{ fontSize: d.key === 'kg' ? (tight ? 30 : 36) : tight ? 32 : 38 }}>
                {d.value}
              </span>
            </button>
          );
        })}
      </div>

      <div aria-hidden style={{ flex: '1 0 0px', minHeight: tight ? 8 : 12, maxHeight: 24 }} />

      {/* La commande du cadran touché. */}
      <section aria-label={`Régler ${dials.find((x) => x.key === dial)?.title}`}>
        {dial === 'kg' ? (
          <>
            <div className="flex items-baseline justify-between px-5 pb-1">
              <span className="text-[15px] font-semibold text-ink">Poids</span>
              <span className="text-[14px] text-muted">règle au pas de {formatWeight(s.stepKg)} kg</span>
            </div>
            <WeightRuler weightKg={s.weightKg} onChange={s.setWeight} stepKg={s.stepKg} height={tight ? 48 : 60} compact={tight} />
          </>
        ) : dial === 'reps' ? (
          <NumberRow
            key={`reps-${s.draftKey}`}
            label="Reps"
            min={1}
            max={Math.max(50, s.reps, prescription.reps.max)}
            value={s.reps}
            presc={[prescription.reps.min, prescription.reps.max]}
            refValue={r?.reps ?? null}
            onPick={s.setReps}
            compact={compact}
          />
        ) : (
          <NumberRow
            key={`rir-${s.draftKey}`}
            label="RIR"
            min={0}
            max={Math.max(10, s.rir, prescription.rir.max)}
            value={s.rir}
            presc={[prescription.rir.min, prescription.rir.max]}
            refValue={r?.rir ?? null}
            onPick={s.setRir}
            compact={compact}
          />
        )}
      </section>

      <p className="mt-1 px-5 text-[14px] text-muted">
        {s.live && (
          <>
            {s.live.label} <span className="tnum font-medium text-ink">{s.live.value}</span>
          </>
        )}
        {s.gap && (
          <>
            {' · '}écart {s.gap.measure} <span className="tnum font-medium text-ink">{s.gap.value}</span>
          </>
        )}
        {s.record && (
          <>
            {' · '}record <span className="tnum font-medium text-ink">{s.record.value}</span>
          </>
        )}
      </p>
      <div aria-hidden style={{ flex: '1 0 0px', minHeight: 4, maxHeight: 12 }} />
    </div>
  );
}
