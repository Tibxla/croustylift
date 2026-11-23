// PROTOTYPE JETABLE · variante F « Graphite », surface Analyse.
// Même lecture que A : un exo à la fois, un grand graphe e1RM fait main (SVG)
// parcouru au doigt, la pente et le record en lecture typographique, puis la
// liste numérotée des exos. Courbe et curseur en blanc, grille en graphite,
// record en pointillé gris. Un exo sans historique garde son cadre vide : un
// trou n'est jamais un zéro.
import { useMemo, useRef, useState } from 'react';
import type { ExercisePlan, SessionFixture } from './fixtures';
import { G, SIGN, TONE, WORD_SLOPE, fmt1, fmtDate, fmtPct, monthLabel, slopeVerdict } from './VariantF-shared';

const W = 358;
const H = 232;
const PLOT = { left: 2, right: W - 44, top: 18, bottom: H - 26 };

function niceStep(range: number): number {
  for (const s of [1, 2, 2.5, 5, 10, 20]) if (range / s <= 4) return s;
  return 50;
}

function E1rmChart({
  ex,
  selected,
  onSelect,
}: {
  ex: ExercisePlan;
  selected: number;
  onSelect: (i: number) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const pts = ex.history;
  const geo = useMemo(() => {
    const vals = pts.map((p) => p.e1rm);
    if (ex.pr) vals.push(ex.pr.e1rm);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const step = niceStep(Math.max(2, max - min + 2));
    const lo = Math.floor((min - 0.6) / step) * step;
    const hi = Math.ceil((max + 0.6) / step) * step;
    const t0 = Date.parse(pts[0]!.date);
    const t1 = Date.parse(pts[pts.length - 1]!.date);
    const x = (iso: string) =>
      t1 === t0
        ? (PLOT.left + PLOT.right) / 2
        : PLOT.left + ((Date.parse(iso) - t0) / (t1 - t0)) * (PLOT.right - PLOT.left);
    const y = (v: number) => PLOT.bottom - ((v - lo) / (hi - lo)) * (PLOT.bottom - PLOT.top);
    const ticks: number[] = [];
    for (let v = lo; v <= hi + 1e-9; v += step) ticks.push(Math.round(v * 100) / 100);
    const months: { label: string; x: number }[] = [];
    pts.forEach((p, i) => {
      const prev = pts[i - 1];
      if (!prev || monthLabel(prev.date) !== monthLabel(p.date)) months.push({ label: monthLabel(p.date), x: x(p.date) });
    });
    const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.date).toFixed(1)},${y(p.e1rm).toFixed(1)}`).join(' ');
    return { x, y, ticks, months, d };
  }, [pts, ex.pr]);

  const pick = (clientX: number) => {
    const el = svgRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vx = ((clientX - r.left) / r.width) * W;
    let best = 0;
    let dist = Infinity;
    pts.forEach((p, i) => {
      const dd = Math.abs(geo.x(p.date) - vx);
      if (dd < dist) {
        dist = dd;
        best = i;
      }
    });
    if (best !== selected) onSelect(best);
  };

  const sel = pts[selected]!;
  const sx = geo.x(sel.date);
  const sy = geo.y(sel.e1rm);
  const last = pts[pts.length - 1]!;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      className="block w-full touch-pan-y select-none"
      role="img"
      aria-label={`e1RM de ${ex.name}, ${pts.length} séances, de ${fmt1(pts[0]!.e1rm)} à ${fmt1(last.e1rm)} kg`}
      onPointerDown={(e) => pick(e.clientX)}
      onPointerMove={(e) => {
        if (e.pointerType === 'mouse' || e.buttons) pick(e.clientX);
      }}
    >
      {geo.ticks.map((t) => (
        <g key={t}>
          <line x1={PLOT.left} x2={PLOT.right} y1={geo.y(t)} y2={geo.y(t)} stroke={G.hair} />
          <text x={W} y={geo.y(t) + 3.5} textAnchor="end" fontSize="10.5" fill={G.ink3}>
            {fmt1(t).replace(',0', '')}
          </text>
        </g>
      ))}
      {ex.pr && (
        <g>
          <line
            x1={PLOT.left}
            x2={PLOT.right}
            y1={geo.y(ex.pr.e1rm)}
            y2={geo.y(ex.pr.e1rm)}
            stroke={G.ink2}
            strokeDasharray="3 3"
          />
          <text x={PLOT.left} y={geo.y(ex.pr.e1rm) - 6} fontSize="11" fill={G.ink2}>
            Record {fmt1(ex.pr.e1rm)}
          </text>
        </g>
      )}
      <line x1={sx} x2={sx} y1={PLOT.top - 6} y2={PLOT.bottom} stroke="#5a5a5a" />
      <path d={geo.d} fill="none" stroke={G.ink} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((p) => (
        <circle key={p.date} cx={geo.x(p.date)} cy={geo.y(p.e1rm)} r="2.25" fill={G.ink} />
      ))}
      <circle cx={sx} cy={sy} r="5.5" fill={G.white} stroke={G.bg} strokeWidth="2.5" />
      {geo.months.map((m) => (
        <text key={m.label} x={m.x} y={H - 6} fontSize="11" fill={G.ink3}>
          {m.label}
        </text>
      ))}
      {/* Zone de capture du pointeur, plus large que les marques. */}
      <rect x="0" y="0" width={W} height={H} fill="transparent" />
    </svg>
  );
}

function Readouts({ ex, selected }: { ex: ExercisePlan; selected: number }) {
  const pts = ex.history;
  const p = pts[selected];
  const isLast = selected === pts.length - 1;
  const rate = ex.weeklyRatePct;
  const sv = rate === null ? null : slopeVerdict(rate);
  return (
    <div className="mt-5 flex items-end justify-between gap-4">
      <div className="min-w-0">
        {p ? (
          <>
            <div className="flex items-baseline gap-1.5">
              <span className="text-[54px] font-medium leading-none tracking-[-0.035em] text-[#ffffff]">
                {fmt1(p.e1rm)}
              </span>
              <span className="text-lg text-[#a8a8a8]">kg</span>
            </div>
            <div className="mt-2 text-[13px] text-[#a8a8a8]">
              e1RM du {fmtDate(p.date)}
              {isLast ? ', dernière fois' : ''}
            </div>
          </>
        ) : (
          <>
            <div className="text-[22px] font-medium leading-tight text-[#a8a8a8]">Aucune mesure</div>
            <div className="mt-2 text-[13px] text-[#a8a8a8]">Jamais fait dans cette séance</div>
          </>
        )}
      </div>
      <dl className="flex-none text-right">
        <dt className="text-[12px] text-[#a8a8a8]">Pente</dt>
        <dd className="mt-0.5">
          {rate === null || sv === null ? (
            <span className="text-[15px] text-[#a8a8a8]">pas assez de séances</span>
          ) : (
            <span className={TONE[sv]}>
              <span className="block text-[17px] font-medium">
                {SIGN[sv]} {fmtPct(rate)}
                <span className="text-[13px] font-normal"> /sem</span>
              </span>
              <span className="block text-[12px]">{WORD_SLOPE[sv]}</span>
            </span>
          )}
        </dd>
        <dt className="mt-3 text-[12px] text-[#a8a8a8]">Record</dt>
        <dd className="mt-0.5 text-[15px] text-[#ededed]">
          {ex.pr ? (
            <>
              {fmt1(ex.pr.e1rm)}
              <span className="text-[#a8a8a8]"> · {fmtDate(ex.pr.date)}</span>
            </>
          ) : (
            <span className="text-[#a8a8a8]">aucun</span>
          )}
        </dd>
      </dl>
    </div>
  );
}

export function Analyse({
  session,
  selectedId,
  onSelect,
}: {
  session: SessionFixture;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const ex = session.exercises.find((e) => e.id === selectedId) ?? session.exercises[0]!;
  const [point, setPoint] = useState<{ id: string; i: number } | null>(null);
  const selected = point && point.id === ex.id ? point.i : ex.history.length - 1;

  return (
    <div className="flex-1 pb-24">
      <section className="px-4 pt-2">
        <h1 className="text-[28px] font-semibold leading-[1.1] tracking-[-0.02em] text-[#ededed]">{ex.name}</h1>
        <p className="mt-1 text-[13px] text-[#a8a8a8]">
          {session.seanceName} · e1RM de la 1ʳᵉ série
          {ex.history.length > 0 ? ` · ${ex.history.length} séances` : ''}
        </p>
        <Readouts ex={ex} selected={selected} />
        <div className="mt-5">
          {ex.history.length > 0 ? (
            <E1rmChart ex={ex} selected={selected} onSelect={(i) => setPoint({ id: ex.id, i })} />
          ) : (
            <div
              className="flex h-[232px] flex-col justify-center rounded-[8px] border border-[#2e2e2e] bg-[#0a0a0a] px-4"
              aria-label="Pas de courbe"
            >
              <p className="max-w-[32ch] text-[15px] leading-snug text-[#a8a8a8]">
                Passé aujourd'hui, jamais fait dans {session.seanceName}. La courbe partira de la première série
                loggée, sans point à zéro avant.
              </p>
            </div>
          )}
        </div>
      </section>

      <section className="mt-7 px-4">
        <h2 className="text-[13px] text-[#a8a8a8]">{session.seanceName}, dans l'ordre de la séance</h2>
        <ol className="mt-2 overflow-hidden rounded-[8px] border border-[#3a3a3a]">
          {session.exercises.map((e, i) => {
            const active = e.id === ex.id;
            const last = e.history[e.history.length - 1];
            const rate = e.weeklyRatePct;
            return (
              <li key={e.id} className="border-t border-[#2a2a2a] first:border-t-0">
                <button
                  type="button"
                  onClick={() => onSelect(e.id)}
                  aria-current={active ? 'true' : undefined}
                  className={`flex h-12 w-full items-center gap-3 px-3 text-left transition-[transform,background-color] duration-75 active:translate-y-px ${
                    active ? 'bg-[#262626]' : 'bg-[#1c1c1c] active:bg-[#151515]'
                  }`}
                >
                  <span className={`w-4 text-[13px] ${active ? 'font-semibold text-[#ffffff]' : 'text-[#8f8f8f]'}`}>
                    {i + 1}
                  </span>
                  <span
                    className={`min-w-0 flex-1 truncate text-[15px] ${active ? 'font-semibold text-[#ffffff]' : 'text-[#a8a8a8]'}`}
                  >
                    {e.name}
                  </span>
                  {last ? (
                    <>
                      <span className="w-12 text-right text-[14px] text-[#ededed]">{fmt1(last.e1rm)}</span>
                      {/* Dans la liste, la pente reste grise : signe et valeur,
                          la couleur est réservée à la lecture de l'exo ouvert. */}
                      <span className="w-[68px] text-right text-[13px] text-[#a8a8a8]">
                        {rate === null ? '·' : `${SIGN[slopeVerdict(rate)]} ${fmtPct(rate)}`}
                      </span>
                    </>
                  ) : (
                    <span className="text-[13px] text-[#a8a8a8]">pas de données</span>
                  )}
                </button>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
