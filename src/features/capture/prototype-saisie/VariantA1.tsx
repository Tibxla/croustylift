// PROTOTYPE JETABLE · tour 2 · Variante A1 « Allégée » (et le haut commun à A1,
// A2, A3).
//
// Retour du 25/11 sur A : « l'esprit de la A, mais moins fouillis ; la partie
// basse est vachement chargée comparée à la partie haute ». A1 garde les deux
// zones de A et fait passer la méta du bas vers le haut :
//   - HAUT (fond) : l'index, l'exo, « Série n sur N » et le plan, la bande des
//     séries, puis le bloc « À battre » : la Référence en grand, et dessous
//     l'e1RM du brouillon, son écart et le record. Tout ce qui se LIT.
//   - BAS (fond levé) : seulement ce qui se RÈGLE, sans titre ni méta. Le poids
//     (bloc « 140 kg » centré) et sa règle, puis Reps et RIR chacun sur UNE ligne
//     (le mot à gauche, les chiffres à droite). La fourchette du plan se lit au
//     filet sous les chiffres, la Référence au petit carré au-dessus : plus de
//     « plan 8-12 · réf. 8 » écrit.
//   - Les rangées ne montrent que des chiffres ENTIERS (six cases calées sur le
//     plan, jamais de chiffre coupé au bord) ; elles défilent au doigt pour les
//     autres valeurs et se recalent sur une case entière.
import { useLayoutEffect, useRef } from 'react';
import { IconButton } from '../../../ui';
import { ExerciseIndex } from '../ExerciseIndex';
import { formatRange } from '../format';
import { SetBand, UniSetBand } from '../SetBand';
import type { VariantProps } from './ProtoSaisie';
import { ProtoWeight, SideChoice, setText, WeightRuler } from './parts';

export function Air({ min, max = 24, grow = 1 }: { min: number; max?: number; grow?: number }) {
  return <div aria-hidden style={{ flex: `${grow} 0 0px`, minHeight: min, maxHeight: max }} />;
}

/** Le haut commun aux déclinaisons de A : ce qui se lit. */
export function HautA({ s, exercise, progress, index, exoPos, compact, tight, onPick, onEdit, onNotes, hasNote }: VariantProps) {
  const { prescription } = exercise;
  const draft = { order: s.rank, weightKg: s.weightKg, reps: s.reps, rir: s.rir, side: s.side ?? undefined };
  return (
    // `contents` : les airs du haut partagent la hauteur libre avec celui qui
    // sépare le haut du bas (même colonne).
    <div className="contents">
      {!tight && <ExerciseIndex items={index} activeId={exercise.exerciseId} onPick={onPick} />}
      <header className={`relative px-5 ${tight ? 'pt-1' : 'pt-2'}`}>
        <h2 className={`truncate pr-10 font-[650] leading-[1.1] tracking-[-0.03em] text-ink ${tight ? 'text-[24px]' : compact ? 'text-[28px]' : 'text-[32px]'}`}>
          {exercise.name}
        </h2>
        <p className="mt-1 truncate text-[15px] text-muted">
          <span className="font-semibold text-ink">
            Série {s.rank} sur {Math.max(prescription.sets.max, s.rank)}
          </span>
          {' · '}
          {formatRange(prescription.reps)} reps · RIR {formatRange(prescription.rir)}
          {tight && ` · exo ${exoPos.n}/${exoPos.total}`}
        </p>
        <div className="absolute right-2.5 top-0">
          <IconButton icon="note" tone="muted" dot={hasNote} label={`Notes de ${exercise.name}`} onClick={onNotes} />
        </div>
      </header>

      <Air min={tight ? 8 : 14} max={30} />
      <div>
        {s.unilateral ? (
          <UniSetBand sets={progress.sets} setIds={progress.setIds} badges={s.badges} draft={draft} side={s.side ?? 'left'} plannedMax={s.plannedMax} onEdit={onEdit} />
        ) : (
          <SetBand sets={progress.sets} setIds={progress.setIds} badges={s.badges} draft={draft} plannedMax={s.plannedMax} onEdit={onEdit} />
        )}
      </div>

      {/* À battre : la Référence en grand, ce que vaut le brouillon dessous. */}
      <Air min={tight ? 8 : 14} max={30} />
      <div data-zone="haut-fin" className={`mx-5 border-t border-line ${tight ? 'pt-2' : 'pt-3'}`}>
        <p className="flex items-baseline justify-between gap-3">
          <span className="text-[15px] text-muted">À battre</span>
          <span className="tnum truncate text-[20px] font-semibold tracking-[-0.01em] text-ink">
            {s.refToBeat ? setText(s.refToBeat) : <span className="text-[16px] font-normal text-muted">{s.hasReference ? 'rien à cette série' : 'pas encore de réf.'}</span>}
          </span>
        </p>
        <p className="mt-1 flex items-baseline justify-between gap-3 text-[14px] text-muted">
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
      </div>
      {s.unilateral && s.side && (
        <div className="flex items-center justify-between px-5">
          <span className="text-[15px] text-muted">Côté</span>
          <SideChoice side={s.side} done={s.doneSides} onChoose={s.chooseSide} className="-mr-2.5" />
        </div>
      )}
    </div>
  );
}

const CELLS = 6;

/** Reps ou RIR sur une ligne : le mot à gauche, six chiffres entiers à droite.
 *  Le filet sous les chiffres marque le plan, le carré au-dessus la Référence,
 *  le trait épais la valeur choisie. Défile au doigt, se recale sur une case
 *  entière (`scroll-snap` au début de case). Aucun recadrage animé. */
export function PlanRow({
  label,
  min,
  max,
  value,
  presc,
  refValue,
  onPick,
  height,
}: {
  label: string;
  min: number;
  max: number;
  value: number;
  presc: [number, number];
  refValue: number | null;
  onPick: (n: number) => void;
  height: number;
}) {
  const row = useRef<HTMLDivElement>(null);
  const values = Array.from({ length: max - min + 1 }, (_, i) => min + i);
  const cellW = () => (row.current?.clientWidth ?? 300) / CELLS;
  const showFrom = (first: number) => {
    const el = row.current;
    if (el) el.scrollLeft = Math.max(0, first - min) * cellW();
  };
  // Calage d'ouverture : le plan centré dans les six cases, la valeur dedans.
  useLayoutEffect(() => {
    const planLen = presc[1] - presc[0] + 1;
    let first = presc[0] - Math.floor(Math.max(0, CELLS - planLen) / 2);
    if (value < first) first = value;
    if (value > first + CELLS - 1) first = value - CELLS + 1;
    showFrom(Math.max(min, Math.min(first, max - CELLS + 1)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Une valeur venue d'ailleurs hors du champ : on la ramène, sans animation.
  useLayoutEffect(() => {
    const el = row.current;
    if (!el) return;
    const first = Math.round(el.scrollLeft / cellW()) + min;
    if (value < first) showFrom(value);
    else if (value > first + CELLS - 1) showFrom(value - CELLS + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className="flex items-center pl-5 pr-3">
      <span className="w-[52px] flex-none text-[16px] font-semibold text-ink">{label}</span>
      <div
        ref={row}
        role="radiogroup"
        aria-label={label}
        className="flex min-w-0 flex-1 overflow-x-auto"
        style={{ scrollbarWidth: 'none', scrollSnapType: 'x mandatory', overscrollBehaviorX: 'contain' }}
      >
        {values.map((n) => {
          const sel = n === value;
          const inPlan = n >= presc[0] && n <= presc[1];
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={sel}
              onClick={() => n !== value && onPick(n)}
              className="relative flex-none select-none"
              style={{ flexBasis: `${100 / CELLS}%`, height, scrollSnapAlign: 'start' }}
            >
              <span className={`tnum flex h-full items-center justify-center text-[22px] tracking-[-0.01em] ${sel ? 'font-bold text-ink' : inPlan ? 'text-ink' : 'text-faint'}`}>{n}</span>
              {inPlan && <span className="absolute inset-x-0 bottom-0 h-px bg-dim" />}
              {sel && <span className="absolute inset-x-2 bottom-0 h-[4px] bg-ink" />}
              {refValue === n && <span className="absolute left-1/2 top-1 h-[5px] w-[5px] -translate-x-1/2 bg-muted" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Le bas allégé : poids et règle, puis Reps et RIR sur une ligne chacun. */
export function BasAllege({ s, exercise, compact, tight }: VariantProps) {
  const { prescription } = exercise;
  const rowH = tight ? 44 : 48;
  return (
    <div data-zone="bas" className={`flex flex-col bg-raise ${tight ? 'pt-2' : 'pt-3'} pb-1`}>
      <ProtoWeight value={s.weightKg} onChange={s.setWeight} size={tight ? 52 : compact ? 64 : 72} unit="block" />
      <div className={tight ? 'mt-1' : 'mt-2'}>
        <WeightRuler weightKg={s.weightKg} onChange={s.setWeight} stepKg={s.stepKg} height={tight ? 44 : compact ? 48 : 58} compact={compact} />
      </div>
      <div className="border-t border-line">
        <PlanRow
          key={`reps-${s.draftKey}`}
          label="Reps"
          min={1}
          max={Math.max(50, s.reps, prescription.reps.max)}
          value={s.reps}
          presc={[prescription.reps.min, prescription.reps.max]}
          refValue={s.refToBeat?.reps ?? null}
          onPick={s.setReps}
          height={rowH}
        />
      </div>
      <div className="border-t border-line">
        <PlanRow
          key={`rir-${s.draftKey}`}
          label="RIR"
          min={0}
          max={Math.max(10, s.rir, prescription.rir.max)}
          value={s.rir}
          presc={[prescription.rir.min, prescription.rir.max]}
          refValue={s.refToBeat?.rir ?? null}
          onPick={s.setRir}
          height={rowH}
        />
      </div>
    </div>
  );
}

export function VariantA1(p: VariantProps) {
  return (
    <div className="flex flex-1 flex-col pt-1">
      <HautA {...p} />
      <Air min={p.tight ? 8 : 14} max={9999} />
      <BasAllege {...p} />
      <Air min={p.tight ? 4 : 8} max={12} />
    </div>
  );
}
