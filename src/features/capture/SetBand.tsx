// Bande des séries de l'exo affiché : une case par série prévue (borne haute du
// plan, plus la série en cours si on la dépasse). Case loggée : rang, statut
// face à la Référence ou au record (signe + mot), poids, puis « ×reps · RIR » :
// les reps ne sont jamais coupées, même avec un poids à décimales à 360 px. Case en cours :
// le brouillon en gris, soulignée d'un trait épais. Au-delà de 4 cases, la bande
// défile et garde la série en cours en vue.
//
// Les cases se lisent, elles ne se touchent pas : corriger ou supprimer une
// série quelconque est une capacité à venir (refonte E, lot 3). Annuler la
// dernière série reste dans la barre du bas.
import { useLayoutEffect, useRef } from 'react';
import type { PerformedSet, Side } from '../../domain/types';
import { pairSidesByOrder } from '../../domain/unilateral';
import { Sign, Status, TONE, type Verdict } from '../../ui';
import { formatWeight } from './format';
import type { SetBadge } from './set-badges';

interface Draft {
  weightKg: number;
  reps: number;
  rir: number;
}

/** Le statut d'une série, en signe + mot : record ou battue (signal), égalée. */
function badgeStatus(badge: SetBadge): { v: Verdict; word: string } | null {
  if (!badge) return null;
  if (badge.axis === 'record') return { v: 'up', word: 'record' };
  return badge.verdict === 'battu' ? { v: 'up', word: 'battue' } : { v: 'eq', word: 'égalée' };
}

const cell = (n: number) => `${formatWeight(n)}`;

/** La bande défile au-delà de 4 cases ; la série en cours reste en vue. */
function useKeepInView(current: number, slots: number) {
  const band = useRef<HTMLOListElement>(null);
  useLayoutEffect(() => {
    const el = band.current;
    const first = el?.children[Math.max(0, current - 3)] as HTMLElement | undefined;
    if (!el || !first) return;
    el.scrollLeft += first.getBoundingClientRect().left - el.getBoundingClientRect().left - 20;
  }, [current, slots]);
  return band;
}

function Underline({ state }: { state: 'current' | 'logged' | 'empty' }) {
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute bottom-0 left-0 right-2 ${
        state === 'current' ? 'h-[3px] bg-ink' : state === 'logged' ? 'h-px bg-muted' : 'h-px bg-line'
      }`}
    />
  );
}

export function SetBand({
  sets,
  badges,
  draft,
  plannedMax,
}: {
  sets: PerformedSet[];
  badges: SetBadge[];
  draft: Draft;
  plannedMax: number;
}) {
  const slots = Math.max(plannedMax, sets.length + 1);
  const scroll = slots > 4;
  const band = useKeepInView(sets.length, slots);
  return (
    <ol ref={band} className={`flex px-5 ${scroll ? 'overflow-x-auto' : ''}`} style={{ scrollbarWidth: 'none' }} aria-label="Séries de cet exo">
      {Array.from({ length: slots }, (_, i) => {
        const rank = i + 1;
        const s = sets[i];
        const isCurrent = i === sets.length;
        const st = s ? badgeStatus(badges[i] ?? null) : null;
        const label = s
          ? `Série ${rank}, ${formatWeight(s.weightKg)} × ${s.reps} · RIR ${s.rir}${st ? `, ${st.word}` : ''}`
          : isCurrent
            ? `Série ${rank} en cours, ${formatWeight(draft.weightKg)} × ${draft.reps} · RIR ${draft.rir}`
            : `Série ${rank}, à faire`;
        return (
          <li key={rank} aria-label={label} className="relative min-w-0 pb-2 pr-2" style={{ flex: scroll ? '0 0 25%' : '1 1 0' }}>
            <span aria-hidden className="flex h-[18px] items-center gap-2 text-[13px]">
              <span className={`tnum ${isCurrent ? 'font-semibold text-ink' : 'text-faint'}`}>{rank}</span>
              {st && <Status v={st.v} word={st.word} />}
              {!s && isCurrent && <span className="text-muted">en cours</span>}
              {!s && !isCurrent && i >= plannedMax && <span className="text-faint">en plus</span>}
            </span>
            <span
              aria-hidden
              className={`tnum mt-1 block whitespace-nowrap text-[16px] font-medium tracking-[-0.01em] ${s ? 'text-ink' : isCurrent ? 'text-muted' : 'text-faint'}`}
            >
              {s ? cell(s.weightKg) : isCurrent ? cell(draft.weightKg) : '·'}
            </span>
            <span aria-hidden className={`tnum block whitespace-nowrap text-[13px] ${s ? 'text-muted' : 'text-faint'}`}>
              {s ? `×${s.reps} · RIR ${s.rir}` : isCurrent ? `×${draft.reps} · RIR ${draft.rir}` : ' '}
            </span>
            <Underline state={isCurrent ? 'current' : s ? 'logged' : 'empty'} />
          </li>
        );
      })}
    </ol>
  );
}

const SIDES: { side: Side; letter: string }[] = [
  { side: 'left', letter: 'G' },
  { side: 'right', letter: 'D' },
];

/** Bande d'un exo unilatéral : chaque série tient sur deux demi-lignes, G puis
 *  D, valeurs et signe PAR CÔTÉ. Une série n'est complète qu'avec ses deux côtés. */
export function UniSetBand({
  sets,
  badges,
  draft,
  side,
  plannedMax,
}: {
  sets: PerformedSet[];
  badges: SetBadge[];
  draft: Draft;
  side: Side;
  plannedMax: number;
}) {
  const pairs = pairSidesByOrder(sets);
  const done = pairs.filter((p) => p.left !== null && p.right !== null).length;
  const slots = Math.max(plannedMax, done + 1);
  const scroll = slots > 4;
  const band = useKeepInView(done, slots);
  const badgeOf = (s: PerformedSet | null) => (s ? badgeStatus(badges[sets.indexOf(s)] ?? null) : null);
  return (
    <ol ref={band} className={`flex px-5 ${scroll ? 'overflow-x-auto' : ''}`} style={{ scrollbarWidth: 'none' }} aria-label="Séries de cet exo, gauche et droite">
      {Array.from({ length: slots }, (_, i) => {
        const rank = i + 1;
        const p = pairs[i];
        const isCurrent = i === done;
        const parts = SIDES.map(({ side: sd, letter }) => {
          const s = p ? (sd === 'left' ? p.left : p.right) : null;
          return { sd, letter, s, st: badgeOf(s), live: isCurrent && !s && sd === side };
        });
        const label = `Série ${rank}${isCurrent ? ' en cours' : ''}, ${parts
          .map(({ sd, s, st }) => `${sd === 'left' ? 'gauche' : 'droite'} ${s ? `${formatWeight(s.weightKg)} × ${s.reps}${st ? `, ${st.word}` : ''}` : 'à faire'}`)
          .join(', ')}`;
        return (
          <li key={rank} aria-label={label} className="relative min-w-0 pb-2 pr-2" style={{ flex: scroll ? '0 0 25%' : '1 1 0' }}>
            <span aria-hidden className="flex h-[18px] items-center gap-2 text-[13px]">
              <span className={`tnum ${isCurrent ? 'font-semibold text-ink' : 'text-faint'}`}>{rank}</span>
              {isCurrent && <span className="text-muted">en cours</span>}
              {!isCurrent && !p && i >= plannedMax && <span className="text-faint">en plus</span>}
            </span>
            {parts.map(({ sd, letter, s, st, live }) => (
              <span key={sd} aria-hidden className="mt-0.5 flex h-[19px] min-w-0 items-center gap-1 whitespace-nowrap">
                <span className={`w-2.5 flex-none text-[13px] ${live ? 'font-semibold text-ink' : 'text-faint'}`}>{letter}</span>
                {/* Jamais tronquée : un poids long (« 22,75×12 ») descend à 13 px. */}
                <span
                  className={`tnum whitespace-nowrap font-medium tracking-[-0.02em] ${s ? 'text-ink' : live ? 'text-muted' : 'text-faint'} ${
                    (s ?? (live ? draft : null)) && `${cell((s ?? draft).weightKg)}×${(s ?? draft).reps}`.length > 7 ? 'text-[13px]' : 'text-[14px]'
                  }`}
                >
                  {s ? `${cell(s.weightKg)}×${s.reps}` : live ? `${cell(draft.weightKg)}×${draft.reps}` : '·'}
                </span>
                {st && (
                  <span className={TONE[st.v]}>
                    <Sign v={st.v} size={10} />
                  </span>
                )}
              </span>
            ))}
            <Underline state={isCurrent ? 'current' : p ? 'logged' : 'empty'} />
          </li>
        );
      })}
    </ol>
  );
}
