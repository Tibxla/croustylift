// PROTOTYPE JETABLE · variante E « Signal », surface Analyse.
// Même lecture que A : un exo à la fois, un grand graphe e1RM parcouru au
// doigt, la pente et le record en clair, puis l'index des exos de la séance.
// La courbe est blanc cassé : le jaune reste réservé aux ▲. Un exo sans
// historique garde son cadre vide, un trou n'est jamais un zéro.
import { useMemo, useRef, useState } from 'react';
import type { ExercisePlan, SessionFixture } from './fixtures';
import { SLOPE_WORD, Sign, TONE, fmt1, fmtDate, fmtPct, monthLabel, slopeVerdict } from './VariantE-shared';

const W = 350;
const H = 228;
const PLOT = { left: 2, right: W - 40, top: 18, bottom: H - 26 };

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
          <line x1={PLOT.left} x2={PLOT.right} y1={geo.y(t)} y2={geo.y(t)} stroke="var(--e-line)" />
          <text x={W} y={geo.y(t) + 4} textAnchor="end" fontSize="11" fill="var(--e-faint)">
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
            stroke="var(--e-muted)"
            strokeDasharray="3 3"
          />
          <text x={PLOT.left} y={geo.y(ex.pr.e1rm) - 6} fontSize="11" fill="var(--e-muted)">
            Record {fmt1(ex.pr.e1rm)}
          </text>
        </g>
      )}
      <line x1={sx} x2={sx} y1={PLOT.top - 6} y2={PLOT.bottom} stroke="var(--e-dim)" />
      <path d={geo.d} fill="none" stroke="var(--e-ink)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((p) => (
        <circle key={p.date} cx={geo.x(p.date)} cy={geo.y(p.e1rm)} r="2.25" fill="var(--e-ink)" />
      ))}
      <circle cx={sx} cy={sy} r="5.5" fill="var(--e-ink)" stroke="var(--e-bg)" strokeWidth="2.5" />
      {geo.months.map((m) => (
        <text key={m.label} x={m.x} y={H - 6} fontSize="11" fill="var(--e-faint)">
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
    <div className="mt-6 flex items-end justify-between gap-4">
      <div className="min-w-0">
        {p ? (
          <>
            <div className="flex items-baseline gap-2">
              <span className="text-[60px] font-[650] leading-none tracking-[-0.045em] text-(--e-ink)">
                {fmt1(p.e1rm)}
              </span>
              <span className="text-[20px] font-medium text-(--e-muted)">kg</span>
            </div>
            <div className="mt-2 text-[14px] text-(--e-muted)">
              e1RM du {fmtDate(p.date)}
              {isLast ? ', dernière fois' : ''}
            </div>
          </>
        ) : (
          <>
            <div className="whitespace-nowrap text-[24px] font-semibold leading-tight tracking-[-0.02em] text-(--e-muted)">Aucune mesure</div>
            <div className="mt-2 text-[14px] text-(--e-muted)">Jamais fait dans cette séance</div>
          </>
        )}
      </div>
      <dl className="flex-none text-right">
        <dt className="text-[13px] text-(--e-muted)">Pente</dt>
        <dd className="mt-0.5 text-[18px] font-medium">
          {rate === null || sv === null ? (
            <span className="inline-block max-w-[8.5rem] text-[15px] font-normal leading-snug text-(--e-muted)">pas assez de séances</span>
          ) : (
            <span className={`inline-flex items-center gap-1.5 ${TONE[sv]}`}>
              <Sign v={sv} size={12} />
              {fmtPct(rate)}
              <span className="text-[13px] font-normal text-(--e-muted)">/sem</span>
            </span>
          )}
        </dd>
        {sv !== null && <dd className={`text-[13px] ${TONE[sv]}`}>{SLOPE_WORD[sv]}</dd>}
        <dt className="mt-3 text-[13px] text-(--e-muted)">Record</dt>
        <dd className="mt-0.5 text-[16px] font-medium text-(--e-ink)">
          {ex.pr ? (
            <>
              {fmt1(ex.pr.e1rm)}
              <span className="font-normal text-(--e-muted)"> · {fmtDate(ex.pr.date)}</span>
            </>
          ) : (
            <span className="font-normal text-(--e-muted)">aucun</span>
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
      <section className="px-5 pt-3">
        <h1 className="text-[32px] font-[650] leading-[1.1] tracking-[-0.03em] text-(--e-ink)">{ex.name}</h1>
        <p className="mt-1.5 text-[15px] text-(--e-muted)">
          {session.seanceName} · e1RM de la 1ʳᵉ série
          {ex.history.length > 0 ? ` · ${ex.history.length} séances` : ''}
        </p>
        <Readouts ex={ex} selected={selected} />
        <div className="mt-6">
          {ex.history.length > 0 ? (
            <E1rmChart ex={ex} selected={selected} onSelect={(i) => setPoint({ id: ex.id, i })} />
          ) : (
            <div className="flex h-[228px] flex-col justify-center border-y border-(--e-line)" aria-label="Pas de courbe">
              <p className="max-w-[32ch] text-[16px] leading-snug text-(--e-muted)">
                Passé aujourd’hui, jamais fait dans {session.seanceName.replace(/ /g, '\u00a0')}. La courbe partira de la première série
                loggée, sans point à zéro avant.
              </p>
            </div>
          )}
        </div>
      </section>

      <section className="mt-8 px-5">
        <h2 className="text-[14px] text-(--e-muted)">{session.seanceName}, dans l’ordre de la séance</h2>
        <ol className="mt-2 border-t border-(--e-line)">
          {session.exercises.map((e, i) => {
            const active = e.id === ex.id;
            const last = e.history[e.history.length - 1];
            const rate = e.weeklyRatePct;
            const sv = rate === null ? null : slopeVerdict(rate);
            return (
              <li key={e.id} className="border-b border-(--e-line)">
                <button
                  type="button"
                  onClick={() => onSelect(e.id)}
                  aria-current={active ? 'true' : undefined}
                  className="flex min-h-[60px] w-full items-center gap-3 py-2 text-left"
                >
                  <span
                    className={`w-5 flex-none self-start pt-[3px] text-[14px] ${active ? 'font-semibold text-(--e-ink)' : 'text-(--e-faint)'}`}
                  >
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block truncate text-[17px] tracking-[-0.01em] ${active ? 'font-semibold text-(--e-ink)' : 'text-(--e-muted)'}`}
                    >
                      {e.name}
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-[13px]">
                      {!last ? (
                        <span className="text-(--e-muted)">pas de données</span>
                      ) : sv === null || rate === null ? (
                        <span className="text-(--e-muted)">pente : pas assez de séances</span>
                      ) : (
                        <span className={`inline-flex items-center gap-1.5 ${TONE[sv]}`}>
                          <Sign v={sv} size={10} />
                          {SLOPE_WORD[sv]}, {fmtPct(rate)}/sem
                        </span>
                      )}
                    </span>
                  </span>
                  {last && (
                    <span className="flex-none text-right text-[17px] font-medium text-(--e-ink)">
                      {fmt1(last.e1rm)}
                      <span className="ml-1 text-[13px] font-normal text-(--e-muted)">kg</span>
                    </span>
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
