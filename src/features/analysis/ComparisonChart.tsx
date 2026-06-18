// Graphe de superposition de DEUX blocs (cf. issue #6).
//
// On superpose les deux courbes e1RM ramenées au même origine X (semaines depuis
// le début de chaque bloc, cf. `toWeeklySeries`) : leurs PENTES se lisent alors
// l'une sur l'autre. DESIGN.md « un seul accent » : le bloc GAGNANT porte
// l'accent violet, le perdant reste en ink-muted (subordonné). Sans verdict
// (égalité ou données manquantes), les deux lignes restent neutres, aucune ne
// revendique l'accent. Axes en mono (Readout Rule), X = semaines, Y = e1RM (kg).
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts';
import type { Side } from '../../domain/block-comparison';
import type { WeeklyPoint } from './comparison-series';

const ACCENT = 'var(--color-accent)';
const LINE = 'var(--color-line)';
const INK_MUTED = 'var(--color-ink-muted)';

/** Police mono tabulaire pour tous les chiffres mesurés (axes). */
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
}

/** Couleur d'un côté : accent s'il gagne, ink-muted sinon (jamais deux accents). */
function colorFor(side: Side, winner: ComparisonChartProps['winner']): string {
  return winner === side ? ACCENT : INK_MUTED;
}

export function ComparisonChart({ first, second, winner }: ComparisonChartProps) {
  const firstColor = colorFor('first', winner);
  const secondColor = colorFor('second', winner);

  return (
    <div className="h-40 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart margin={{ top: 8, right: 20, bottom: 4, left: -8 }}>
          <CartesianGrid stroke={LINE} strokeWidth={1} vertical={false} opacity={0.4} />
          <XAxis
            type="number"
            dataKey="week"
            tick={READOUT_TICK}
            tickLine={false}
            axisLine={{ stroke: LINE }}
            tickFormatter={(v: number) => `S${Math.round(v)}`}
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
          {/* Le perdant d'abord, sous l'accent : le gagnant reste lisible au-dessus. */}
          <Line
            data={second}
            type="monotone"
            dataKey="e1rm"
            stroke={secondColor}
            strokeWidth={winner === 'second' ? 2.5 : 1.75}
            dot={{ r: 2, fill: secondColor, strokeWidth: 0 }}
            isAnimationActive={false}
          />
          <Line
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
  );
}
