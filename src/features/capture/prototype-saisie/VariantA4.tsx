// PROTOTYPE JETABLE · tour 4 · Variante A4 « Pied léger, aéré » (A3 retouchée).
//
// Retour du 25/11 sur A3 : « réduire en dessous le nombre de séries, le poids et
// les reps, que ça tienne sur une ligne ; plus d'espace entre le truc pour
// choisir le poids, les reps et les RIR ; mais ce système de pouvoir coulisser,
// on garde ça, j'aime trop. »
//
// 1. BANDE SUR UNE LIGNE (`LineBand`) : sous le numéro, « 171,25 × 8 » sur UNE
//    ligne. Sacrifié à l'écran : le RIR des séries faites (il reste dans le nom
//    lu et dans la feuille de correction, qui s'ouvre au toucher). Quatre cases
//    entières dès 360 px, trois à 320 ; au-delà, la bande défile, se cale sur
//    une case entière et garde la série en cours en vue. En unilatéral, une case par
//    côté (« 2 G », « 2 D ») au lieu de deux lignes par case.
// 2. TROIS PLAQUES DE RÉGLAGE : poids et règle, Reps, RIR, chacune sur son fond
//    levé, séparées par une bande du fond noir. Les rangées qui coulissent
//    restent telles quelles. Entre deux zones tactiles voisines, 20 px au moins
//    de rien (mesuré), et un changement de fond que le pouce voit.
// Le reste est A3 : le haut et ses indicateurs, le pied léger.
import { useLayoutEffect, useRef } from 'react';
import type { PerformedSet, Side } from '../../../domain/types';
import { Sign } from '../../../ui';
import { formatWeight } from '../format';
import { badgeStatus } from '../set-badges';
import type { VariantProps } from './ProtoSaisie';
import { Air, HautA, PlanRow } from './VariantA1';
import { ProtoWeight, setText, WeightRuler } from './parts';

const sideLetter = (sd: Side | undefined | null) => (sd === 'left' ? ' G' : sd === 'right' ? ' D' : '');
/** « 171,25 × 8 », espaces ultrafines autour du signe : « 126,25 × 12 » tient
 *  dans une case de 84 px (375 px d'écran) à 14 px. */
const line = (w: number, reps: number) => `${formatWeight(w)}\u200a×\u200a${reps}`;

type Cell =
  | { kind: 'done'; key: string; label: string; set: PerformedSet; id: string | null; i: number }
  | { kind: 'now'; key: string; label: string }
  | { kind: 'todo'; key: string; label: string };

function LineBand({ s, progress, onEdit }: Pick<VariantProps, 's' | 'progress' | 'onEdit'>) {
  const cells: Cell[] = progress.sets.map((set, i) => ({
    kind: 'done',
    key: `d${i}`,
    label: `${set.order}${sideLetter(set.side)}`,
    set,
    id: progress.setIds[i] ?? null,
    i,
  }));
  cells.push({ kind: 'now', key: 'now', label: `${s.rank}${sideLetter(s.side)}` });
  if (s.unilateral && s.side) {
    const other: Side = s.side === 'left' ? 'right' : 'left';
    const has = (o: number, sd: Side) => progress.sets.some((x) => x.order === o && x.side === sd);
    if (!has(s.rank, other)) cells.push({ kind: 'todo', key: `t${s.rank}${other}`, label: `${s.rank}${sideLetter(other)}` });
    for (let o = s.rank + 1; o <= s.plannedMax; o++) {
      cells.push({ kind: 'todo', key: `t${o}G`, label: `${o} G` }, { kind: 'todo', key: `t${o}D`, label: `${o} D` });
    }
  } else {
    for (let o = progress.sets.length + 2; o <= s.plannedMax; o++) cells.push({ kind: 'todo', key: `t${o}`, label: `${o}` });
  }
  const nowIndex = progress.sets.length;
  // Quatre cases entières dès 360 px, trois en dessous (320 px) : jamais de
  // case coupée au repos. Le chiffre est à 14 px sur quatre cases, 15 sur trois.
  const vw = typeof window === 'undefined' ? 393 : window.innerWidth;
  const perView = vw >= 360 ? 4 : 3;
  const valueSize = perView === 3 ? 'text-[15px]' : 'text-[14px]';
  const band = useRef<HTMLOListElement>(null);
  useLayoutEffect(() => {
    const el = band.current;
    // Calée sur une case entière : la série d'avant-hier, d'hier, puis l'en cours.
    const first = el?.children[Math.max(0, nowIndex - 2)] as HTMLElement | undefined;
    if (!el || !first) return;
    el.scrollLeft = first.offsetLeft - 20;
  }, [nowIndex, cells.length]);

  return (
    <ol
      ref={band}
      className="flex overflow-x-auto px-5"
      style={{ scrollbarWidth: 'none', scrollSnapType: 'x mandatory', scrollPaddingLeft: 20 }}
      aria-label="Séries de cet exo"
    >
      {cells.map((c) => {
        const st = c.kind === 'done' ? badgeStatus(s.badges[c.i] ?? null) : null;
        const head = (
          <span className="flex h-[18px] items-center gap-1 whitespace-nowrap text-[13px] leading-[18px]">
            <span className={`tnum ${c.kind === 'now' ? 'font-semibold text-ink' : 'text-faint'}`}>{c.label}</span>
            {st && (
              <span className={`inline-flex items-center gap-0.5 ${st.v === 'up' ? 'text-sig' : 'text-ink'}`}>
                <Sign v={st.v} size={9} />
                {st.short}
              </span>
            )}
          </span>
        );
        const value =
          c.kind === 'done' ? line(c.set.weightKg, c.set.reps) : c.kind === 'now' ? line(s.weightKg, s.reps) : '·';
        const body = (
          <>
            {head}
            <span
              className={`tnum mt-0.5 block whitespace-nowrap ${valueSize} font-medium leading-5 tracking-[-0.01em] ${
                c.kind === 'done' ? 'text-ink' : c.kind === 'now' ? 'text-muted' : 'text-faint'
              }`}
            >
              <span className={c.kind === 'done' && c.id ? 'underline decoration-dim decoration-1 underline-offset-[4px]' : ''}>{value}</span>
            </span>
          </>
        );
        const underline = c.kind === 'now' ? 'h-[3px] bg-ink' : c.kind === 'done' ? 'h-px bg-muted' : 'h-px bg-line';
        return (
          <li key={c.key} className="relative min-w-0" style={{ flex: `0 0 ${100 / perView}%`, scrollSnapAlign: 'start' }}>
            {c.kind === 'done' && c.id ? (
              <button
                type="button"
                onClick={() => c.id && onEdit(c.id)}
                aria-label={`Corriger la série ${c.label}, ${setText(c.set)}${st ? `, ${st.word}` : ''}`}
                className="block w-full pb-1.5 pr-1.5 text-left active:bg-line"
              >
                {body}
              </button>
            ) : (
              <div className="pb-1.5 pr-1.5" aria-label={c.kind === 'now' ? `Série ${c.label} en cours, ${setText(s)}` : `Série ${c.label}, à faire`}>
                {body}
              </div>
            )}
            <span aria-hidden className={`pointer-events-none absolute bottom-0 left-0 right-2 ${underline}`} />
          </li>
        );
      })}
    </ol>
  );
}

/** Les trois plaques de réglage, séparées par le fond. */
function BasAere({ s, exercise, compact, tight }: VariantProps) {
  const { prescription } = exercise;
  const rowH = tight ? 44 : 48;
  const gap = tight ? 8 : compact ? 10 : 14;
  return (
    <div data-zone="bas" className="flex flex-col" style={{ gap }}>
      <div data-plate="poids" className={`bg-raise ${tight ? 'pt-2' : 'pt-3'} pb-1.5`}>
        <ProtoWeight value={s.weightKg} onChange={s.setWeight} size={tight ? 52 : compact ? (s.unilateral ? 56 : 64) : 72} unit="block" />
        <div className={tight ? 'mt-1' : 'mt-2'}>
          <WeightRuler weightKg={s.weightKg} onChange={s.setWeight} stepKg={s.stepKg} height={tight ? 44 : compact ? 48 : 58} compact={compact} />
        </div>
      </div>
      <div data-plate="reps" className="bg-raise py-1">
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
      <div data-plate="rir" className="bg-raise py-1">
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

export function VariantA4(p: VariantProps) {
  return (
    <div className="flex flex-1 flex-col pt-1">
      <HautA {...p} bandSlot={<LineBand s={p.s} progress={p.progress} onEdit={p.onEdit} />} />
      <Air min={p.tight ? 8 : 14} max={9999} />
      <BasAere {...p} />
      <Air min={p.tight ? 4 : 8} max={12} />
    </div>
  );
}
