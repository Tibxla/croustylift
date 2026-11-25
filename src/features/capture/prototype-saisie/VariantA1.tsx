// PROTOTYPE JETABLE · tour 2 · Variante A1 « Allégée » (et le haut commun à A1,
// A2, A3).
//
// Retour du 25/11 sur A : « l'esprit de la A, mais moins fouillis ; la partie
// basse est vachement chargée comparée à la partie haute ». A1 garde les deux
// zones de A et fait passer la méta du bas vers le haut :
//   - HAUT (fond) : l'index, l'exo, « Série n sur N » et le plan, la bande des
//     séries, puis le tableau de marque (contrainte du 25/11, « toujours mon PR,
//     la série de la dernière fois et l'e1RM, et si je les bats ») : l'e1RM de la
//     série en cours, la dernière fois et le Record côte à côte, chacun avec
//     l'écart du brouillon en direct (`Indicator`). Tout ce qui se LIT.
//   - BAS (fond levé) : seulement ce qui se RÈGLE, sans titre ni méta. Le poids
//     (bloc « 140 kg » centré) et sa règle, puis Reps et RIR chacun sur UNE ligne
//     (le mot à gauche, les chiffres à droite). La fourchette du plan se lit au
//     filet sous les chiffres, la Référence au petit carré au-dessus : plus de
//     « plan 8-12 · réf. 8 » écrit.
//   - Les rangées ne montrent que des chiffres ENTIERS (six cases calées sur le
//     plan, jamais de chiffre coupé au bord) ; elles défilent au doigt pour les
//     autres valeurs et se recalent sur une case entière.
import { useLayoutEffect, useRef } from 'react';
import { IconButton, Sign } from '../../../ui';
import { ExerciseIndex } from '../ExerciseIndex';
import { formatRange } from '../format';
import { SetBand, UniSetBand } from '../SetBand';
import type { VariantProps } from './ProtoSaisie';
import { ProtoWeight, SideChoice, setText, WeightRuler } from './parts';

/** `&vif=1` : le ▲ du brouillon passe au signal (voir `Indicator`). */
const VIF = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('vif') === '1';

/** L'écart du BROUILLON à un repère, en direct : signe + écart + mot.
 *
 *  ADR 0010 et draft-e1rm.ts : sur le brouillon, pas de verdict (« battue »,
 *  « battrait ») ni de badge qui s'allume, sinon un RIR gonflé d'un cran suffit à
 *  « battre » et l'auto-évaluation se fausse. On écrit donc une POSITION, pas un
 *  exploit : « au-dessus », « à égalité », « en dessous », avec l'écart exact
 *  dans la mesure du juge (e1RM, ou reps effectives à 0 kg). Le signe suit la
 *  triade, mais en blanc cassé : le signal reste au verdict de la série faite,
 *  dans la bande. `&vif=1` montre l'autre option (▲ au signal dès le réglage)
 *  pour que l'utilisateur tranche. */
function Indicator({ sign, gap }: { sign: -1 | 0 | 1; gap: string }) {
  const word = sign > 0 ? 'au-dessus' : sign === 0 ? 'à égalité' : 'en dessous';
  const tone = sign > 0 ? (VIF ? 'text-sig' : 'text-ink') : sign === 0 ? 'text-ink' : 'text-muted';
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap text-[14px] ${tone}`}>
      <Sign v={sign > 0 ? 'up' : sign === 0 ? 'eq' : 'down'} size={10} />
      {sign !== 0 && gap && <span className="tnum font-medium">{gap}</span>}
      {word}
    </span>
  );
}

/** Ta série (e1RM du brouillon), la dernière fois, le Record : toujours visibles. */
function Score({ s }: { s: VariantProps['s'] }) {
  const ref = s.refToBeat;
  return (
    <div>
      <div className="flex min-h-7 items-center justify-between gap-3">
        {/* Unilatéral : le côté choisi prend la place du mot (même ligne). */}
        {s.unilateral && s.side ? (
          <SideChoice side={s.side} done={s.doneSides} onChoose={s.chooseSide} className="-my-2 -ml-2.5" />
        ) : (
          <span className="text-[15px] text-muted">Cette série</span>
        )}
        <span className="tnum text-[20px] font-semibold tracking-[-0.01em] text-ink">
          {s.live ? (
            <>
              <span className="text-[15px] font-normal text-muted">{s.live.label} </span>
              {s.live.value}
            </>
          ) : (
            '·'
          )}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-2">
        <div className="min-w-0 pr-3">
          <p className="text-[13px] text-muted">Dernière fois</p>
          <p className="tnum mt-0.5 truncate text-[16px] font-medium text-ink">{ref ? setText(ref) : <span className="font-normal text-muted">{s.hasReference ? 'rien à cette série' : 'pas encore'}</span>}</p>
          <p className="mt-0.5 h-5">{s.vsRef && <Indicator sign={s.vsRef.sign} gap={s.vsRef.gap} />}</p>
        </div>
        <div className="min-w-0 border-l border-line pl-3">
          <p className="text-[13px] text-muted">Record</p>
          <p className="tnum mt-0.5 truncate text-[16px] font-medium text-ink">
            {s.recordNow ? (
              <>
                {s.recordNow.unit === 'reps' ? 'reps eff. ' : 'e1RM '}
                {s.recordNow.value}
              </>
            ) : (
              <span className="font-normal text-muted">aucun encore</span>
            )}
          </p>
          <p className="mt-0.5 h-5">{s.recordNow && <Indicator sign={s.recordNow.sign} gap={s.recordNow.gap} />}</p>
        </div>
      </div>
    </div>
  );
}

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

      {/* Le tableau de marque : l'e1RM de la série en cours, puis la dernière
          fois et le Record, chacun avec l'écart du brouillon en direct. */}
      <Air min={tight ? 8 : 14} max={30} />
      <div data-zone="haut-fin" className={`mx-5 border-t border-line ${tight ? 'pt-2' : 'pt-3'}`}>
        <Score s={s} />
      </div>
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
      <ProtoWeight value={s.weightKg} onChange={s.setWeight} size={tight ? 52 : compact ? (s.unilateral ? 56 : 64) : 72} unit="block" />
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
