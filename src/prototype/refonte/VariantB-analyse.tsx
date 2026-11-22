// PROTOTYPE JETABLE · variante B « Carnet » : l'Analyse en liste de cotation.
// Une ligne par exo : nom, record, sparkline e1RM, e1RM actuelle, pente
// %/semaine (signe + couleur). Toucher une ligne la déplie en graphe SVG fait
// main. Un exo sans historique n'a ni courbe, ni pente, ni zéro.
import { useState } from 'react';
import { kg, type ExercisePlan, type SessionFixture } from './fixtures';
import { MINUS, TREND_CLASS, TREND_SIGN, dec1, fmtDate, trendOf } from './VariantB-shared';

/** En deçà de ±0,25 %/sem, on lit « stable » : −0,1 % n'est pas une régression. */
const FLAT_BAND = 0.25;

function pct(n: number): string {
  return `${n > 0 ? '+' : n < 0 ? MINUS : ''}${dec1(n)} %`;
}

function Sparkline({ values }: { values: number[] }) {
  const w = 76;
  const h = 30;
  // Échelle plancher à ±4 % de la moyenne : une ligne stable reste plate au lieu
  // d'amplifier un bruit de 1 kg en dents de scie.
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const span = Math.max(Math.max(...values) - Math.min(...values), mean * 0.08);
  const lo = (Math.max(...values) + Math.min(...values)) / 2 - span / 2;
  const pts = values.map((v, i) => [
    (i / (values.length - 1)) * (w - 4) + 2,
    h - 3 - ((v - lo) / span) * (h - 6),
  ]);
  const last = pts[pts.length - 1] ?? [0, 0];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" className="shrink-0">
      <polyline
        points={pts.map((p) => p.join(',')).join(' ')}
        fill="none"
        stroke="var(--color-ink-muted)"
        strokeWidth={1.25}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={last[0]} cy={last[1]} r={2.25} fill="var(--color-ink)" />
    </svg>
  );
}

function niceStep(raw: number): number {
  for (const s of [0.5, 1, 2, 2.5, 5, 10, 20]) if (s >= raw) return s;
  return 50;
}

function Chart({ ex }: { ex: ExercisePlan }) {
  const W = 358;
  const H = 188;
  const padL = 2;
  const padR = 40;
  const padT = 14;
  const padB = 24;
  const vals = ex.history.map((p) => p.e1rm);
  const all = ex.pr ? [...vals, ex.pr.e1rm] : vals;
  const step = niceStep((Math.max(...all) - Math.min(...all)) / 3);
  const lo = Math.floor((Math.min(...all) - step * 0.3) / step) * step;
  const hi = Math.ceil((Math.max(...all) + step * 0.3) / step) * step;
  const t0 = new Date(ex.history[0]?.date ?? '').getTime();
  const t1 = new Date(ex.history[ex.history.length - 1]?.date ?? '').getTime();
  const x = (iso: string) => padL + ((new Date(iso).getTime() - t0) / (t1 - t0 || 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);

  const ticks: number[] = [];
  for (let v = lo; v <= hi + 1e-9; v += step) ticks.push(Math.round(v * 100) / 100);

  // Droite des moindres carrés : c'est elle que résume la pente %/semaine.
  const xs = ex.history.map((p) => (new Date(p.date).getTime() - t0) / 864e5);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = vals.reduce((a, b) => a + b, 0) / vals.length;
  const num = xs.reduce((a, xi, i) => a + (xi - mx) * ((vals[i] ?? 0) - my), 0);
  const den = xs.reduce((a, xi) => a + (xi - mx) ** 2, 0) || 1;
  const slope = num / den;
  const days = (t1 - t0) / 864e5;
  const trend = trendOf(ex.weeklyRatePct ?? 0, FLAT_BAND);

  const first = ex.history[0];
  const lastP = ex.history[ex.history.length - 1];
  const mid = ex.history[Math.floor(ex.history.length / 2)];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="block h-auto w-full"
      role="img"
      aria-label={`Courbe e1RM de ${ex.name}, de ${first ? dec1(first.e1rm) : ''} à ${lastP ? dec1(lastP.e1rm) : ''} kg`}
    >
      {ticks.map((t) => (
        <g key={t}>
          <line x1={padL} x2={W - padR + 6} y1={y(t)} y2={y(t)} stroke="var(--color-hair)" />
          <text
            x={W}
            y={y(t) + 4}
            textAnchor="end"
            className="readout"
            fontSize={11}
            fill="var(--color-ink-muted)"
          >
            {Number.isInteger(t) ? t : dec1(t)}
          </text>
        </g>
      ))}

      {ex.pr && (
        <g>
          <line
            x1={padL}
            x2={W - padR + 6}
            y1={y(ex.pr.e1rm)}
            y2={y(ex.pr.e1rm)}
            stroke="var(--color-ink-muted)"
            strokeDasharray="2 3"
          />
          <text x={padL} y={y(ex.pr.e1rm) - 5} fontSize={11} fill="var(--color-ink-muted)">
            record {dec1(ex.pr.e1rm)}
          </text>
        </g>
      )}

      <line
        x1={x(first?.date ?? '')}
        x2={x(lastP?.date ?? '')}
        y1={y(my - slope * mx)}
        y2={y(my + slope * (days - mx))}
        className={TREND_CLASS[trend]}
        stroke="currentColor"
        strokeWidth={1}
        opacity={0.9}
      />

      <polyline
        points={ex.history.map((p) => `${x(p.date)},${y(p.e1rm)}`).join(' ')}
        fill="none"
        stroke="var(--color-ink)"
        strokeWidth={1.75}
        strokeLinejoin="round"
      />
      {ex.history.map((p, i) => (
        <circle
          key={p.date}
          cx={x(p.date)}
          cy={y(p.e1rm)}
          r={i === ex.history.length - 1 ? 3.5 : 2.25}
          fill="var(--color-ink)"
          stroke="var(--color-bg)"
          strokeWidth={1.5}
        />
      ))}

      {[first, mid, lastP].map(
        (p, i) =>
          p && (
            <text
              key={p.date}
              x={x(p.date)}
              y={H - 6}
              textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}
              fontSize={11}
              fill="var(--color-ink-muted)"
            >
              {fmtDate(p.date)}
            </text>
          ),
      )}
    </svg>
  );
}

function Facts({ ex }: { ex: ExercisePlan }) {
  const first = ex.history[0];
  const last = ex.history[ex.history.length - 1];
  const rows: [string, string][] = [];
  if (ex.weeklyRatePct !== null) rows.push(['Pente', `${pct(ex.weeklyRatePct)} par semaine, sur ${ex.history.length} séances`]);
  if (last) rows.push(['Dernière', `${dec1(last.e1rm)} kg · ${fmtDate(last.date)}`]);
  if (first) rows.push(['Première', `${dec1(first.e1rm)} kg · ${fmtDate(first.date)}`]);
  if (ex.pr) rows.push(['Record', `${dec1(ex.pr.e1rm)} kg · ${kg(ex.pr.weightKg)}×${ex.pr.reps} · ${fmtDate(ex.pr.date)}`]);
  return (
    <>
    <dl className="mt-1 text-[13px]">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-4 border-t border-hair py-2">
          <dt className="text-ink-muted">{k}</dt>
          <dd className="text-right tabular-nums text-ink">{v}</dd>
        </div>
      ))}
    </dl>
      <p className="border-t border-hair pt-2 text-[12px] leading-[1.45] text-ink-muted">
        La courbe suit la 1re série de chaque séance terminée. Le record compte toutes les séries,
        séance du jour comprise : il peut donc se trouver au-dessus de la courbe.
      </p>
    </>
  );
}

function Row({ ex, open, onToggle }: { ex: ExercisePlan; open: boolean; onToggle: () => void }) {
  const empty = ex.history.length === 0;
  const last = ex.history[ex.history.length - 1];
  const trend = ex.weeklyRatePct === null ? null : trendOf(ex.weeklyRatePct, FLAT_BAND);
  return (
    <li className="border-t border-hair">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex min-h-[64px] w-full items-center gap-3 py-2 text-left active:bg-surface"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold tracking-[-0.01em]">{ex.name}</span>
          <span className="block truncate text-[13px] tabular-nums text-ink-muted">
            {ex.pr ? `record ${dec1(ex.pr.e1rm)} · ${fmtDate(ex.pr.date)}` : "pas encore d'historique"}
          </span>
        </span>
        {empty ? (
          <span className="w-[76px] shrink-0" aria-hidden="true" />
        ) : (
          <Sparkline values={ex.history.map((p) => p.e1rm)} />
        )}
        <span className="w-[78px] shrink-0 text-right">
          {last && trend && ex.weeklyRatePct !== null ? (
            <>
              <span className="readout block text-[17px] font-medium leading-tight">{dec1(last.e1rm)}</span>
              <span className={`readout block text-[12px] ${TREND_CLASS[trend]}`}>
                {TREND_SIGN[trend]} {pct(ex.weeklyRatePct)}
              </span>
            </>
          ) : (
            <span className="block text-[12px] text-ink-muted">aucune série</span>
          )}
        </span>
      </button>
      {open && (
        <div className="vb-unfold pb-4">
          {empty ? (
            <p className="border-t border-hair py-3 text-[13px] leading-[1.45] text-ink-muted">
              Aucune série loggée sur cet exercice. Pas de courbe ni de pente tant qu'il n'y a pas
              au moins deux séances.
            </p>
          ) : (
            <>
              <Chart ex={ex} />
              <Facts ex={ex} />
            </>
          )}
        </div>
      )}
    </li>
  );
}

export function Analyse({ session }: { session: SessionFixture }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const withData = session.exercises.filter((e) => e.history.length > 0);
  const firstDate = withData[0]?.history[0]?.date;
  const lastDate = withData[0]?.history[withData[0].history.length - 1]?.date;
  const maxPts = Math.max(0, ...session.exercises.map((e) => e.history.length));
  return (
    <div className="px-4 pb-24">
      <header className="pb-4 pt-2">
        <h1 className="text-[28px] font-semibold leading-[1.1] tracking-[-0.025em]">Analyse</h1>
        <p className="mt-1 text-[13px] text-ink-muted">
          {session.seanceName} · {session.routineName}
          {firstDate && lastDate && ` · ${fmtDate(firstDate)} au ${fmtDate(lastDate)}`}
        </p>
      </header>
      <div className="flex items-end gap-3 pb-1.5 text-[12px] text-ink-muted">
        <span className="flex-1">Exercice</span>
        <span className="w-[76px] text-center">{maxPts} séances</span>
        <span className="w-[78px] text-right leading-tight">
          e1RM
          <br />
          pente/sem.
        </span>
      </div>
      <ul className="border-b border-hair">
        {session.exercises.map((ex) => (
          <Row
            key={ex.id}
            ex={ex}
            open={!!open[ex.id]}
            onToggle={() => setOpen((o) => ({ ...o, [ex.id]: !o[ex.id] }))}
          />
        ))}
      </ul>
      <p className="mt-3 text-[12px] leading-[1.45] text-ink-muted">
        e1RM en kg, Epley décalé d'une rep. Pente calculée sur la 1re série de chaque séance ;
        entre {MINUS}0,25 et +0,25 % par semaine, on la lit stable.
      </p>
    </div>
  );
}
