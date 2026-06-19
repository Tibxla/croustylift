// Graphe de superposition de DEUX blocs (cf. issue #6).
//
// On superpose les deux courbes e1RM ramenées au même origine X (semaines depuis
// le début de chaque bloc, cf. `toWeeklySeries`) : leurs PENTES se lisent alors
// l'une sur l'autre. DESIGN.md « un seul accent » : le bloc GAGNANT porte
// l'accent violet, le perdant reste en ink-muted (subordonné). Sans verdict
// (égalité ou données manquantes), les deux lignes restent neutres, aucune ne
// revendique l'accent. Axes en mono (Readout Rule), X = semaines, Y = e1RM (kg).
//
// Une LÉGENDE inline (deux puces colorées + libellé de bloc) et un Tooltip
// nomment chaque courbe : sans eux, en cas d'égalité les deux lignes sont en
// ink-muted et rien ne dit quelle courbe = quel bloc.
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts';
import type { Side } from '../../domain/block-comparison';
import type { WeeklyPoint } from './comparison-series';

const ACCENT = 'var(--color-accent)';
const LINE = 'var(--color-line)';
const INK_MUTED = 'var(--color-ink-muted)';

/** Police mono tabulaire pour tous les chiffres mesurés (axes, tooltip). */
const READOUT_TICK = {
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  fill: INK_MUTED,
  fontVariant: 'tabular-nums',
} as const;

export interface ComparisonChartProps {
  first: WeeklyPoint[];
  second: WeeklyPoint[];
  /** Le côté gagnant (porte l'accent), ou `null`/`'tie'` : aucune ligne accentuée. */
  winner: Side | 'tie' | null;
  /** Libellés humains des deux blocs (légende + tooltip). */
  firstLabel: string;
  secondLabel: string;
}

/** Couleur d'un côté : accent s'il gagne, ink-muted sinon (jamais deux accents). */
function colorFor(side: Side, winner: ComparisonChartProps['winner']): string {
  return winner === side ? ACCENT : INK_MUTED;
}

/**
 * Tick de l'axe X : la 1ʳᵉ semaine est S1, pas « S0 » (on compte les semaines
 * de muscu à partir de 1). `toWeeklySeries` ancre le 1er point à `week:0` pour
 * garder l'écart en semaines exact ; le +1 ne vit que dans l'affichage.
 */
function formatWeekTick(week: number): string {
  return `S${Math.round(week) + 1}`;
}

// Recharts injecte les props du tooltip à l'exécution ; `content={<… />}` les
// fournit donc vides au typage statique → on les rend partielles. Avec deux
// séries empilées, `payload` peut contenir l'un ou l'autre bloc (ou les deux).
function makeComparisonTooltip(firstLabel: string, secondLabel: string) {
  return function ComparisonTooltip({
    active,
    payload,
  }: Partial<TooltipContentProps<number, string>>) {
    if (!active || !payload || payload.length === 0) return null;
    const first = payload[0];
    if (!first) return null;
    const point = first.payload as WeeklyPoint;
    return (
      <div className="rounded-lg border border-line bg-surface-2 px-3 py-2 shadow-lg">
        <p className="readout text-[11px] text-ink-muted">{formatWeekTick(point.week)}</p>
        {payload.map((entry) => {
          const p = entry.payload as WeeklyPoint;
          const label = entry.name === 'first' ? firstLabel : secondLabel;
          return (
            <p key={entry.name} className="readout text-sm font-medium text-ink">
              <span className="text-xs font-normal text-ink-muted">{label} </span>
              {Math.round(p.e1rm)}
              <span className="ml-1 text-xs font-normal text-ink-muted">kg</span>
            </p>
          );
        })}
      </div>
    );
  };
}

export function ComparisonChart({
  first,
  second,
  winner,
  firstLabel,
  secondLabel,
}: ComparisonChartProps) {
  const firstColor = colorFor('first', winner);
  const secondColor = colorFor('second', winner);
  const ComparisonTooltip = makeComparisonTooltip(firstLabel, secondLabel);

  return (
    <div>
      <div
        className="h-40 w-full"
        role="img"
        aria-label={`Comparaison des pentes e1RM des blocs ${firstLabel} et ${secondLabel}, par semaine de bloc.`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart margin={{ top: 8, right: 20, bottom: 4, left: -8 }}>
            <CartesianGrid stroke={LINE} strokeWidth={1} vertical={false} opacity={0.4} />
            <XAxis
              type="number"
              dataKey="week"
              tick={READOUT_TICK}
              tickLine={false}
              axisLine={{ stroke: LINE }}
              tickFormatter={formatWeekTick}
              domain={[0, 'dataMax']}
              allowDecimals={false}
            />
            <YAxis
              tick={READOUT_TICK}
              tickLine={false}
              axisLine={false}
              width={36}
              domain={['dataMin - 3', 'dataMax + 3']}
              tickFormatter={(v: number) => `${Math.round(v)}`}
              allowDecimals={false}
            />
            <Tooltip content={<ComparisonTooltip />} cursor={{ stroke: LINE, strokeWidth: 1 }} />
            {/* Le perdant d'abord, sous l'accent : le gagnant reste lisible au-dessus. */}
            <Line
              name="second"
              data={second}
              type="monotone"
              dataKey="e1rm"
              stroke={secondColor}
              strokeWidth={winner === 'second' ? 2.5 : 1.75}
              dot={{ r: 2, fill: secondColor, strokeWidth: 0 }}
              isAnimationActive={false}
            />
            <Line
              name="first"
              data={first}
              type="monotone"
              dataKey="e1rm"
              stroke={firstColor}
              strokeWidth={winner === 'first' ? 2.5 : 1.75}
              dot={{ r: 2, fill: firstColor, strokeWidth: 0 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Légende inline : la puce porte la couleur de la courbe, le libellé est
          en mono (Readout Rule). Le gagnant garde l'accent, l'autre ink-muted. */}
      <ul className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        <LegendItem color={firstColor} label={firstLabel} />
        <LegendItem color={secondColor} label={secondLabel} />
      </ul>
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <li className="flex items-center gap-1.5">
      <span
        className="inline-block h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
        aria-hidden="true"
      />
      <span className="readout text-[11px] text-ink-muted">{label}</span>
    </li>
  );
}
