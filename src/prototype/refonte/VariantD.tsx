// PROTOTYPE JETABLE · variante D « Papier ». Structure et gestes de A « Cadran »
// à l'identique (règle graduée au pouce, rangées de numéros en un tap, bande des
// séries, index et balayage du nom, Analyse du même exo), rhabillés en mode
// clair : une page imprimée. Papier blanc cassé, encre quasi noire, aucune
// couleur d'accent ; l'aiguille, la sélection et le bouton sont à l'encre. Seuls
// les statuts ont une couleur, foncée, toujours avec le signe et le mot.
// Pari : un écran clair à fort contraste se lit mieux sous les néons d'une salle
// qu'un écran sombre teinté, et casse le cliché « sombre + violet ».
// État en mémoire uniquement.
import { useLayoutEffect, useRef, useState } from 'react';
import type { ExercisePlan, SessionFixture } from './fixtures';
import { range } from './fixtures';
import { Analyse } from './VariantD-analyse';
import {
  GHOST,
  PAPER_VARS,
  SIGN,
  STEP_KG,
  TONE,
  TopBar,
  WORD,
  fmt1,
  fmtDate,
  fmtKg,
  fmtSigned,
  refAt,
  setE1rm,
  verdict,
  type SetValue,
  type View,
} from './VariantD-shared';

export const name = 'Papier';

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
/* Réglet                                                                     */
/* ------------------------------------------------------------------------ */

const RULE_TOP = 12; // bord du réglet, d'où pendent les graduations

function Ruler({ steps, onChange }: { steps: number; onChange: (s: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ x: number; start: number; moved: boolean; last: number } | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [half, setHalf] = useState(195);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHalf(el.clientWidth / 2));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const value = drag ?? steps;
  const clamp = (v: number) => Math.min(MAX_STEPS, Math.max(0, v));
  const slide = drag === null ? 'left 180ms var(--ease-out-quart)' : 'none';

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
      className="relative h-[56px] cursor-grab touch-none select-none overflow-hidden outline-offset-4 active:cursor-grabbing"
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
          // Toucher le réglet sans glisser : saute au cran touché.
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
      {/* Bord du réglet : un filet d'encre plein, qui commence au zéro. */}
      <div
        className="pointer-events-none absolute right-0 h-px bg-ink"
        style={{ top: RULE_TOP, left: Math.max(0, half - value * PX_PER_STEP), transition: slide }}
      />
      {ticks.map((v) => {
        const major = v % 4 === 0; // tous les 5 kg
        const mid = v % 2 === 0; // tous les 2,5 kg
        const off = (v - value) * PX_PER_STEP;
        return (
          <div
            key={v}
            className="pointer-events-none absolute flex flex-col items-center"
            style={{
              top: RULE_TOP,
              left: `calc(50% + ${off}px)`,
              transform: 'translateX(-50%)',
              transition: slide,
            }}
          >
            <div
              className={major || mid ? 'bg-ink' : 'bg-hair-strong'}
              style={{ width: 1, height: major ? 18 : mid ? 11 : 6 }}
            />
            {/* Un chiffre coupé par le bord fait brouillon : il ne s'imprime qu'entier. */}
            {major && Math.abs(off) <= half - 16 && (
              <span className="mt-1.5 text-[11px] leading-none text-ink-muted">{fmtKg(v * STEP_KG)}</span>
            )}
          </div>
        );
      })}
      {/* Index fixe : un trait d'encre qui déborde au-dessus du bord, coiffé d'un
          cran triangulaire. C'est le réglet qui bouge, pas l'index. */}
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2">
        <div
          className="mx-auto h-0 w-0"
          style={{
            borderLeft: '6px solid transparent',
            borderRight: '6px solid transparent',
            borderTop: '7px solid var(--color-ink)',
          }}
        />
        <div className="mx-auto h-[28px] w-[2px] bg-ink" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Rangées de numéros (reps, RIR)                                             */
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
      <div className="flex items-baseline justify-between px-5">
        <span className="text-[14px] font-semibold text-ink">{label}</span>
        <span className="text-[13px] text-ink-muted">
          plan {range(presc)}
          {refValue !== null && <> · réf. {refValue}</>}
        </span>
      </div>
      <div
        ref={row}
        className="mx-4 mt-0.5 flex overflow-x-auto"
        style={{ scrollbarWidth: 'none', scrollSnapType: 'x mandatory' }}
        role="radiogroup"
        aria-label={label}
      >
        {values.map((n) => {
          const sel = n === value;
          const inPlan = n >= presc[0] && n <= presc[1];
          const isRef = refValue === n;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={sel}
              aria-label={`${n}${isRef ? ', valeur de la Référence' : ''}`}
              onClick={() => onPick(n)}
              className="relative h-[54px] flex-none pb-[7px] pt-[7px]"
              style={{ flexBasis: `${100 / perView}%`, scrollSnapAlign: 'start' }}
            >
              <span
                className={`mx-[2px] flex h-full items-center justify-center rounded-[3px] text-[22px] ${
                  sel
                    ? 'bg-ink font-semibold text-on-accent'
                    : inPlan
                      ? 'font-medium text-ink active:bg-surface'
                      : 'text-ink-faint active:bg-surface'
                }`}
              >
                {n}
              </span>
              {/* Valeur de la Référence : un point d'encre au-dessus du numéro. */}
              {isRef && <span aria-hidden className="absolute left-1/2 top-0 h-[4px] w-[4px] -translate-x-1/2 bg-ink" />}
              {/* Fourchette du plan : une accolade plate sous les numéros prescrits. */}
              {inPlan && (
                <span aria-hidden className="absolute inset-x-0 bottom-0 h-px bg-ink">
                  {n === presc[0] && <span className="absolute bottom-0 left-0 h-[5px] w-px bg-ink" />}
                  {n === presc[1] && <span className="absolute bottom-0 right-0 h-[5px] w-px bg-ink" />}
                </span>
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
      className={`flex px-5 ${scroll ? 'overflow-x-auto' : ''}`}
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
            className="relative min-w-0 pb-2 pr-2 pt-1"
            style={{ flex: scroll ? '0 0 22%' : '1 1 0' }}
          >
            <div className="flex items-baseline gap-1.5 text-[11px]">
              <span className={isCurrent ? 'font-semibold text-ink' : 'text-ink-faint'}>{rank}</span>
              {v && (
                <span className={`truncate ${TONE[v]}`}>
                  {SIGN[v]} {WORD[v]}
                </span>
              )}
              {isCurrent && !s && <span className="text-ink">en cours</span>}
              {i >= ex.sets[1] && !isCurrent && <span className="text-ink-faint">en plus</span>}
            </div>
            <div
              className={`mt-0.5 truncate text-[16px] ${
                s ? 'font-medium text-ink' : isCurrent ? 'text-ink-muted' : 'text-ink-faint'
              }`}
            >
              {s
                ? `${fmtKg(s.weightKg)} × ${s.reps}`
                : isCurrent
                  ? `${fmtKg(draft.weightKg)} × ${draft.reps}`
                  : '·'}
            </div>
            <div className="text-[11px] text-ink-faint">
              {s ? `RIR ${s.rir}` : isCurrent ? `RIR ${draft.rir}` : ' '}
            </div>
            <span
              className={`absolute bottom-0 left-0 right-2 ${
                isCurrent ? 'h-[2px] bg-ink' : s ? 'h-px bg-ink-muted' : 'h-px bg-hair'
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
    <div className="grid grid-cols-5 px-3" role="tablist" aria-label="Exercices de la séance">
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
            className="flex h-11 flex-col justify-center px-2"
          >
            <span
              className={`text-left text-[13px] ${
                active ? 'font-semibold text-ink' : p === 'skipped' ? 'text-warn' : 'text-ink-muted'
              }`}
            >
              {i + 1}
              {p === 'skipped' && <span className="ml-1 text-[11px]">passé</span>}
            </span>
            {/* Jauge de l'exo : la longueur dit combien de séries sont faites. */}
            {p === 'skipped' ? (
              <span className="mt-1.5 block w-full border-t-2 border-dashed border-warn" />
            ) : (
              <span className="relative mt-1.5 block h-[3px] w-full bg-hair">
                <span
                  className={`absolute inset-y-0 left-0 ${active ? 'bg-ink' : 'bg-hair-strong'}`}
                  style={{ width: `${fill * 100}%` }}
                />
                {active && fill === 0 && <span className="absolute inset-y-0 left-0 w-1.5 bg-ink" />}
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
      className="relative touch-pan-y select-none overflow-hidden px-5 pt-3"
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
        <h1 className="text-[30px] font-semibold leading-[1.1] tracking-[-0.03em] text-ink">{ex.name}</h1>
        {next && (
          <span
            aria-hidden
            className="text-[30px] font-semibold leading-[1.1] tracking-[-0.03em]"
            style={{ color: GHOST }}
          >
            {next.name}
          </span>
        )}
      </div>
      <p className="mt-1.5 text-[13px] text-ink-muted">
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
  const kg = fmtKg(dv.weightKg);

  return (
    <>
      <div className="flex flex-1 flex-col">
        <ExerciseIndex exercises={session.exercises} counts={counts} current={idx} onPick={go} />
        <ExerciseHeader ex={ex} next={session.exercises[idx + 1] ?? null} onSwipe={(d) => go(idx + d)} />

        <div className="mt-3">
          <SetBand ex={ex} logged={sets} draft={dv} />
        </div>

        {/* L'instrument */}
        <div className="mt-4 px-5">
          <div className="flex items-baseline justify-between gap-3 text-[13px]">
            {ref ? (
              <>
                <span className="text-ink-muted">
                  Référence série {rank}, {fmtDate(ex.reference!.date)}
                </span>
                <span className="font-medium text-ink">
                  {fmtKg(ref.weightKg)} × {ref.reps} · RIR {ref.rir}
                </span>
              </>
            ) : (
              <span className="text-ink-muted">
                {ex.reference
                  ? `Pas de série ${rank} la dernière fois, rien à battre`
                  : `Pas encore de Référence dans ${session.seanceName}`}
              </span>
            )}
          </div>
        </div>

        {/* La virgule tombe pile au-dessus de l'index : la partie entière s'aligne
            à droite du centre, les décimales à gauche. Rien ne saute. */}
        <output aria-live="polite" className="mt-1 flex items-baseline leading-none">
          <span className="w-1/2 text-right text-[76px] font-medium tracking-[-0.045em] text-ink">
            {Math.trunc(dv.weightKg)}
          </span>
          <span className="w-1/2 text-left">
            <span className="text-[76px] font-medium tracking-[-0.045em] text-ink">
              {kg.includes(',') ? `,${kg.split(',')[1]}` : ''}
            </span>
            <span className="ml-1.5 text-[20px] text-ink-muted">kg</span>
          </span>
        </output>

        <div className="mt-1">
          <Ruler steps={draft.steps} onChange={(s) => update({ steps: s })} />
        </div>

        <dl className="mx-5 grid grid-cols-3 gap-3 border-t border-hair pt-3">
          <div>
            <dt className="text-[12px] text-ink-muted">e1RM</dt>
            <dd className="mt-0.5 text-[20px] font-medium text-ink">{fmt1(e1)}</dd>
          </div>
          <div>
            <dt className="text-[12px] text-ink-muted">Écart à la réf.</dt>
            <dd className="mt-0.5">
              {ref && v ? (
                <span className={TONE[v]}>
                  <span className="text-[20px] font-medium">
                    {SIGN[v]} {fmtSigned(Math.round((e1 - setE1rm(ref)) * 10) / 10)}
                  </span>
                  <span className="block text-[12px]">{WORD[v]}</span>
                </span>
              ) : (
                <span className="text-[15px] text-ink-muted">aucune réf.</span>
              )}
            </dd>
          </div>
          <div className="text-right">
            <dt className="text-[12px] text-ink-muted">Record</dt>
            <dd className="mt-0.5">
              {isRecord ? (
                <span className="text-good">
                  <span className="text-[20px] font-medium">▲ {fmt1(e1)}</span>
                  <span className="block text-[12px]">nouveau record</span>
                </span>
              ) : best > 0 ? (
                <span className="text-[20px] text-ink-muted">{fmt1(best)}</span>
              ) : (
                <span className="text-[15px] text-ink-muted">aucun</span>
              )}
            </dd>
          </div>
        </dl>

        <div className="mt-4 flex flex-col gap-2">
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

      {/* Action unique au pouce : un bloc d'encre plein. Le dégagement bas laisse
          la place à la barre de bascule du prototype (et à l'indicateur iOS). */}
      <div className="sticky bottom-0 z-10 mt-3 flex items-center gap-3 bg-bg px-5 pb-[60px] pt-2">
        {undoable && (
          <button
            type="button"
            onClick={onUndo}
            className="h-14 flex-none px-1 text-[15px] font-medium text-ink underline decoration-1 underline-offset-[5px] active:text-ink-muted"
          >
            Annuler
          </button>
        )}
        <button
          type="button"
          onClick={onLog}
          className="flex h-14 flex-1 items-center justify-between rounded-[4px] bg-ink px-5 text-on-accent active:bg-[#3A362E]"
        >
          <span className="text-[17px] font-semibold">
            {extra ? 'Logger une série en plus' : `Logger la série ${rank}`}
          </span>
          <span className="text-[16px] text-[#CFCAC0]">
            {kg} × {dv.reps}
          </span>
        </button>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------------ */
/* Racine                                                                     */
/* ------------------------------------------------------------------------ */

export function VariantD({ session }: { session: SessionFixture }) {
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
    // Fond papier posé sur la racine : le cadre parent est sombre.
    <div className="flex min-h-[100dvh] flex-1 flex-col bg-bg text-ink sm:min-h-full" style={PAPER_VARS}>
      <TopBar
        view={view}
        onView={changeView}
        left={
          view === 'salle' ? (
            <>
              <span className="font-medium text-ink">{session.seanceName}</span>
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
