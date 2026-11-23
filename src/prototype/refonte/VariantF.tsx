// PROTOTYPE JETABLE · variante F « Graphite ».
// Structure et gestes de A « Cadran », à l'identique : le poids se règle sur une
// règle graduée qu'on fait glisser au pouce (crans de 1,25 kg), reps et RIR se
// touchent une fois, l'e1RM et l'écart à la Référence se lisent en direct.
// L'habit change : un appareil de mesure en gris neutres. Pas de couleur
// d'accent, la hiérarchie passe par la valeur (noir, graphites, blanc) et la
// matière (touches à arête nette qui s'enfoncent d'un pixel, fenêtre en creux
// pour la règle). L'aiguille et la sélection sont blanches. Seuls ▲ et ▼ ont
// une couleur, très éteinte, toujours avec leur mot.
// État en mémoire uniquement.
import { useLayoutEffect, useRef, useState } from 'react';
import type { ExercisePlan, SessionFixture } from './fixtures';
import { range } from './fixtures';
import { Analyse } from './VariantF-analyse';
import {
  GraphiteStyle,
  KEY,
  SIGN,
  STEP_KG,
  TONE,
  TopBar,
  WORD_SET,
  fmt1,
  fmtDate,
  fmtKg,
  fmtSigned,
  refAt,
  setE1rm,
  verdict,
  type SetValue,
  type View,
} from './VariantF-shared';

export const name = 'Graphite';

const PX_PER_STEP = 14;
const MAX_STEPS = 400; // 500 kg

interface Draft {
  steps: number; // poids en crans de 1,25 kg
  reps: number;
  rir: number;
}

function seedDraft(ex: ExercisePlan, logged: SetValue[]): Draft {
  const rank = logged.length + 1;
  const ref = refAt(ex, rank);
  const prev = logged[logged.length - 1];
  const base = prev ?? ref ?? ex.reference?.sets[0] ?? null;
  const weightKg = prev?.weightKg ?? base?.weightKg ?? 10;
  return {
    steps: Math.round(weightKg / STEP_KG),
    reps: ref?.reps ?? base?.reps ?? ex.reps[0],
    rir: ref?.rir ?? base?.rir ?? ex.rir[1],
  };
}

function draftValue(d: Draft): SetValue {
  return { weightKg: d.steps * STEP_KG, reps: d.reps, rir: d.rir };
}

type Progress = 'todo' | 'partial' | 'done' | 'skipped';

function progressOf(ex: ExercisePlan, n: number): Progress {
  if (n === 0) return ex.status === 'skipped' ? 'skipped' : 'todo';
  return n >= ex.sets[0] ? 'done' : 'partial';
}

/* ------------------------------------------------------------------------ */
/* Règle graduée, dans une fenêtre en creux à bords nets                       */
/* ------------------------------------------------------------------------ */

function Ruler({ steps, onChange }: { steps: number; onChange: (s: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ x: number; start: number; moved: boolean; last: number } | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const value = drag ?? steps;
  const clamp = (v: number) => Math.min(MAX_STEPS, Math.max(0, v));

  const base = Math.round(value);
  const ticks: number[] = [];
  for (let k = -30; k <= 30; k++) if (base + k >= 0 && base + k <= MAX_STEPS) ticks.push(base + k);

  return (
    <div
      ref={box}
      role="slider"
      tabIndex={0}
      aria-label="Poids"
      aria-valuemin={0}
      aria-valuemax={MAX_STEPS * STEP_KG}
      aria-valuenow={steps * STEP_KG}
      aria-valuetext={`${fmtKg(steps * STEP_KG)} kg`}
      data-ruler
      className="relative mx-4 h-[60px] cursor-grab touch-none select-none overflow-hidden rounded-[8px] border border-[#2e2e2e] bg-[#0a0a0a] active:cursor-grabbing"
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          e.stopPropagation();
          onChange(clamp(steps + (e.key === 'ArrowRight' ? 1 : -1)));
        }
      }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        gesture.current = { x: e.clientX, start: steps, moved: false, last: steps };
      }}
      onPointerMove={(e) => {
        const g = gesture.current;
        if (!g) return;
        const dx = e.clientX - g.x;
        if (!g.moved && Math.abs(dx) < 4) return;
        g.moved = true;
        const v = clamp(g.start - dx / PX_PER_STEP);
        g.last = v;
        setDrag(v);
        const snapped = Math.round(v);
        if (snapped !== steps) onChange(snapped);
      }}
      onPointerUp={(e) => {
        const g = gesture.current;
        gesture.current = null;
        if (!g) return;
        if (!g.moved) {
          // Toucher la règle sans glisser : saute au cran touché.
          const r = box.current!.getBoundingClientRect();
          onChange(clamp(Math.round(steps + (e.clientX - (r.left + r.width / 2)) / PX_PER_STEP)));
        } else {
          onChange(Math.round(g.last));
        }
        setDrag(null);
      }}
      onPointerCancel={() => {
        gesture.current = null;
        setDrag(null);
      }}
    >
      {ticks.map((v) => {
        const major = v % 4 === 0; // tous les 5 kg
        const mid = v % 2 === 0; // tous les 2,5 kg
        const off = (v - value) * PX_PER_STEP;
        return (
          <div
            key={v}
            className="absolute top-0 flex flex-col items-center"
            style={{
              left: `calc(50% + ${off}px)`,
              transform: 'translateX(-50%)',
              transition: drag === null ? 'left 180ms var(--ease-out-quart)' : 'none',
            }}
          >
            <div
              className={major ? 'bg-[#a8a8a8]' : mid ? 'bg-[#7a7a7a]' : 'bg-[#636363]'}
              style={{ width: major ? 2 : 1, height: major ? 24 : mid ? 16 : 10 }}
            />
            {/* Libellé masqué sous l'aiguille (la valeur se lit au-dessus) et
                contre les bords, où la fenêtre le couperait. */}
            {major && (
              <span
                className="mt-1.5 text-[12px] text-[#8f8f8f]"
                style={{ visibility: Math.abs(off) < 16 || Math.abs(off) > 150 ? 'hidden' : 'visible' }}
              >
                {fmtKg(v * STEP_KG)}
              </span>
            )}
          </div>
        );
      })}
      {/* Aiguille fixe, blanche, sur toute la hauteur de la fenêtre : c'est la
          règle qui bouge. */}
      <div className="pointer-events-none absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 bg-[#ffffff]" />
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Rangées de numéros (reps, RIR) : une barre de touches                      */
/* ------------------------------------------------------------------------ */

function NumberRow({
  label,
  values,
  value,
  presc,
  refValue,
  onPick,
  scrollTo,
  perView,
}: {
  label: string;
  values: number[];
  value: number;
  presc: [number, number];
  refValue: number | null;
  onPick: (n: number) => void;
  /** Première valeur visible à l'ouverture (rangée défilante). */
  scrollTo?: number;
  perView: number;
}) {
  const row = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = row.current;
    if (!el || scrollTo === undefined) return;
    const i = values.indexOf(scrollTo);
    el.scrollLeft = (Math.max(0, i) * el.clientWidth) / perView;
  }, [scrollTo, values, perView]);

  return (
    <div>
      <div className="flex items-baseline justify-between px-4">
        <span className="text-[13px] font-medium text-[#ededed]">{label}</span>
        <span className="text-[12px] text-[#a8a8a8]">
          plan {range(presc)}
          {refValue !== null && <span className="text-[#8f8f8f]"> · réf. {refValue}</span>}
        </span>
      </div>
      {/* Les cases du plan sont des touches en relief ; hors plan, elles restent
          en creux. La sélection s'inverse en blanc. Le cran en haut marque la
          valeur de la Référence. */}
      <div
        ref={row}
        className="mx-4 mt-2 flex overflow-x-auto rounded-[8px] border border-[#3a3a3a] bg-[#0a0a0a]"
        style={{ scrollbarWidth: 'none', scrollSnapType: 'x mandatory' }}
        role="radiogroup"
        aria-label={label}
      >
        {values.map((n, i) => {
          const sel = n === value;
          const inPlan = n >= presc[0] && n <= presc[1];
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={sel}
              onClick={() => onPick(n)}
              className={`group relative h-[52px] flex-none ${i > 0 ? 'border-l border-[#2a2a2a]' : ''}`}
              style={{ flexBasis: `${100 / perView}%`, scrollSnapAlign: 'start' }}
            >
              <span
                className={`flex h-full items-center justify-center text-[21px] transition-transform duration-75 group-active:translate-y-px ${
                  sel
                    ? 'bg-[#262626] font-semibold text-[#ffffff]'
                    : inPlan
                      ? 'bg-[#1c1c1c] text-[#ededed] group-active:bg-[#151515]'
                      : 'text-[#8f8f8f] group-active:bg-[#050505]'
                }`}
              >
                {n}
              </span>
              {inPlan && !sel && <span aria-hidden className="absolute inset-x-0 bottom-0 h-[2px] bg-[#7a7a7a]" />}
              {/* Sélection : cadre blanc net de 2 px, sans aplat, pour que la
                  touche de log reste la seule grande surface claire. */}
              {sel && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 border-2 border-[#ffffff] transition-transform duration-75 group-active:translate-y-px"
                />
              )}
              {refValue === n && (
                <span
                  aria-hidden
                  className={`absolute left-1/2 h-[3px] w-3 -translate-x-1/2 bg-[#a8a8a8] ${sel ? 'top-[2px]' : 'top-0'}`}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const REPS = Array.from({ length: 30 }, (_, i) => i + 1);
const RIRS = [0, 1, 2, 3, 4, 5];

function repsWindowStart([lo, hi]: [number, number]): number {
  let start = Math.max(1, lo - 2);
  if (hi > start + 7) start = hi - 7;
  return start;
}

/* ------------------------------------------------------------------------ */
/* Salle                                                                      */
/* ------------------------------------------------------------------------ */

function SetBand({ ex, logged, draft }: { ex: ExercisePlan; logged: SetValue[]; draft: SetValue }) {
  const slots = Math.max(ex.sets[1], logged.length + 1);
  const scroll = slots > 5;
  return (
    <ol
      className={`flex px-4 ${scroll ? 'overflow-x-auto' : ''}`}
      style={{ scrollbarWidth: 'none' }}
      aria-label="Séries de cet exo"
    >
      {Array.from({ length: slots }, (_, i) => {
        const rank = i + 1;
        const s = logged[i];
        const isCurrent = i === logged.length;
        const ref = refAt(ex, rank);
        const v = s && ref ? verdict(setE1rm(s), setE1rm(ref)) : null;
        return (
          <li
            key={rank}
            className="relative min-w-0 pb-2.5 pr-2 pt-1"
            style={{ flex: scroll ? '0 0 22%' : '1 1 0' }}
          >
            <div className="flex items-baseline gap-1.5 whitespace-nowrap text-[11px]">
              <span className={isCurrent ? 'font-semibold text-[#ffffff]' : 'text-[#8f8f8f]'}>{rank}</span>
              {v && (
                <span className={TONE[v]}>
                  {SIGN[v]} {WORD_SET[v]}
                </span>
              )}
              {i >= ex.sets[1] && !v && <span className="text-[#8f8f8f]">en plus</span>}
            </div>
            <div
              className={`mt-0.5 truncate text-[15px] ${
                s ? 'text-[#ededed]' : isCurrent ? 'text-[#a8a8a8]' : 'text-[#8f8f8f]'
              }`}
            >
              {s
                ? `${fmtKg(s.weightKg)} × ${s.reps}`
                : isCurrent
                  ? `${fmtKg(draft.weightKg)} × ${draft.reps}`
                  : '·'}
            </div>
            <div className="text-[11px] text-[#8f8f8f]">
              {s ? `RIR ${s.rir}` : isCurrent ? `RIR ${draft.rir}` : ' '}
            </div>
            <span
              className={`absolute bottom-0 left-0 right-2 ${
                isCurrent ? 'h-[2px] bg-[#ffffff]' : s ? 'h-[2px] bg-[#7a7a7a]' : 'h-px bg-[#2e2e2e]'
              }`}
            />
          </li>
        );
      })}
    </ol>
  );
}

function ExerciseIndex({
  exercises,
  counts,
  current,
  onPick,
}: {
  exercises: ExercisePlan[];
  counts: number[];
  current: number;
  onPick: (i: number) => void;
}) {
  return (
    <div className="grid grid-cols-5 gap-2 px-4" role="tablist" aria-label="Exercices de la séance">
      {exercises.map((ex, i) => {
        const p = progressOf(ex, counts[i] ?? 0);
        const fill = Math.min(1, (counts[i] ?? 0) / ex.sets[0]);
        const active = i === current;
        return (
          <button
            key={ex.id}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={`${i + 1}. ${ex.name}${p === 'skipped' ? ', passé' : p === 'done' ? ', fait' : ''}`}
            onClick={() => onPick(i)}
            className="flex h-11 flex-col justify-center transition-transform duration-75 active:translate-y-px"
          >
            <span
              className={`text-left text-[13px] ${
                active ? 'font-semibold text-[#ffffff]' : 'text-[#a8a8a8]'
              }`}
            >
              {i + 1}
              {p === 'skipped' && <span className="ml-1 text-[11px] text-[#8f8f8f]">passé</span>}
            </span>
            {/* Jauge de l'exo : la longueur dit combien de séries sont faites. */}
            {p === 'skipped' ? (
              <span className="mt-1.5 block h-[3px] w-full border-t-[3px] border-dashed border-[#7a7a7a]" />
            ) : (
              <span className="relative mt-1.5 block h-[3px] w-full bg-[#2a2a2a]">
                <span
                  className={`absolute inset-y-0 left-0 ${active ? 'bg-[#ffffff]' : 'bg-[#8f8f8f]'}`}
                  style={{ width: `${fill * 100}%` }}
                />
                {active && fill === 0 && <span className="absolute inset-y-0 left-0 w-1.5 bg-[#ffffff]" />}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function ExerciseHeader({
  ex,
  next,
  onSwipe,
}: {
  ex: ExercisePlan;
  next: ExercisePlan | null;
  onSwipe: (dir: 1 | -1) => void;
}) {
  const g = useRef<{ x: number } | null>(null);
  const [dx, setDx] = useState(0);
  return (
    <div
      className="relative touch-pan-y select-none overflow-hidden px-4 pt-3"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        g.current = { x: e.clientX };
      }}
      onPointerMove={(e) => {
        if (g.current) setDx(e.clientX - g.current.x);
      }}
      onPointerUp={() => {
        if (Math.abs(dx) > 56) onSwipe(dx < 0 ? 1 : -1);
        g.current = null;
        setDx(0);
      }}
      onPointerCancel={() => {
        g.current = null;
        setDx(0);
      }}
    >
      <div
        className="flex items-baseline gap-5 whitespace-nowrap"
        style={{
          transform: `translateX(${dx * 0.6}px)`,
          transition: dx === 0 ? 'transform 200ms var(--ease-out-quart)' : 'none',
        }}
      >
        <h1 className="text-[28px] font-semibold leading-[1.15] tracking-[-0.02em] text-[#ededed]">{ex.name}</h1>
        {next && (
          <span aria-hidden className="text-[28px] font-semibold leading-[1.15] tracking-[-0.02em] text-[#666666]">
            {next.name}
          </span>
        )}
      </div>
      <p className="mt-1 text-[13px] text-[#a8a8a8]">
        {range(ex.sets)} séries · {range(ex.reps)} reps · RIR {range(ex.rir)}
      </p>
    </div>
  );
}

function Salle({
  session,
  idx,
  setIdx,
  logged,
  drafts,
  setDraft,
  onLog,
  onUndo,
  undoable,
}: {
  session: SessionFixture;
  idx: number;
  setIdx: (i: number) => void;
  logged: Record<string, SetValue[]>;
  drafts: Record<string, Draft>;
  setDraft: (id: string, d: Draft) => void;
  onLog: () => void;
  onUndo: () => void;
  undoable: boolean;
}) {
  const ex = session.exercises[idx]!;
  const sets = logged[ex.id] ?? [];
  const draft = drafts[ex.id] ?? seedDraft(ex, sets);
  const dv = draftValue(draft);
  const rank = sets.length + 1;
  const ref = refAt(ex, rank);
  const e1 = setE1rm(dv);
  const v = ref ? verdict(e1, setE1rm(ref)) : null;
  const best = Math.max(ex.pr?.e1rm ?? 0, ...sets.map(setE1rm));
  const isRecord = best > 0 && e1 > best;
  const counts = session.exercises.map((e) => (logged[e.id] ?? []).length);
  const update = (patch: Partial<Draft>) => setDraft(ex.id, { ...draft, ...patch });
  const go = (i: number) => setIdx(Math.min(session.exercises.length - 1, Math.max(0, i)));
  const extra = rank > ex.sets[1];
  const kgText = fmtKg(dv.weightKg);

  return (
    <>
      <div className="flex flex-1 flex-col">
        <ExerciseIndex exercises={session.exercises} counts={counts} current={idx} onPick={go} />
        <ExerciseHeader ex={ex} next={session.exercises[idx + 1] ?? null} onSwipe={(d) => go(idx + d)} />

        <div className="mt-3">
          <SetBand ex={ex} logged={sets} draft={dv} />
        </div>

        {/* L'instrument */}
        <div className="mt-4 px-4">
          <div className="flex items-baseline justify-between gap-3 text-[13px]">
            {ref ? (
              <>
                <span className="text-[#a8a8a8]">
                  Référence série {rank} · {fmtDate(ex.reference!.date)}
                </span>
                <span className="text-[#ededed]">
                  {fmtKg(ref.weightKg)} × {ref.reps} · RIR {ref.rir}
                </span>
              </>
            ) : (
              <span className="text-[#a8a8a8]">
                {ex.reference
                  ? `Pas de série ${rank} la dernière fois, rien à battre`
                  : `Pas encore de Référence dans ${session.seanceName}`}
              </span>
            )}
          </div>
        </div>

        {/* La virgule tombe pile au-dessus de l'aiguille : la partie entière
            s'aligne à droite du centre, les décimales à gauche. Rien ne saute. */}
        <output aria-live="polite" className="mt-2 flex items-baseline leading-none">
          <span className="w-1/2 text-right text-[72px] font-medium tracking-[-0.04em] text-[#ffffff]">
            {Math.trunc(dv.weightKg)}
          </span>
          <span className="w-1/2 text-left">
            <span className="text-[72px] font-medium tracking-[-0.04em] text-[#ffffff]">
              {kgText.includes(',') ? `,${kgText.split(',')[1]}` : ''}
            </span>
            <span className="ml-1.5 text-[20px] text-[#a8a8a8]">kg</span>
          </span>
        </output>

        <div className="mt-3">
          <Ruler steps={draft.steps} onChange={(s) => update({ steps: s })} />
        </div>

        <dl className="mt-3 grid grid-cols-3 gap-3 px-4">
          <div>
            <dt className="text-[12px] text-[#a8a8a8]">e1RM</dt>
            <dd className="mt-0.5 text-[20px] font-medium text-[#ededed]">{fmt1(e1)}</dd>
          </div>
          <div>
            <dt className="text-[12px] text-[#a8a8a8]">Écart à la réf.</dt>
            <dd className="mt-0.5">
              {ref && v ? (
                <span className={TONE[v]}>
                  <span className="block text-[20px] font-medium">
                    {SIGN[v]} {fmtSigned(Math.round((e1 - setE1rm(ref)) * 10) / 10)}
                  </span>
                  <span className="block text-[12px]">
                    {v === 'up' ? 'au-dessus' : v === 'eq' ? 'à égalité' : 'en dessous'}
                  </span>
                </span>
              ) : (
                <span className="block pt-1 text-[15px] text-[#a8a8a8]">aucune réf.</span>
              )}
            </dd>
          </div>
          <div className="text-right">
            <dt className="text-[12px] text-[#a8a8a8]">Record</dt>
            <dd className="mt-0.5">
              {isRecord ? (
                <span className="text-[#95b49f]">
                  <span className="block text-[20px] font-medium">▲ {fmt1(e1)}</span>
                  <span className="block text-[12px]">nouveau record</span>
                </span>
              ) : best > 0 ? (
                <>
                  <span className="block text-[20px] font-medium text-[#a8a8a8]">{fmt1(best)}</span>
                  <span className="block text-[12px] text-[#8f8f8f]">à battre</span>
                </>
              ) : (
                <span className="block pt-1 text-[15px] text-[#a8a8a8]">aucun</span>
              )}
            </dd>
          </div>
        </dl>

        <div className="mt-4 flex flex-col gap-3">
          <NumberRow
            key={`reps-${ex.id}`}
            label="Reps"
            values={REPS}
            value={draft.reps}
            presc={ex.reps}
            refValue={ref?.reps ?? null}
            onPick={(n) => update({ reps: n })}
            scrollTo={repsWindowStart(ex.reps)}
            perView={8}
          />
          <NumberRow
            key={`rir-${ex.id}`}
            label="RIR"
            values={RIRS}
            value={draft.rir}
            presc={ex.rir}
            refValue={ref?.rir ?? null}
            onPick={(n) => update({ rir: n })}
            perView={6}
          />
        </div>
      </div>

      {/* Action unique au pouce : la touche la plus grande et la plus claire de
          l'écran. Le dégagement bas laisse la place à la barre de bascule du
          prototype (et à l'indicateur d'accueil iOS). */}
      <div className="sticky bottom-0 z-10 mt-3 flex gap-2 border-t border-[#232323] bg-[#111111] px-4 pb-[60px] pt-2">
        {undoable && (
          <button type="button" onClick={onUndo} className={`h-14 flex-none px-3.5 text-[15px] ${KEY}`}>
            Annuler
          </button>
        )}
        <button
          type="button"
          onClick={onLog}
          className="flex h-14 min-w-0 flex-1 items-center justify-between gap-2 rounded-[10px] border border-[#f5f5f5] bg-[#e8e8e8] px-4 text-[#111111] transition-[transform,background-color] duration-75 active:translate-y-px active:border-[#d9d9d9] active:bg-[#cfcfcf]"
        >
          <span className="truncate text-[17px] font-semibold">
            {extra ? 'Logger une série en plus' : `Logger la série ${rank}`}
          </span>
          <span className="flex flex-none flex-col items-end leading-tight text-[#4d4d4d]">
            <span className="text-[15px]">
              {kgText} × {dv.reps}
            </span>
            <span className="text-[12px]">RIR {dv.rir}</span>
          </span>
        </button>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------------ */
/* Racine                                                                     */
/* ------------------------------------------------------------------------ */

export function VariantF({ session }: { session: SessionFixture }) {
  const [view, setView] = useState<View>('salle');
  const [idx, setIdx] = useState(() => Math.max(0, session.exercises.findIndex((e) => e.status === 'in-progress')));
  const [logged, setLogged] = useState<Record<string, SetValue[]>>(() =>
    Object.fromEntries(
      session.exercises.map((e) => [e.id, e.loggedToday.map(({ weightKg, reps, rir }) => ({ weightKg, reps, rir }))]),
    ),
  );
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [lastLog, setLastLog] = useState<string | null>(null);
  const [analyseId, setAnalyseId] = useState<string>(session.exercises[idx]!.id);

  const ex = session.exercises[idx]!;
  const setDraft = (id: string, d: Draft) => setDrafts((m) => ({ ...m, [id]: d }));

  const onLog = () => {
    const sets = logged[ex.id] ?? [];
    const d = drafts[ex.id] ?? seedDraft(ex, sets);
    const next = [...sets, draftValue(d)];
    setLogged((m) => ({ ...m, [ex.id]: next }));
    const ref = refAt(ex, next.length + 1);
    setDraft(ex.id, { steps: d.steps, reps: ref?.reps ?? d.reps, rir: ref?.rir ?? d.rir });
    setLastLog(ex.id);
  };

  const onUndo = () => {
    const sets = logged[ex.id] ?? [];
    const popped = sets[sets.length - 1];
    if (!popped) return;
    setLogged((m) => ({ ...m, [ex.id]: sets.slice(0, -1) }));
    setDraft(ex.id, { steps: Math.round(popped.weightKg / STEP_KG), reps: popped.reps, rir: popped.rir });
    setLastLog(null);
  };

  const changeView = (v: View) => {
    if (v === 'analyse') setAnalyseId(ex.id); // l'Analyse s'ouvre sur l'exo de l'instrument
    setView(v);
  };

  const done = Object.values(logged).reduce((n, s) => n + s.length, 0);

  return (
    <div data-graphite className="flex min-h-[100dvh] flex-1 flex-col bg-[#111111] text-[#ededed] sm:min-h-full">
      <GraphiteStyle />
      <TopBar
        view={view}
        onView={changeView}
        left={
          view === 'salle' ? (
            <>
              <span className="text-[#ededed]">{session.seanceName}</span>
              <span> · {session.elapsedMin} min · {done} séries</span>
            </>
          ) : (
            <span>{session.routineName}</span>
          )
        }
      />
      {view === 'salle' ? (
        <Salle
          session={session}
          idx={idx}
          setIdx={(i) => {
            setIdx(i);
            setLastLog(null);
          }}
          logged={logged}
          drafts={drafts}
          setDraft={setDraft}
          onLog={onLog}
          onUndo={onUndo}
          undoable={lastLog === ex.id}
        />
      ) : (
        <Analyse session={session} selectedId={analyseId} onSelect={setAnalyseId} />
      )}
    </div>
  );
}
