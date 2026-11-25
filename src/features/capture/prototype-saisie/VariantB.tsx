// PROTOTYPE JETABLE · Variante B « Tableau ».
//
// Idée (apps de log, Tracked compris) : les séries de l'exo en TABLEAU, une
// ligne par série, colonnes Série · Réf. · kg · Reps · RIR · état. Les séries
// faites se lisent d'un bloc, avec leur Référence en face ; la ligne en cours
// est levée et ses trois cases se touchent. Sous le tableau, séparé par un trait
// épais, UN réglage à la fois : celui de la case touchée (la règle pour kg, la
// rangée pour Reps ou RIR). Toucher une ligne faite ouvre sa correction.
// Aucun clavier : une case ouvre la règle ou la rangée, jamais un champ.
//
// « kg » : en EN-TÊTE de colonne et dans le titre du réglage (« Poids, kg ») ;
// le nombre est seul, centré pile sur l'aiguille.
import { useEffect, useState } from 'react';
import type { PerformedSet } from '../../../domain/types';
import { IconButton, NumberRow, Sign } from '../../../ui';
import { formatRange, formatWeight } from '../format';
import { badgeStatus } from '../set-badges';
import type { VariantProps } from './ProtoSaisie';
import { ProtoWeight, SideChoice, WeightRuler } from './parts';

type Field = 'kg' | 'reps' | 'rir';
const COLS = 'grid grid-cols-[40px_minmax(0,1fr)_70px_48px_44px_14px] items-center gap-x-1.5 px-5';

function refShort(r: PerformedSet | null | undefined): string {
  return r ? `${formatWeight(r.weightKg)} × ${r.reps} · ${r.rir}` : '·';
}

export function VariantB({ s, exercise, progress, exoPos, compact, tight, onEdit, onNotes, hasNote }: VariantProps) {
  const { prescription, reference } = exercise;
  const [field, setField] = useState<Field>('kg');
  // Nouvelle série : le réglage revient au poids.
  useEffect(() => setField('kg'), [s.draftKey]);
  const sideMark = (sd: string | null | undefined) => (sd === 'left' ? ' G' : sd === 'right' ? ' D' : '');
  const refOf = (order: number, side?: string) => reference?.find((r) => r.order === order && (r.side ?? undefined) === (side ?? undefined)) ?? null;
  const future = s.unilateral ? [] : Array.from({ length: Math.max(0, s.plannedMax - progress.sets.length - 1) }, (_, i) => progress.sets.length + 2 + i);
  const rowH = tight ? 'h-10' : 'h-11';

  const cell = (f: Field, value: string, label: string) => {
    const on = field === f;
    return (
      <button
        type="button"
        onClick={() => setField(f)}
        aria-label={`${label} ${value}${on ? ', en réglage' : ''}`}
        aria-pressed={on}
        className={`tnum flex h-11 items-center justify-center rounded-block text-[19px] font-semibold tracking-[-0.01em] text-ink ${on ? 'border-2 border-ink' : 'border border-dim'}`}
      >
        {value}
      </button>
    );
  };

  return (
    <div className="flex flex-1 flex-col pt-2">
      <header className="relative px-5">
        <h2 className={`truncate pr-10 font-[650] leading-[1.1] tracking-[-0.03em] text-ink ${tight ? 'text-[22px]' : compact ? 'text-[26px]' : 'text-[30px]'}`}>{exercise.name}</h2>
        <p className="mt-0.5 truncate text-[14px] text-muted">
          Exo {exoPos.n} sur {exoPos.total} · plan {formatRange(prescription.sets)} × {formatRange(prescription.reps)} · RIR {formatRange(prescription.rir)}
        </p>
        <div className="absolute -top-1 right-2.5">
          <IconButton icon="note" tone="muted" dot={hasNote} label={`Notes de ${exercise.name}`} onClick={onNotes} />
        </div>
      </header>

      <div aria-hidden style={{ flex: '1 0 0px', minHeight: tight ? 6 : 10, maxHeight: 22 }} />

      <div role="table" aria-label="Séries de cet exo">
        <div role="row" className={`${COLS} h-7 border-b border-line text-[13px] text-faint`}>
          <span role="columnheader">Série</span>
          <span role="columnheader">Réf.</span>
          <span role="columnheader" className="text-center">
            kg
          </span>
          <span role="columnheader" className="text-center">
            Reps
          </span>
          <span role="columnheader" className="text-center">
            RIR
          </span>
          <span />
        </div>

        {progress.sets.map((set, i) => {
          const id = progress.setIds[i];
          const st = badgeStatus(s.badges[i] ?? null);
          const content = (
            <>
              <span className="tnum text-[15px] text-muted">
                {set.order}
                {sideMark(set.side)}
              </span>
              <span className="tnum truncate text-[13px] text-faint">{refShort(refOf(set.order, set.side))}</span>
              <span className="tnum text-center text-[17px] font-medium text-ink">{formatWeight(set.weightKg)}</span>
              <span className="tnum text-center text-[17px] font-medium text-ink">{set.reps}</span>
              <span className="tnum text-center text-[17px] font-medium text-ink">{set.rir}</span>
              <span className={`flex justify-end ${st?.v === 'up' ? 'text-sig' : 'text-ink'}`}>{st ? <Sign v={st.v} size={12} /> : null}</span>
            </>
          );
          return id ? (
            <button
              key={id}
              type="button"
              role="row"
              onClick={() => onEdit(id)}
              aria-label={`Corriger la série ${set.order}${sideMark(set.side)}, ${formatWeight(set.weightKg)} × ${set.reps} · RIR ${set.rir}${st ? `, ${st.word}` : ''}`}
              className={`${COLS} ${rowH} w-full border-b border-line text-left active:bg-line`}
            >
              {content}
            </button>
          ) : (
            <div key={i} role="row" className={`${COLS} ${rowH} border-b border-line`}>
              {content}
            </div>
          );
        })}

        {/* La ligne en cours : levée, ses trois cases se touchent. */}
        <div role="row" aria-current="step" className={`${COLS} h-[60px] border-b border-line bg-raise`}>
          <span className="tnum text-[15px] font-semibold text-ink">
            {s.rank}
            {sideMark(s.side)}
          </span>
          <span className="tnum truncate text-[13px] text-ink">{refShort(s.refToBeat)}</span>
          {cell('kg', formatWeight(s.weightKg), 'Poids en kg')}
          {cell('reps', `${s.reps}`, 'Reps')}
          {cell('rir', `${s.rir}`, 'RIR')}
          <span />
        </div>

        {future.map((order) => (
          <div key={order} role="row" className={`${COLS} ${rowH} border-b border-line text-faint`}>
            <span className="tnum text-[15px]">{order}</span>
            <span className="tnum truncate text-[13px]">{refShort(refOf(order))}</span>
            <span className="text-center">·</span>
            <span className="text-center">·</span>
            <span className="text-center">·</span>
            <span />
          </div>
        ))}
      </div>

      <p className="mt-1.5 flex justify-between px-5 text-[14px] text-muted">
        <span>
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
        {s.record && (
          <span>
            record <span className="tnum font-medium text-ink">{s.record.value}</span>
          </span>
        )}
      </p>
      {s.unilateral && s.side && (
        <div className="flex items-center justify-between px-5">
          <span className="text-[14px] text-muted">Côté de la ligne en cours</span>
          <SideChoice side={s.side} done={s.doneSides} onChoose={s.chooseSide} className="-mr-2.5" />
        </div>
      )}

      <div aria-hidden style={{ flex: '1 0 0px', minHeight: tight ? 6 : 10 }} />

      {/* Le réglage de la case touchée, un seul à la fois. */}
      <section className={`border-t-2 border-muted ${tight ? 'pt-1.5' : 'pt-2.5'} pb-1`}>
        {field === 'kg' ? (
          <>
            <div className="flex items-baseline justify-between px-5">
              <h3 className="text-[15px] font-semibold text-ink">Poids, kg</h3>
              <p className="text-[14px] text-muted">série {s.rank}</p>
            </div>
            <ProtoWeight value={s.weightKg} onChange={s.setWeight} size={tight ? 44 : compact ? 52 : 64} unit="none" />
            <div className="mt-1">
              <WeightRuler weightKg={s.weightKg} onChange={s.setWeight} stepKg={s.stepKg} height={tight ? 40 : compact ? 44 : 56} compact={compact} />
            </div>
          </>
        ) : field === 'reps' ? (
          <NumberRow
            key={`reps-${s.draftKey}`}
            label="Reps"
            min={1}
            max={Math.max(50, s.reps, prescription.reps.max)}
            value={s.reps}
            presc={[prescription.reps.min, prescription.reps.max]}
            refValue={s.refToBeat?.reps ?? null}
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
            refValue={s.refToBeat?.rir ?? null}
            onPick={s.setRir}
            compact={compact}
          />
        )}
      </section>
    </div>
  );
}
