// PROTOTYPE JETABLE · variante E « Signal » : la structure et les gestes de A
// « Cadran », rhabillés. Monochrome chaud (noir chaud, blanc cassé, gris
// chauds) et une seule couleur, le jaune de signalisation, réservée à
// l'aiguille de la règle et au ▲ « mieux que la dernière fois ». Pas de
// violet, pas de lueur, pas de pastille : la hiérarchie tient à la taille et
// à la graisse d'Inter, chiffres tabulaires.
// Gestes inchangés : règle graduée glissée au pouce (crans de 1,25 kg, toucher
// pour sauter), reps et RIR en un tap, balayage du nom pour changer d'exo.
// État en mémoire uniquement.
import { useLayoutEffect, useRef, useState } from 'react';
import type { ExercisePlan, SessionFixture } from './fixtures';
import { range } from './fixtures';
import { Analyse } from './VariantE-analyse';
import {
  FONT,
  PALETTE,
  STEP_KG,
  Sign,
  TONE,
  TopBar,
  fmt1,
  fmtDate,
  fmtKg,
  fmtSigned,
  refAt,
  setE1rm,
  verdict,
  type SetValue,
  type Verdict,
  type View,
} from './VariantE-shared';

export const name = 'Signal';

const PX_PER_STEP = 14;
const MAX_STEPS = 400; // 500 kg

const SET_WORD: Record<Verdict, string> = { up: 'battue', eq: 'égalée', down: 'en deçà' };
const GAP_WORD: Record<Verdict, string> = { up: 'mieux', eq: 'égal', down: 'en deçà' };

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
/* Règle graduée                                                              */
/* ------------------------------------------------------------------------ */

function Ruler({ steps, onChange }: { steps: number; onChange: (s: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ x: number; start: number; moved: boolean; last: number } | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const value = drag ?? steps;
  const clamp = (v: number) => Math.min(MAX_STEPS, Math.max(0, v));

  const base = Math.round(value);
  const ticks: number[] = [];
  // ±13 crans : graduations et étiquettes s'arrêtent avant les bords, rien de coupé.
  for (let k = -13; k <= 13; k++) if (base + k >= 0 && base + k <= MAX_STEPS) ticks.push(base + k);

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
      className="relative h-[62px] cursor-grab touch-none select-none overflow-hidden border-t border-(--e-line) outline-offset-4 active:cursor-grabbing"
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
              className={major ? 'bg-(--e-muted)' : 'bg-(--e-dim)'}
              style={{ width: major ? 2 : 1, height: major ? 30 : mid ? 18 : 11 }}
            />
            {major && <span className="mt-2 text-[13px] text-(--e-faint)">{fmtKg(v * STEP_KG)}</span>}
          </div>
        );
      })}
      {/* L'aiguille, fixe au centre : c'est la règle qui bouge. Elle s'arrête au-dessus
          des étiquettes pour ne jamais barrer un chiffre. Seul trait jaune avec les ▲. */}
      <div className="pointer-events-none absolute left-1/2 top-0 h-[36px] w-[3px] -translate-x-1/2 bg-(--e-sig)" />
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
        <span className="text-[15px] font-semibold text-(--e-ink)">{label}</span>
        <span className="text-[14px] text-(--e-muted)">
          plan {range(presc)}
          {refValue !== null && <span> · réf. {refValue}</span>}
        </span>
      </div>
      <div
        ref={row}
        className="mx-5 mt-1 flex overflow-x-auto"
        style={{ scrollbarWidth: 'none', scrollSnapType: 'x mandatory' }}
        role="radiogroup"
        aria-label={label}
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
              onClick={() => onPick(n)}
              className="relative h-[50px] flex-none"
              style={{ flexBasis: `${100 / perView}%`, scrollSnapAlign: 'start' }}
            >
              <span
                className={`flex h-full items-center justify-center text-[23px] tracking-[-0.01em] ${
                  sel
                    ? 'font-bold text-(--e-ink)'
                    : inPlan
                      ? 'font-normal text-(--e-ink)'
                      : 'font-normal text-(--e-faint)'
                }`}
              >
                {n}
              </span>
              {/* Fourchette du plan : un filet continu sous les valeurs prescrites. */}
              {inPlan && <span className="absolute inset-x-0 bottom-0 h-px bg-(--e-dim)" />}
              {/* Valeur choisie : trait plein épais, pas de fond. */}
              {sel && <span className="absolute inset-x-2 bottom-0 h-[4px] bg-(--e-ink)" />}
              {/* Valeur de la Référence : petit carré en haut. */}
              {refValue === n && (
                <span className="absolute left-1/2 top-1.5 h-[5px] w-[5px] -translate-x-1/2 bg-(--e-muted)" />
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
  if (hi > start + 6) start = hi - 6;
  return start;
}

/* ------------------------------------------------------------------------ */
/* Salle                                                                      */
/* ------------------------------------------------------------------------ */

function SetBand({ ex, logged, draft }: { ex: ExercisePlan; logged: SetValue[]; draft: SetValue }) {
  const slots = Math.max(ex.sets[1], logged.length + 1);
  const scroll = slots > 4;
  const band = useRef<HTMLOListElement>(null);
  // Au-delà de 4 emplacements la bande défile : on garde la série en cours en vue.
  useLayoutEffect(() => {
    // Colonnes en quarts exacts : on aligne la 4ᵉ colonne visible sur la série
    // en cours, aucune colonne n'est coupée au bord.
    const el = band.current;
    const first = el?.children[Math.max(0, logged.length - 3)] as HTMLElement | undefined;
    if (!el || !first) return;
    el.scrollLeft += first.getBoundingClientRect().left - el.getBoundingClientRect().left - 20;
  }, [logged.length, slots]);
  return (
    <ol
      ref={band}
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
            className="relative min-w-0 pb-2.5 pr-2"
            style={{ flex: scroll ? '0 0 25%' : '1 1 0' }}
          >
            <div className="flex h-[18px] items-center gap-2 text-[13px]">
              <span className={isCurrent ? 'font-semibold text-(--e-ink)' : 'text-(--e-faint)'}>{rank}</span>
              {v && (
                <span className={`flex items-center gap-1 ${TONE[v]}`}>
                  <Sign v={v} size={11} />
                  {SET_WORD[v]}
                </span>
              )}
              {!v && isCurrent && <span className="text-(--e-muted)">en cours</span>}
              {i >= ex.sets[1] && !v && !isCurrent && <span className="text-(--e-faint)">en plus</span>}
            </div>
            <div
              className={`mt-1 truncate text-[16px] font-medium tracking-[-0.01em] ${
                s ? 'text-(--e-ink)' : isCurrent ? 'text-(--e-muted)' : 'text-(--e-faint)'
              }`}
            >
              {s ? `${fmtKg(s.weightKg)}×${s.reps}` : isCurrent ? `${fmtKg(draft.weightKg)}×${draft.reps}` : '·'}
            </div>
            <div className="text-[13px] text-(--e-faint)">
              {s ? `RIR ${s.rir}` : isCurrent ? `RIR ${draft.rir}` : ' '}
            </div>
            <span
              className={`absolute bottom-0 left-0 right-2 ${
                isCurrent ? 'h-[3px] bg-(--e-ink)' : s ? 'h-px bg-(--e-muted)' : 'h-px bg-(--e-line)'
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
              className={`text-left text-[14px] ${active ? 'font-semibold text-(--e-ink)' : 'text-(--e-muted)'}`}
            >
              {i + 1}
              {p === 'skipped' && <span className="ml-1.5 text-[13px]">passé</span>}
            </span>
            {/* Jauge de l'exo : la longueur dit combien de séries sont faites. */}
            {p === 'skipped' ? (
              <span className="mt-1.5 block h-[3px] w-full border-t-[3px] border-dashed border-(--e-dim)" />
            ) : (
              <span className="relative mt-1.5 block h-[3px] w-full bg-(--e-line)">
                <span
                  className={`absolute inset-y-0 left-0 ${active ? 'bg-(--e-ink)' : 'bg-(--e-muted)'}`}
                  style={{ width: `${fill * 100}%` }}
                />
                {active && fill === 0 && <span className="absolute inset-y-0 left-0 w-2 bg-(--e-ink)" />}
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
      className="relative touch-pan-y select-none overflow-hidden px-5 pt-2"
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
        className="flex items-baseline gap-6 whitespace-nowrap"
        style={{
          transform: `translateX(${dx * 0.6}px)`,
          transition: dx === 0 ? 'transform 200ms var(--ease-out-quart)' : 'none',
        }}
      >
        <h1 className="text-[32px] font-[650] leading-[1.1] tracking-[-0.03em] text-(--e-ink)">{ex.name}</h1>
        {next && (
          <span aria-hidden className="text-[32px] font-normal leading-[1.1] tracking-[-0.03em] text-(--e-dim)">
            {next.name}
          </span>
        )}
      </div>
      <p className="mt-1.5 text-[15px] text-(--e-muted)">
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
  const todayBest = Math.max(0, ...sets.map(setE1rm));
  const best = Math.max(ex.pr?.e1rm ?? 0, todayBest);
  const bestIsToday = todayBest > (ex.pr?.e1rm ?? 0);
  const isRecord = best > 0 && e1 > best;
  const counts = session.exercises.map((e) => (logged[e.id] ?? []).length);
  const update = (patch: Partial<Draft>) => setDraft(ex.id, { ...draft, ...patch });
  const go = (i: number) => setIdx(Math.min(session.exercises.length - 1, Math.max(0, i)));
  const extra = rank > ex.sets[1];
  const kgStr = fmtKg(dv.weightKg);

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
          <div className="flex items-baseline justify-between gap-3 text-[14px]">
            {ref ? (
              <>
                <span className="text-(--e-muted)">
                  Référence série {rank} · {fmtDate(ex.reference!.date)}
                </span>
                <span className="font-medium text-(--e-ink)">
                  {fmtKg(ref.weightKg)} × {ref.reps} · RIR {ref.rir}
                </span>
              </>
            ) : (
              <span className="text-(--e-muted)">
                {ex.reference
                  ? `Pas de série ${rank} la dernière fois, rien à battre`
                  : `Pas encore de Référence dans ${session.seanceName}`}
              </span>
            )}
          </div>
        </div>

        {/* La virgule tombe pile au-dessus de l'aiguille : la partie entière
            s'aligne à droite du centre, les décimales à gauche. Rien ne saute. */}
        <output aria-live="polite" className="mt-1 flex items-baseline leading-none">
          <span className="w-1/2 text-right text-[80px] font-[650] tracking-[-0.045em] text-(--e-ink)">
            {Math.trunc(dv.weightKg)}
          </span>
          <span className="w-1/2 whitespace-nowrap text-left">
            <span className="text-[80px] font-[650] tracking-[-0.045em] text-(--e-ink)">
              {kgStr.includes(',') ? `,${kgStr.split(',')[1]}` : ''}
            </span>
            <span className="ml-2 text-[22px] font-medium text-(--e-muted)">kg</span>
          </span>
        </output>

        <div className="mt-3">
          <Ruler steps={draft.steps} onChange={(s) => update({ steps: s })} />
        </div>

        <dl className="grid grid-cols-3 gap-3 px-5">
          <div>
            <dt className="text-[13px] text-(--e-muted)">e1RM</dt>
            <dd className="mt-1 text-[22px] font-medium leading-none tracking-[-0.01em] text-(--e-ink)">{fmt1(e1)}</dd>
            <dd className="mt-1.5 text-[13px] text-(--e-faint)">kg estimés</dd>
          </div>
          <div>
            <dt className="text-[13px] text-(--e-muted)">Écart à la réf.</dt>
            {ref && v ? (
              <>
                <dd className={`mt-1 flex items-center gap-1.5 text-[22px] font-medium leading-none tracking-[-0.01em] ${TONE[v]}`}>
                  <Sign v={v} size={13} />
                  {fmtSigned(Math.round((e1 - setE1rm(ref)) * 10) / 10)}
                </dd>
                <dd className={`mt-1.5 text-[13px] ${TONE[v]}`}>{GAP_WORD[v]}</dd>
              </>
            ) : (
              <dd className="mt-1 text-[16px] text-(--e-muted)">aucune réf.</dd>
            )}
          </div>
          <div className="text-right">
            <dt className="text-[13px] text-(--e-muted)">Record</dt>
            {isRecord ? (
              <>
                <dd className="mt-1 flex items-center justify-end gap-1.5 text-[22px] font-medium leading-none tracking-[-0.01em] text-(--e-sig)">
                  <Sign v="up" size={13} />
                  {fmt1(e1)}
                </dd>
                <dd className="mt-1.5 text-[13px] text-(--e-sig)">nouveau</dd>
              </>
            ) : best > 0 ? (
              <>
                <dd className="mt-1 text-[22px] font-medium leading-none tracking-[-0.01em] text-(--e-muted)">{fmt1(best)}</dd>
                <dd className="mt-1.5 text-[13px] text-(--e-faint)">{bestIsToday || !ex.pr ? 'aujourd’hui' : fmtDate(ex.pr.date)}</dd>
              </>
            ) : (
              <dd className="mt-1 text-[16px] text-(--e-muted)">aucun</dd>
            )}
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
            perView={7}
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

      {/* Action unique au pouce. Le dégagement bas laisse la place à la barre de
          bascule du prototype (et à l'indicateur d'accueil iOS). */}
      <div className="sticky bottom-0 z-10 mt-3 flex items-stretch gap-2 bg-(--e-bg) px-5 pb-[60px] pt-2">
        {undoable && (
          <button
            type="button"
            onClick={onUndo}
            className="h-14 flex-none px-1.5 text-[16px] text-(--e-muted) underline decoration-1 underline-offset-4 active:text-(--e-ink)"
          >
            Annuler
          </button>
        )}
        <button
          type="button"
          onClick={onLog}
          className="flex h-14 min-w-0 flex-1 items-center justify-between gap-3 rounded-[6px] bg-(--e-ink) px-4 text-(--e-bg) active:bg-(--e-muted)"
        >
          <span className="truncate text-[18px] font-semibold tracking-[-0.01em]">
            {extra ? 'Logger une de plus' : `Logger la série ${rank}`}
          </span>
          <span className="flex-none text-[15px] font-medium text-(--e-on-ink)">
            {fmtKg(dv.weightKg)} × {dv.reps}
          </span>
        </button>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------------ */
/* Racine                                                                     */
/* ------------------------------------------------------------------------ */

export function VariantE({ session }: { session: SessionFixture }) {
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
    <div
      className="flex min-h-full flex-1 flex-col bg-(--e-bg) text-(--e-ink) antialiased"
      style={{ ...PALETTE, fontFamily: FONT, fontVariantNumeric: 'tabular-nums' }}
    >
      <TopBar
        view={view}
        onView={changeView}
        left={
          view === 'salle' ? (
            <>
              <span className="font-medium text-(--e-ink)">{session.seanceName}</span>
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
