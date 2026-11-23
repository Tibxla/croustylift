// PROTOTYPE JETABLE · socle E, graphe de l'Analyse, parcouru au doigt.
//
// Un seul composant pour toutes les courbes de la surface (e1RM d'un exo,
// comparaison de deux blocs, durée et BPM) : axe X numérique (jours ou
// semaines), axe Y à droite, grille en filets. Aucune aire, aucun dégradé,
// aucun halo. Le doigt (ou la souris) choisit le point le plus proche en X ;
// le curseur est un filet gris et le point choisi un disque blanc cassé : le
// signal n'est pas un curseur, ni une couleur de série : le signal ne veut dire que « mieux
// que la dernière fois » (`lastUp` : seul le dernier point, s'il a battu le
// précédent). Les séries secondaires sont grises ET pointillées, jamais
// distinguées par la seule couleur. `break` sur un point coupe le trait :
// une valeur absente n'est jamais reliée en douce, encore moins tracée à zéro.
import { useMemo, useRef } from 'react';
import { fmt1 } from './format';

export interface ChartPoint {
  x: number;
  y: number;
  /** Coupe le trait avant ce point (une valeur manque juste avant). */
  break?: boolean;
}

export interface ChartSeries {
  id: string;
  points: ChartPoint[];
  tone: 'ink' | 'muted';
  dashed?: boolean;
  /** Étiquette courte posée au bout du trait (« A », « B »). */
  endLabel?: string;
  /** false : points seuls, sans trait (mesures bruitées d'une séance à l'autre). */
  line?: boolean;
  /** Le dernier point a battu le précédent : lui seul prend le signal (▲ mieux). */
  lastUp?: boolean;
}

export interface ChartSel {
  series: string;
  index: number;
}

const W = 350;

const STROKE: Record<ChartSeries['tone'], string> = {
  ink: 'var(--ink)',
  muted: 'var(--muted)',
};

function niceStep(span: number, target: number): number {
  const raw = span / target;
  const p = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= raw) return m * p;
  return 10 * p;
}

export function Chart({
  series,
  height = 220,
  selected,
  onSelect,
  xTicks,
  yFormat = (v) => fmt1(v).replace(',0', ''),
  refLine,
  ariaLabel,
  yTarget = 4,
  zeroLine = false,
  xDomain,
  cursorX,
}: {
  series: ChartSeries[];
  height?: number;
  selected: ChartSel | null;
  onSelect?: (s: ChartSel) => void;
  xTicks: { x: number; label: string }[];
  yFormat?: (v: number) => string;
  /** Ligne horizontale pointillée nommée (le Record). */
  refLine?: { y: number; label: string };
  ariaLabel: string;
  yTarget?: number;
  /** Trace la ligne y = 0 plus appuyée (graphes en % depuis un départ). */
  zeroLine?: boolean;
  /** Domaine X imposé (deux graphes qui partagent l'axe du temps). */
  xDomain?: [number, number];
  /** Curseur à cette abscisse même sans point choisi (valeur absente ce jour-là). */
  cursorX?: number;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const labelled = series.some((s) => s.endLabel);
  const PLOT = { left: 4, right: W - (labelled ? 64 : 44), top: 22, bottom: height - 28 };

  const geo = useMemo(() => {
    const all = series.flatMap((s) => s.points);
    const ys = all.map((p) => p.y);
    if (refLine) ys.push(refLine.y);
    if (zeroLine) ys.push(0);
    const xs = all.map((p) => p.x);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const span = Math.max(maxY - minY, Math.abs(maxY) * 0.04, 1);
    const step = niceStep(span, yTarget);
    const lo = Math.floor((minY - span * 0.08) / step) * step;
    const hi = Math.ceil((maxY + span * 0.08) / step) * step;
    const x0 = xDomain ? xDomain[0] : Math.min(...xs);
    const x1 = xDomain ? xDomain[1] : Math.max(...xs);
    const x = (v: number) => (x1 === x0 ? (PLOT.left + PLOT.right) / 2 : PLOT.left + ((v - x0) / (x1 - x0)) * (PLOT.right - PLOT.left));
    const y = (v: number) => PLOT.bottom - ((v - lo) / (hi - lo)) * (PLOT.bottom - PLOT.top);
    const ticks: number[] = [];
    for (let v = lo; v <= hi + step / 1000; v += step) ticks.push(Math.round(v * 1000) / 1000);
    return { x, y, ticks, x0, x1 };
  }, [series, refLine, zeroLine, yTarget, xDomain, PLOT.left, PLOT.right, PLOT.top, PLOT.bottom]);

  const pick = (clientX: number) => {
    const el = svg.current;
    if (!el || !onSelect) return;
    const r = el.getBoundingClientRect();
    const vx = ((clientX - r.left) / r.width) * W;
    let best: ChartSel | null = null;
    let dist = Infinity;
    // Ordre des séries = priorité à égalité (la première gagne).
    series.forEach((s) =>
      s.points.forEach((p, i) => {
        const d = Math.abs(geo.x(p.x) - vx);
        if (d < dist - 0.01) {
          dist = d;
          best = { series: s.id, index: i };
        }
      }),
    );
    if (best && (!selected || (best as ChartSel).series !== selected.series || (best as ChartSel).index !== selected.index)) onSelect(best);
  };

  const selSeries = selected ? series.find((s) => s.id === selected.series) : undefined;
  const selPoint = selected ? selSeries?.points[selected.index] : undefined;
  const pathOf = (pts: ChartPoint[]) =>
    pts.map((p, i) => `${i === 0 || p.break ? 'M' : 'L'}${geo.x(p.x).toFixed(1)},${geo.y(p.y).toFixed(1)}`).join(' ');
  // Les séries grises d'abord, celle qui porte l'accent par-dessus.
  const drawOrder = [...series].sort((a, b) => (a.tone === 'muted' ? 0 : 1) - (b.tone === 'muted' ? 0 : 1));

  return (
    <svg
      ref={svg}
      viewBox={`0 0 ${W} ${height}`}
      className={`block w-full select-none ${onSelect ? 'touch-pan-y' : ''}`}
      role="img"
      aria-label={ariaLabel}
      data-chart
      onPointerDown={(e) => pick(e.clientX)}
      onPointerMove={(e) => {
        if (e.pointerType === 'mouse' || e.buttons) pick(e.clientX);
      }}
    >
      {geo.ticks.map((v) => (
        <g key={v}>
          <line
            x1={PLOT.left}
            x2={PLOT.right}
            y1={geo.y(v)}
            y2={geo.y(v)}
            stroke={zeroLine && v === 0 ? 'var(--dim)' : 'var(--line)'}
            strokeWidth={1}
          />
          <text x={W} y={geo.y(v) + 4.5} textAnchor="end" fontSize="13" fill="var(--faint)">
            {yFormat(v)}
          </text>
        </g>
      ))}
      {xTicks.map((t) => (
        <text key={`${t.label}-${t.x}`} x={Math.min(geo.x(t.x), PLOT.right - 4)} y={height - 7} fontSize="13" fill="var(--faint)">
          {t.label}
        </text>
      ))}
      {refLine && (
        <g>
          <line x1={PLOT.left} x2={PLOT.right} y1={geo.y(refLine.y)} y2={geo.y(refLine.y)} stroke="var(--muted)" strokeDasharray="2 4" />
          <text x={PLOT.left} y={geo.y(refLine.y) - 7} fontSize="13" fill="var(--muted)">
            {refLine.label}
          </text>
        </g>
      )}
      {(selPoint || cursorX !== undefined) && <line x1={geo.x(selPoint?.x ?? cursorX!)} x2={geo.x(selPoint?.x ?? cursorX!)} y1={PLOT.top - 8} y2={PLOT.bottom} stroke="var(--dim)" />}
      {drawOrder.map((s) => (
        <g key={s.id}>
          {s.line !== false && <path
            d={pathOf(s.points)}
            fill="none"
            stroke={STROKE[s.tone]}
            strokeWidth={s.tone === 'muted' ? 1.5 : 2.25}
            strokeDasharray={s.dashed ? '5 4' : undefined}
            strokeLinejoin="round"
            strokeLinecap="round"
          />}
          {s.points.map((p, i) => (
            <circle
              key={i}
              cx={geo.x(p.x)}
              cy={geo.y(p.y)}
              r={s.lastUp && i === s.points.length - 1 ? 4 : s.line === false ? 3 : s.tone === 'muted' ? 2 : 2.5}
              fill={s.lastUp && i === s.points.length - 1 ? 'var(--sig)' : STROKE[s.tone]}
            />
          ))}
          {s.endLabel && s.points.length > 0 && (
            <text
              x={geo.x(s.points[s.points.length - 1]!.x) + 8}
              y={geo.y(s.points[s.points.length - 1]!.y) + 4.5}
              fontSize="13"
              fontWeight="600"
              fill={STROKE[s.tone]}
            >
              {s.endLabel}
            </text>
          )}
        </g>
      ))}
      {selPoint && (
        <circle
          cx={geo.x(selPoint.x)}
          cy={geo.y(selPoint.y)}
          r="5.5"
          // Le point choisi garde le signal s'il est le dernier point battu.
          fill={selSeries?.lastUp && selected?.index === selSeries.points.length - 1 ? 'var(--sig)' : 'var(--ink)'}
          stroke="var(--bg)"
          strokeWidth="2.5"
        />
      )}
      {/* Zone de capture du pointeur, toute la surface. */}
      <rect x="0" y="0" width={W} height={height} fill="transparent" />
    </svg>
  );
}

/* ------------------------------------------------------------------------ */
/* Axe du temps                                                               */
/* ------------------------------------------------------------------------ */

const DAY = 86_400_000;
export const dayOf = (iso: string) => Math.round(Date.parse(`${iso}T12:00:00Z`) / DAY);

const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

/** Graduations mensuelles (1er du mois) entre deux dates ISO, plus le début. */
export function monthTicks(from: string, to: string): { x: number; label: string }[] {
  const out: { x: number; label: string }[] = [];
  const [y0, m0] = from.split('-').map(Number) as [number, number];
  let y = y0;
  let m = m0;
  // Premier mois entamé : étiqueté au premier point, le suivant au 1er.
  out.push({ x: dayOf(from), label: MONTHS_SHORT[m - 1]! });
  for (;;) {
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    const iso = `${y}-${String(m).padStart(2, '0')}-01`;
    if (iso > to) break;
    out.push({ x: dayOf(iso), label: MONTHS_SHORT[m - 1]! });
  }
  // Trop serré (< 9 jours) : on retire l'étiquette du début.
  if (out.length > 1 && out[1]!.x - out[0]!.x < 9) out.shift();
  return out;
}

/** Petit échantillon de trait pour une légende, au style de la série. */
export function Swatch({ tone, dashed }: { tone: ChartSeries['tone']; dashed?: boolean }) {
  return (
    <svg width="22" height="10" viewBox="0 0 22 10" aria-hidden className="flex-none">
      <line x1="1" x2="21" y1="5" y2="5" stroke={STROKE[tone]} strokeWidth={tone === 'muted' ? 1.5 : 2.25} strokeDasharray={dashed ? '5 4' : undefined} />
    </svg>
  );
}
